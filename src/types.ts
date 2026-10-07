export type DisplayValue =
  | { kind: 'bool'; value: boolean }
  | { kind: 'void' }
  | { kind: 'int'; type: 'u32'|'i32'|'u64'|'i64'|'u128'|'i128'|'u256'|'i256'; value: string } // decimal string
  | { kind: 'timepoint' | 'duration'; value: string }
  | { kind: 'bytes'; hex: string; length: number; truncated: boolean }
  | { kind: 'string' | 'symbol'; value: string; truncated: boolean; sanitized: boolean }
  | { kind: 'address'; value: string; addressType: 'account'|'contract'|'muxed'|'other' }
  | { kind: 'vec'; items: DisplayValue[] }
  | { kind: 'map'; entries: { key: DisplayValue; value: DisplayValue }[] }
  | { kind: 'struct'; name: string; fields: { name: string; value: DisplayValue }[] }
  | { kind: 'enum'; name: string; variant: string; values: DisplayValue[] }
  | { kind: 'option'; value: DisplayValue | null }
  | { kind: 'raw'; scvalType: string; xdr: string }; // fallback, always paired with a warning

export interface DecodedArg {
  name: string | null;
  typeName: string | null;
  value: DisplayValue;
}

export interface Invocation {
  contractId: string;
  functionName: string;
  args: DecodedArg[];
  specSource: 'wasm' | 'sac-builtin' | 'injected' | 'none';
}

export interface AuthEntry {
  credentials:
    | { type: 'source-account' }
    | { type: 'address'; address: string; nonce: string; signatureExpirationLedger: number; signed: boolean };
  root: AuthNode;
}

export interface AuthNode {
  kind: 'contract-fn' | 'create-contract' | 'create-contract-v2';
  contractId?: string;
  functionName?: string;
  args?: DecodedArg[]; // for contract-fn
  details?: Record<string, string>; // for create-contract
  children: AuthNode[];
  depth: number;
}

export interface BalanceDelta {
  tokenContractId: string;
  account: string;
  delta: string; // decimal string, signed
  symbol?: string;
  decimals?: number;
  formatted?: string;
}
