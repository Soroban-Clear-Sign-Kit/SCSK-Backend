import { describe, it, expect } from 'vitest';
import { decodeScVal } from '../../src/scval';
import { xdr, Address, Keypair } from '@stellar/stellar-sdk';
import { MAX_SCVAL_DEPTH, MAX_DISPLAY_STRING } from '../../src/limits';

describe('decodeScVal', () => {
    it('decodes deep structure with warnings', () => {
        const buildDeepScVal = (depth: number): any => {
            if (depth === 0) return xdr.ScVal.scvVoid();
            return xdr.ScVal.scvVec([buildDeepScVal(depth - 1)]);
        };

        const scVal = buildDeepScVal(MAX_SCVAL_DEPTH + 2);
        const { value, warnings } = decodeScVal(scVal);
        expect(warnings).toContainEqual({ code: 'VALUE_TOO_DEEP', message: 'Maximum recursion depth exceeded' });
        expect(value.kind).toBe('vec'); 
    });

    it('decodes u64 and timepoint', () => {
        const u64Val = xdr.ScVal.scvU64(100n);
        const resU64 = decodeScVal(u64Val);
        expect(resU64.value).toEqual({ kind: 'int', type: 'u64', value: '100' });

        const timepointVal = xdr.ScVal.scvTimepoint(100n);
        const resTime = decodeScVal(timepointVal);
        expect(resTime.value).toEqual({ kind: 'timepoint', value: '100' });
    });

    it('decodes bytes with truncation', () => {
        const buf = Buffer.alloc(100, 1);
        const bytesVal = xdr.ScVal.scvBytes(buf);
        const res = decodeScVal(bytesVal);
        expect(res.value.kind).toBe('bytes');
        expect((res.value as any).truncated).toBe(true);
        expect((res.value as any).hex.length).toBe(128); // 64 bytes * 2
    });

    it('decodes long strings with truncation', () => {
        const str = 'A'.repeat(MAX_DISPLAY_STRING + 10);
        const strVal = xdr.ScVal.scvString(str);
        const res = decodeScVal(strVal);
        expect(res.value.kind).toBe('string');
        expect((res.value as any).truncated).toBe(true);
        expect((res.value as any).value.length).toBe(MAX_DISPLAY_STRING);
    });

    it('decodes addresses properly', () => {
        const account = Keypair.random().publicKey();
        const contract = 'CA' + '1'.repeat(54); // dummy contract ID length
        
        const accVal = Address.fromString(account).toScVal();
        const resAcc = decodeScVal(accVal);
        expect(resAcc.value.kind).toBe('address');
        expect((resAcc.value as any).addressType).toBe('account');

        const conVal = Address.contract(Buffer.alloc(32)).toScVal();
        const resCon = decodeScVal(conVal);
        expect(resCon.value.kind).toBe('address');
        expect((resCon.value as any).addressType).toBe('contract');
    });

    it('decodes maps and vecs without specs', () => {
        const mapVal = xdr.ScVal.scvMap([
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('key1'),
                val: xdr.ScVal.scvU32(10)
            })
        ]);
        const resMap = decodeScVal(mapVal);
        expect(resMap.value.kind).toBe('map');
        expect((resMap.value as any).entries[0].key.value).toBe('key1');
        expect((resMap.value as any).entries[0].value.value).toBe('10');

        const vecVal = xdr.ScVal.scvVec([xdr.ScVal.scvU32(1), xdr.ScVal.scvU32(2)]);
        const resVec = decodeScVal(vecVal);
        expect(resVec.value.kind).toBe('vec');
        expect((resVec.value as any).items.length).toBe(2);
    });

    it('catches decoding errors gracefully', () => {
        const badVal = { type: 'scvU32', toXDR: () => Buffer.from('bad') };
        // Missing value so native decoding fails
        const res = decodeScVal(badVal as any);
        expect(res.warnings[0].code).toBe('INTERNAL_ERROR');
        expect(res.value.kind).toBe('raw');
    });
});
