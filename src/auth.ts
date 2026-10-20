import { xdr, Address } from "@stellar/stellar-sdk";
import { AuthEntry, AuthNode, DecodedArg } from "./types.js";
import { WarningCode } from "./errors.js";
import { loadSpec, SpecLoaderOptions, SAC_FUNCTIONS } from "./spec.js";
import { decodeScVal } from "./scval.js";
import { MAX_AUTH_DEPTH, MAX_AUTH_NODES } from "./limits.js";
import { unwrap, getSwitchName, getArray } from "./accessors.js";

export interface AuthDecodeOptions extends SpecLoaderOptions {
  signerAddress?: string | undefined;
  minAuthValidityLedgers?: number | undefined;
  topLevelContractId?: string | undefined;
}

export async function decodeAuthEntries(
  entries: (xdr.SorobanAuthorizationEntry | unknown)[],
  latestLedger: number,
  opts: AuthDecodeOptions,
): Promise<{
  auth: AuthEntry[];
  warnings: { code: WarningCode; message: string }[];
}> {
  const warnings: { code: WarningCode; message: string }[] = [];
  const auth: AuthEntry[] = [];

  for (const rawEntry of entries) {
    const entry = rawEntry as Record<string, unknown>;
    const creds = unwrap<Record<string, unknown> | string>(entry.credentials);
    let credentials: AuthEntry["credentials"];

    const credsSwitch =
      getSwitchName(creds) ?? (typeof creds === "string" ? creds : undefined);

    if (
      creds === "source_account" ||
      creds === "sourceAccount" ||
      credsSwitch === "sorobanCredentialsSourceAccount" ||
      credsSwitch === "source_account"
    ) {
      credentials = { type: "source-account" };
    } else if (
      credsSwitch === "sorobanCredentialsAddress" ||
      (creds &&
        typeof creds === "object" &&
        ("address" in creds || "addressCreds" in creds))
    ) {
      const addrCreds =
        unwrap<Record<string, unknown>>(
          (creds as Record<string, unknown>).address ??
            (creds as Record<string, unknown>).addressCreds,
        ) ?? (creds as Record<string, unknown>);

      const addrObj = unwrap(addrCreds.address);
      const address =
        typeof addrObj === "string"
          ? addrObj
          : Address.fromScAddress(addrObj as xdr.ScAddress).toString();

      const nonceObj = unwrap(addrCreds.nonce);
      const nonce = nonceObj ? String(nonceObj) : "0";

      const signatureExpirationLedger = Number(
        unwrap(
          addrCreds.signatureExpirationLedger ??
            addrCreds.signature_expiration_ledger,
        ) ?? 0,
      );

      const signature = unwrap(addrCreds.signature);
      const signatureSwitch = getSwitchName(signature);
      const signed = signature
        ? signatureSwitch !== "scvVoid" && signature !== "void"
        : false;

      credentials = {
        type: "address",
        address,
        nonce,
        signatureExpirationLedger,
        signed,
      };

      if (signatureExpirationLedger < latestLedger) {
        warnings.push({
          code: "AUTH_EXPIRED",
          message: "Signature expiration ledger already passed",
        });
      } else {
        const minValidity = opts.minAuthValidityLedgers ?? 12;
        if (signatureExpirationLedger < latestLedger + minValidity) {
          warnings.push({
            code: "AUTH_EXPIRING",
            message: "Signature expiration ledger is approaching",
          });
        }
      }
    } else {
      warnings.push({
        code: "INTERNAL_ERROR",
        message: "Unknown credentials type",
      });
      continue;
    }

    let nodeCount = 0;

    async function walkInvocation(
      rawInv: unknown,
      depth: number,
    ): Promise<AuthNode> {
      nodeCount++;
      if (nodeCount > MAX_AUTH_NODES) {
        warnings.push({
          code: "AUTH_TREE_TOO_LARGE",
          message: "Maximum auth nodes exceeded",
        });
        return { kind: "contract-fn", children: [], depth };
      }
      if (depth > MAX_AUTH_DEPTH) {
        warnings.push({
          code: "AUTH_TREE_TOO_LARGE",
          message: "Maximum auth depth exceeded",
        });
        return { kind: "contract-fn", children: [], depth };
      }

      const inv = rawInv as Record<string, unknown>;
      const func = unwrap<Record<string, unknown>>(inv.function ?? inv.fn);
      const funcType = getSwitchName(func);

      let kind: AuthNode["kind"] = "contract-fn";
      let contractId: string | undefined;
      let functionName: string | undefined;
      let args: DecodedArg[] | undefined;
      let details: Record<string, string> | undefined;
      let skipChildren = false;

      if (
        func &&
        (funcType === "sorobanAuthorizedFunctionTypeContractFn" ||
          Boolean(func.contract_fn) ||
          Boolean(func.contractFn))
      ) {
        const contractFn =
          unwrap<Record<string, unknown>>(
            func.contractFn ?? func.contract_fn,
          ) ?? func;

        const addrObj = unwrap(
          contractFn.contractAddress ?? contractFn.contract_address,
        );
        contractId =
          typeof addrObj === "string"
            ? addrObj
            : Address.fromScAddress(addrObj as xdr.ScAddress).toString();

        const rawFnName = unwrap<string | { toString: () => string }>(
          contractFn.functionName ?? contractFn.function_name,
        );
        functionName =
          typeof rawFnName === "string"
            ? rawFnName
            : rawFnName
              ? rawFnName.toString()
              : "";

        if (opts.topLevelContractId && contractId !== opts.topLevelContractId) {
          warnings.push({
            code: "AUTH_EXTRA_CONTRACT",
            message: `Auth targets contract ${contractId} which is not the top-level contract`,
          });
        }

        const scVals = getArray<xdr.ScVal>(contractFn.args);

        const specResult = await loadSpec(contractId, opts);
        warnings.push(...specResult.warnings);

        const isTopLevel =
          opts.topLevelContractId && contractId === opts.topLevelContractId;
        const noSpec = !specResult.spec && specResult.source === "none";

        if (noSpec) {
          if (!isTopLevel) {
            warnings.push({
              code: "AUTH_UNKNOWN_CONTRACT",
              message: `No spec found for auth contract ${contractId}`,
            });
          } else {
            skipChildren = true;
          }
        }

        let decodedArgs: DecodedArg[] = [];
        if (specResult.source === "sac-builtin" && functionName) {
          const sacDef = SAC_FUNCTIONS[functionName];
          decodedArgs = scVals.map((arg: xdr.ScVal | unknown, i: number) => {
            const expected = sacDef?.args[i];
            const res = decodeScVal(arg, null, null);
            warnings.push(...res.warnings);
            return {
              name: expected?.name || null,
              typeName: expected?.type || null,
              value: res.value,
            };
          });
        } else if (specResult.spec && functionName) {
          const spec = specResult.spec;
          const funcEntry = spec.getFunc(functionName);
          decodedArgs = scVals.map((arg: xdr.ScVal | unknown, i: number) => {
            const input = funcEntry?.inputs[i];
            let name: string | null = null;
            if (input) {
              if (typeof input.name === "string") {
                name = input.name;
              } else if (
                Buffer.isBuffer(input.name) ||
                input.name instanceof Uint8Array
              ) {
                name = Buffer.from(input.name).toString("utf8");
              } else if (input.name) {
                name = String(input.name);
              }
            }
            const res = decodeScVal(arg, spec, input?.type || null);
            warnings.push(...res.warnings);
            return {
              name,
              typeName: input?.type.type || null,
              value: res.value,
            };
          });
        } else {
          decodedArgs = scVals.map((arg: xdr.ScVal | unknown) => {
            const res = decodeScVal(arg, null, null);
            warnings.push(...res.warnings);
            return { name: null, typeName: null, value: res.value };
          });
        }
        args = decodedArgs;
      } else if (
        funcType === "sorobanAuthorizedFunctionTypeCreateContractHostFn" ||
        funcType === "sorobanAuthorizedFunctionTypeCreateContractV2HostFn"
      ) {
        warnings.push({
          code: "AUTH_CREATES_CONTRACT",
          message: "Create-contract node inside auth",
        });
        kind =
          funcType === "sorobanAuthorizedFunctionTypeCreateContractHostFn"
            ? "create-contract"
            : "create-contract-v2";
        details = {};
      }

      const children: AuthNode[] = [];
      if (!skipChildren) {
        const subInvs = getArray(inv.subInvocations ?? inv.sub_invocations);
        for (const sub of subInvs) {
          children.push(await walkInvocation(sub, depth + 1));
        }
      }

      const node: AuthNode = {
        kind,
        depth,
        children,
        ...(contractId !== undefined ? { contractId } : {}),
        ...(functionName !== undefined ? { functionName } : {}),
        ...(args !== undefined ? { args } : {}),
        ...(details !== undefined ? { details } : {}),
      };

      return node;
    }

    const rootInvoc = unwrap(entry.rootInvocation ?? entry.root_invocation);
    const root = await walkInvocation(rootInvoc, 1);

    auth.push({ credentials, root });
  }

  const seenNonces = new Set<string>();
  for (const entry of auth) {
    if (entry.credentials.type === "address") {
      const key = `${entry.credentials.address}:${entry.credentials.nonce}`;
      if (seenNonces.has(key)) {
        warnings.push({
          code: "AUTH_DUPLICATE_NONCE",
          message: "Duplicate nonce in authorization entries",
        });
      }
      seenNonces.add(key);
    }
  }

  return { auth, warnings };
}
