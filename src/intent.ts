import { Intent, Invocation, AuthEntry, BalanceDelta, DisplayValue } from './types.js';
import { WarningCode } from './errors.js';
import { Address } from '@stellar/stellar-sdk';

export function verifyIntent(
  intent: Intent | undefined,
  invocation: Invocation | undefined,
  auth: AuthEntry[],
  effects: BalanceDelta[],
  signerAddress?: string
): { warnings: { code: WarningCode; message: string; path?: string }[] } {
  const warnings: { code: WarningCode; message: string; path?: string }[] = [];
  if (!intent) return { warnings };
  if (!invocation) return { warnings };

  const normalize = (val: unknown): string => {
    if (typeof val === 'bigint') return val.toString();
    if (typeof val === 'number') return val.toString();
    if (typeof val === 'string') {
      if (val.startsWith('G') || val.startsWith('C') || val.startsWith('M')) {
         try {
            return Address.fromString(val).toString();
         } catch {
            return val;
         }
      }
      return val;
    }
    return String(val);
  };

  const normalizeDisplay = (val: DisplayValue): string => {
    switch (val.kind) {
      case 'int': return val.value;
      case 'address': 
        try {
          return Address.fromString(val.value).toString();
        } catch {
          return val.value;
        }
      case 'bytes': return val.hex.toLowerCase();
      case 'string': return val.value;
      case 'symbol': return val.value;
      case 'bool': return val.value ? 'true' : 'false';
      default: return JSON.stringify(val);
    }
  };

  if (normalize(intent.contractId) !== normalize(invocation.contractId)) {
    warnings.push({ code: 'INTENT_MISMATCH', message: 'Contract ID mismatch', path: 'contractId' });
  }
  if (intent.functionName !== invocation.functionName) {
    warnings.push({ code: 'INTENT_MISMATCH', message: 'Function name mismatch', path: 'functionName' });
  }

  if (intent.args) {
    if (invocation.specSource === 'none') {
      warnings.push({ code: 'INTENT_UNVERIFIABLE', message: 'No spec available to verify named arguments', path: 'args' });
    } else {
      for (const [key, expectedVal] of Object.entries(intent.args)) {
        const decodedArg = invocation.args.find(a => a.name === key);
        if (!decodedArg) {
          warnings.push({ code: 'INTENT_MISMATCH', message: `Missing expected argument ${key}`, path: `args.${key}` });
          continue;
        }
        const normExpected = normalize(expectedVal);
        const normActual = normalizeDisplay(decodedArg.value);
        if (normExpected !== normActual) {
          warnings.push({ code: 'INTENT_MISMATCH', message: `Argument ${key} mismatch. Expected ${normExpected}, got ${normActual}`, path: `args.${key}` });
        }
      }
    }
  }

  if (intent.maxSpend) {
    const { token, account, amount } = intent.maxSpend;
    const tokenEffects = effects.filter(e => e.tokenContractId === token && e.account === account);
    let totalNegative = 0n;
    for (const e of tokenEffects) {
       const d = BigInt(e.delta);
       if (d < 0n) totalNegative -= d;
    }
    const maxAmount = BigInt(amount);
    if (totalNegative > maxAmount) {
      warnings.push({ code: 'INTENT_SPEND_EXCEEDED', message: `Spent ${totalNegative}, which exceeds maxSpend of ${maxAmount}` });
    }
  }

  if (intent.allowedContracts && signerAddress) {
     const allowed = new Set(intent.allowedContracts.map(c => normalize(c)));
     for (const entry of auth) {
        if (entry.credentials.type === 'address' && entry.credentials.address === signerAddress) {
           const walk = (node: any) => {
              if (node.contractId && !allowed.has(normalize(node.contractId))) {
                 warnings.push({ code: 'INTENT_UNEXPECTED_AUTH', message: `Signer authorizes unexpected contract ${node.contractId}` });
              }
              for (const child of node.children || []) walk(child);
           };
           walk(entry.root);
        }
     }
  }

  return { warnings };
}
