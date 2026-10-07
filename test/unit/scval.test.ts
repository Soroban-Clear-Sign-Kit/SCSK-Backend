import { describe, it, expect } from 'vitest';
import { decodeScVal } from '../../src/scval.js';
import { xdr } from '@stellar/stellar-sdk';
import { MAX_SCVAL_DEPTH } from '../../src/limits.js';

describe('decodeScVal', () => {
  it('decodes bool', () => {
    const res = decodeScVal(xdr.ScVal.scvBool(true));
    expect(res.value).toEqual({ kind: 'bool', value: true });
    expect(res.warnings).toHaveLength(0);
  });

  it('decodes void', () => {
    const res = decodeScVal(xdr.ScVal.scvVoid());
    expect(res.value).toEqual({ kind: 'void' });
  });

  it('decodes u32', () => {
    const res = decodeScVal(xdr.ScVal.scvU32(123));
    expect(res.value).toEqual({ kind: 'int', type: 'u32', value: '123' });
  });

  it('decodes i32', () => {
    const res = decodeScVal(xdr.ScVal.scvI32(-123));
    expect(res.value).toEqual({ kind: 'int', type: 'i32', value: '-123' });
  });

  it('decodes u64 as decimal string', () => {
    const res = decodeScVal(xdr.ScVal.scvU64(xdr.Uint64.fromString('18446744073709551615')));
    expect(res.value).toEqual({ kind: 'int', type: 'u64', value: '18446744073709551615' });
  });

  it('decodes i64 as decimal string', () => {
    const res = decodeScVal(xdr.ScVal.scvI64(xdr.Int64.fromString('-9223372036854775808')));
    expect(res.value).toEqual({ kind: 'int', type: 'i64', value: '-9223372036854775808' });
  });

  it('decodes bytes and truncates', () => {
    const buf = Buffer.alloc(70, 'a');
    const res = decodeScVal(xdr.ScVal.scvBytes(buf));
    expect(res.value.kind).toBe('bytes');
    if (res.value.kind === 'bytes') {
      expect(res.value.truncated).toBe(true);
      expect(res.value.length).toBe(70);
      expect(res.value.hex.length).toBe(128);
    }
  });

  it('decodes string and truncates', () => {
    const longStr = 'a'.repeat(600);
    const res = decodeScVal(xdr.ScVal.scvString(longStr));
    expect(res.value.kind).toBe('string');
    if (res.value.kind === 'string') {
      expect(res.value.truncated).toBe(true);
      expect(res.value.value.length).toBe(512);
    }
  });

  it('decodes address (account)', () => {
    const addr = xdr.ScAddress.scAddressTypeAccount(
      xdr.PublicKey.publicKeyTypeEd25519(Buffer.alloc(32, 0))
    );
    const res = decodeScVal(xdr.ScVal.scvAddress(addr));
    expect(res.value.kind).toBe('address');
    if (res.value.kind === 'address') {
      expect(res.value.addressType).toBe('account');
    }
  });

  it('stops recursion at MAX_SCVAL_DEPTH', () => {
    let val = xdr.ScVal.scvVec([xdr.ScVal.scvVoid()]);
    for (let i = 0; i < MAX_SCVAL_DEPTH + 5; i++) {
      val = xdr.ScVal.scvVec([val]);
    }
    const res = decodeScVal(val);
    expect(res.warnings).toContainEqual(expect.objectContaining({ code: 'VALUE_TOO_DEEP' }));
  });

  it('warns for unsupported types', () => {
    const res = decodeScVal(xdr.ScVal.scvLedgerKeyContractInstance());
    expect(res.warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SCVAL' }));
    expect(res.value.kind).toBe('raw');
  });
});
