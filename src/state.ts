import { xdr, contract } from "@stellar/stellar-sdk";
import { SpecLoaderOptions, loadSpec } from "./spec.js";
import { decodeScVal } from "./scval.js";
import { WarningCode } from "./errors.js";
import { DisplayValue } from "./types.js";
import { unwrap, getSwitchName, toContractId } from "./accessors.js";

export interface DecodedState {
  contractId: string | null;
  key: DisplayValue;
  val: DisplayValue;
  entryType: string;
  specSource: "wasm" | "injected" | "sac-builtin" | "none";
  warnings: { code: WarningCode; message: string }[];
}

export async function decodeLedgerEntry(
  entry: xdr.LedgerEntry | unknown,
  opts: SpecLoaderOptions,
): Promise<DecodedState> {
  const warnings: { code: WarningCode; message: string }[] = [];
  const entryObj = (entry ?? {}) as Record<string, unknown>;
  const rawData = unwrap<Record<string, unknown>>(entryObj.data) ?? entryObj;

  let entryType =
    getSwitchName(rawData) ??
    (typeof rawData.type === "string" ? rawData.type : undefined);
  let data: unknown = unwrap(rawData.value);

  if (!entryType) {
    if ("contractData" in rawData || "contract_data" in rawData) {
      entryType = "contractData";
      data = unwrap(rawData.contractData ?? rawData.contract_data);
    } else if ("trustline" in rawData) {
      entryType = "trustline";
      data = unwrap(rawData.trustline);
    } else if ("account" in rawData) {
      entryType = "account";
      data = unwrap(rawData.account);
    } else if ("contractCode" in rawData || "contract_code" in rawData) {
      entryType = "contractCode";
      data = unwrap(rawData.contractCode ?? rawData.contract_code);
    } else {
      entryType = "unknown";
    }
  } else if (entryType === "contract_data") {
    entryType = "contractData";
  }

  let contractId: string | null = null;
  let key: DisplayValue = { kind: "void" };
  let val: DisplayValue = { kind: "void" };
  let specSource: "wasm" | "injected" | "sac-builtin" | "none" = "none";

  if (entryType === "contractData") {
    const contractData = (data ??
      unwrap(rawData.contractData ?? rawData.contract_data) ??
      rawData) as Record<string, unknown>;
    const contractHash = unwrap(contractData.contract);

    if (contractHash) {
      contractId = toContractId(contractHash);
    }

    const keyVal = unwrap(contractData.key);
    const valVal = unwrap(contractData.val);

    let spec: contract.Spec | null = null;

    if (contractId) {
      const specResult = await loadSpec(contractId, opts);
      warnings.push(...specResult.warnings);
      specSource = specResult.source;
      spec = specResult.spec;
    }

    // Attempt to decode key and val
    // In many cases, contract data types are not explicitly named in the Spec like function args,
    // but decodeScVal will map them to basic types and resolve UDTs if we provide the Spec!
    const decodedKey =
      keyVal === "ledger_key_contract_instance"
        ? {
            value: {
              kind: "symbol" as const,
              value: "ledger_key_contract_instance",
              sanitized: false,
              truncated: false,
            },
            warnings: [],
          }
        : decodeScVal(keyVal, spec, null);
    warnings.push(...decodedKey.warnings);
    key = decodedKey.value;

    const decodedVal =
      valVal !== undefined
        ? decodeScVal(valVal, spec, null)
        : { value: { kind: "void" as const }, warnings: [] };
    warnings.push(...decodedVal.warnings);
    val = decodedVal.value;
  } else {
    warnings.push({
      code: "UNSUPPORTED_SCVAL",
      message: `LedgerEntry type ${entryType} is not fully supported for clear-signing`,
    });
  }

  return {
    contractId,
    key,
    val,
    entryType,
    specSource,
    warnings,
  };
}
