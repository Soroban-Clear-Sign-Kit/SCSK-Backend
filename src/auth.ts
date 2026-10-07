import { xdr, Address } from '@stellar/stellar-sdk';
import { AuthEntry, AuthNode, DecodedArg } from './types.js';
import { WarningCode } from './errors.js';
import { loadSpec, SpecLoaderOptions, SAC_FUNCTIONS } from './spec.js';
import { decodeScVal } from './scval.js';
import { MAX_AUTH_DEPTH, MAX_AUTH_NODES } from './limits.js';

export interface AuthDecodeOptions extends SpecLoaderOptions {
  signerAddress?: string;
  minAuthValidityLedgers?: number;
  topLevelContractId?: string;
}

export async function decodeAuthEntries(
  entries: xdr.SorobanAuthorizationEntry[],
  latestLedger: number,
  opts: AuthDecodeOptions
): Promise<{ auth: AuthEntry[]; warnings: { code: WarningCode; message: string }[] }> {
  const warnings: { code: WarningCode; message: string }[] = [];
  const auth: AuthEntry[] = [];

  for (const entry of entries) {
    const creds = entry.credentials();
    let credentials: AuthEntry['credentials'];

    if (creds.switch().name === 'sorobanCredentialsSourceAccount') {
      credentials = { type: 'source-account' };
    } else if (creds.switch().name === 'sorobanCredentialsAddress') {
      const addrCreds = creds.address();
      const address = Address.fromScAddress(addrCreds.address()).toString();
      const nonce = addrCreds.nonce().toString();
      const signatureExpirationLedger = addrCreds.signatureExpirationLedger();
      const signed = addrCreds.signature().switch().name !== 'scvVoid';
      
      credentials = {
        type: 'address',
        address,
        nonce,
        signatureExpirationLedger,
        signed
      };

      if (signatureExpirationLedger < latestLedger) {
        warnings.push({ code: 'AUTH_EXPIRED', message: 'Signature expiration ledger already passed' });
      } else {
        const minValidity = opts.minAuthValidityLedgers ?? 12;
        if (signatureExpirationLedger < latestLedger + minValidity) {
          warnings.push({ code: 'AUTH_EXPIRING', message: 'Signature expiration ledger is approaching' });
        }
      }
    } else {
      warnings.push({ code: 'INTERNAL_ERROR', message: 'Unknown credentials type' });
      continue;
    }

    let nodeCount = 0;

    async function walkInvocation(
      inv: xdr.SorobanAuthorizedInvocation,
      depth: number
    ): Promise<AuthNode> {
      nodeCount++;
      if (nodeCount > MAX_AUTH_NODES) {
        warnings.push({ code: 'AUTH_TREE_TOO_LARGE', message: 'Maximum auth nodes exceeded' });
        return { kind: 'contract-fn', children: [], depth };
      }
      if (depth > MAX_AUTH_DEPTH) {
        warnings.push({ code: 'AUTH_TREE_TOO_LARGE', message: 'Maximum auth depth exceeded' });
        return { kind: 'contract-fn', children: [], depth };
      }

      const func = inv.function();
      const funcType = func.switch().name;

      let kind: AuthNode['kind'] = 'contract-fn';
      let contractId: string | undefined;
      let functionName: string | undefined;
      let args: DecodedArg[] | undefined;
      let details: Record<string, string> | undefined;

      if (funcType === 'sorobanAuthorizedFunctionTypeContractFn') {
        const contractFn = func.contractFn();
        contractId = Address.fromScAddress(contractFn.contractAddress()).toString();
        const rawFnName = contractFn.functionName();
        functionName = typeof rawFnName === 'string' ? rawFnName : rawFnName.toString();
        
        if (opts.topLevelContractId && contractId !== opts.topLevelContractId) {
          warnings.push({ code: 'AUTH_EXTRA_CONTRACT', message: `Auth targets contract ${contractId} which is not the top-level contract` });
        }

        const scVals = contractFn.args();

        const specResult = await loadSpec(contractId, opts);
        warnings.push(...specResult.warnings);

        if (!specResult.spec && specResult.source === 'none') {
           warnings.push({ code: 'AUTH_UNKNOWN_CONTRACT', message: `No spec found for auth contract ${contractId}` });
        }

        let decodedArgs: DecodedArg[] = [];
        if (specResult.source === 'sac-builtin') {
          const sacDef = SAC_FUNCTIONS[functionName];
          decodedArgs = scVals.map((arg: any, i: number) => {
            const expected = sacDef?.args[i];
            const res = decodeScVal(arg, null, null);
            warnings.push(...res.warnings);
            return { name: expected?.name || null, typeName: expected?.type || null, value: res.value };
          });
        } else if (specResult.spec) {
          const spec = specResult.spec;
          const funcEntry = spec.getFunc(functionName);
          decodedArgs = scVals.map((arg: any, i: number) => {
            const input = funcEntry?.inputs[i];
            const name = input ? (typeof input.name === 'string' ? input.name : Buffer.from(input.name as any).toString('utf8')) : null;
            const res = decodeScVal(arg, spec, input?.type || null);
            warnings.push(...res.warnings);
            return { name, typeName: input?.type.type || null, value: res.value };
          });
        } else {
          decodedArgs = scVals.map((arg: any) => {
            const res = decodeScVal(arg, null, null);
            warnings.push(...res.warnings);
            return { name: null, typeName: null, value: res.value };
          });
        }
        args = decodedArgs;

      } else if (funcType === 'sorobanAuthorizedFunctionTypeCreateContractHostFn' || funcType === 'sorobanAuthorizedFunctionTypeCreateContractV2HostFn') {
        warnings.push({ code: 'AUTH_CREATES_CONTRACT', message: 'Create-contract node inside auth' });
        kind = funcType === 'sorobanAuthorizedFunctionTypeCreateContractHostFn' ? 'create-contract' : 'create-contract-v2';
        details = {};
      }

      const subInvs = inv.subInvocations();
      const children: AuthNode[] = [];
      for (const sub of subInvs) {
        children.push(await walkInvocation(sub, depth + 1));
      }

      return {
        kind,
        contractId,
        functionName,
        args,
        details,
        children,
        depth
      };
    }

    const root = await walkInvocation(entry.rootInvocation(), 1);
    
    auth.push({ credentials, root });
  }

  const seenNonces = new Set<string>();
  for (const entry of auth) {
    if (entry.credentials.type === 'address') {
      const key = `${entry.credentials.address}:${entry.credentials.nonce}`;
      if (seenNonces.has(key)) {
        warnings.push({ code: 'AUTH_DUPLICATE_NONCE', message: 'Duplicate nonce in authorization entries' });
      }
      seenNonces.add(key);
    }
  }

  return { auth, warnings };
}
