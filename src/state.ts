import { xdr, StrKey, contract, Address } from '@stellar/stellar-sdk';
import { SpecLoaderOptions, loadSpec } from './spec.js';
import { decodeScVal } from './scval.js';
import { WarningCode } from './errors.js';
import { DisplayValue } from './types.js';

export interface DecodedState {
  contractId: string | null;
  key: DisplayValue;
  val: DisplayValue;
  entryType: string;
  specSource: 'wasm' | 'injected' | 'sac-builtin' | 'none';
  warnings: { code: WarningCode; message: string }[];
}

export async function decodeLedgerEntry(
  entry: xdr.LedgerEntry,
  opts: SpecLoaderOptions
): Promise<DecodedState> {
  const warnings: { code: WarningCode; message: string }[] = [];
  const data = entry.data.value;
  const entryType = entry.data.type;

  let contractId: string | null = null;
  let key: DisplayValue = { kind: 'void' };
  let val: DisplayValue = { kind: 'void' };
  let specSource: 'wasm' | 'injected' | 'sac-builtin' | 'none' = 'none';

  if (entryType === 'contractData') {
    const contractData = data as xdr.ContractDataEntry;
    const contractHash = contractData.contract;
    
    if (contractHash) {
       contractId = Address.fromScAddress(contractHash).toString();
    }
    
    const keyVal = contractData.key;
    const valVal = contractData.val;
    
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
    const decodedKey = decodeScVal(keyVal, spec, null);
    warnings.push(...decodedKey.warnings);
    key = decodedKey.value;
    
    const decodedVal = decodeScVal(valVal, spec, null);
    warnings.push(...decodedVal.warnings);
    val = decodedVal.value;
    
  } else {
    warnings.push({ code: 'UNSUPPORTED_SCVAL', message: `LedgerEntry type ${entryType} is not fully supported for clear-signing` });
  }

  return {
    contractId,
    key,
    val,
    entryType,
    specSource,
    warnings
  };
}
