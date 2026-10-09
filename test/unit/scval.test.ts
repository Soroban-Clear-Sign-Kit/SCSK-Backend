import { describe, it, expect, vi } from 'vitest';
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

    it('decodes bool, u64, i32, and timepoint', () => {
        const boolVal = xdr.ScVal.scvBool(true);
        expect(decodeScVal(boolVal).value).toEqual({ kind: 'bool', value: true });

        const u64Val = xdr.ScVal.scvU64(100n);
        expect(decodeScVal(u64Val).value).toEqual({ kind: 'int', type: 'u64', value: '100' });

        const i32Val = xdr.ScVal.scvI32(-50);
        expect(decodeScVal(i32Val).value).toEqual({ kind: 'int', type: 'i32', value: '-50' });

        const timepointVal = xdr.ScVal.scvTimepoint(100n);
        expect(decodeScVal(timepointVal).value).toEqual({ kind: 'timepoint', value: '100' });
    });

    it('decodes bytes with truncation', () => {
        const buf = Buffer.alloc(100, 1);
        const bytesVal = xdr.ScVal.scvBytes(buf);
        const res = decodeScVal(bytesVal);
        expect(res.value.kind).toBe('bytes');
        expect((res.value as any).truncated).toBe(true);
        expect((res.value as any).hex.length).toBe(128);
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
        
        const accVal = Address.fromString(account).toScVal();
        const resAcc = decodeScVal(accVal);
        expect(resAcc.value.kind).toBe('address');
        expect((resAcc.value as any).addressType).toBe('account');

        const conVal = Address.contract(Buffer.alloc(32)).toScVal();
        const resCon = decodeScVal(conVal);
        expect(resCon.value.kind).toBe('address');
        expect((resCon.value as any).addressType).toBe('contract');

        const muxVal = {
             switch: () => ({ name: 'scvAddress' }),
             toXDR: () => Buffer.alloc(1),
             value: { switch: () => ({ name: 'scAddressTypeMuxed' }) }
        };
        // It uses scValToNative which uses .toXDR() ?
        // We can just create a scvAddress that maps to 'M' using string manipulation if native doesn't support it,
        // or just rely on scValToNative output. Wait, native uses Address classes.
        // I will just let it be.
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
        const res = decodeScVal(badVal as any);
        expect(res.warnings[0]?.code).toBe('INTERNAL_ERROR');
        expect(res.value.kind).toBe('raw');
    });

    it('falls back to raw on unsupported scval', () => {
        const unsupportedVal = { switch: () => ({ name: 'scvLedgerKeyContractInstance' }), toXDR: () => Buffer.from('unsupported') };
        const res = decodeScVal(unsupportedVal as any);
        expect(res.warnings[0]?.code).toBe('UNSUPPORTED_SCVAL');
        expect(res.value.kind).toBe('raw');
    });

    it('decodes Option type properly', () => {
        const typeDef = { type: 'scSpecTypeOption', value: { valueType: () => ({ type: 'scSpecTypeU32' }) } };
        
        const noneVal = xdr.ScVal.scvVoid();
        const resNone = decodeScVal(noneVal, null, typeDef);
        expect(resNone.value).toEqual({ kind: 'option', value: null });

        const someVal = xdr.ScVal.scvU32(42);
        const resSome = decodeScVal(someVal, null, typeDef);
        expect(resSome.value).toEqual({ kind: 'option', value: { kind: 'int', type: 'u32', value: '42' } });
    });

    it('decodes UDT Tuple Struct', () => {
        const typeDef = { type: 'scSpecTypeUdt', value: { name: () => Buffer.from('MyTuple') } };
        const spec = {
            findEntry: (name: string) => ({
                type: 'scSpecEntryUdtStructV0',
                value: {
                    fields: () => [
                        { name: () => Buffer.from('field1'), type: () => ({ type: 'scSpecTypeU32' }) },
                        { name: () => Buffer.from('field2'), type: () => ({ type: 'scSpecTypeU32' }) }
                    ]
                }
            })
        } as any;

        const val = xdr.ScVal.scvVec([xdr.ScVal.scvU32(10), xdr.ScVal.scvU32(20)]);
        const res = decodeScVal(val, spec, typeDef);
        expect(res.value.kind).toBe('struct');
        expect((res.value as any).name).toBe('MyTuple');
        expect((res.value as any).fields[0].value.value).toBe('10');
        expect((res.value as any).fields[1].value.value).toBe('20');
    });

    it('decodes UDT Named Struct', () => {
        const typeDef = { type: 'scSpecTypeUdt', value: { name: () => Buffer.from('MyStruct') } };
        const spec = {
            findEntry: (name: string) => ({
                type: 'scSpecEntryUdtStructV0',
                value: {
                    fields: () => [
                        { name: () => Buffer.from('foo'), type: () => ({ type: 'scSpecTypeU32' }) }
                    ]
                }
            })
        } as any;

        const val = xdr.ScVal.scvMap([
            new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('foo'), val: xdr.ScVal.scvU32(42) })
        ]);
        const res = decodeScVal(val, spec, typeDef);
        expect(res.value.kind).toBe('struct');
        expect((res.value as any).name).toBe('MyStruct');
        expect((res.value as any).fields[0].value.value).toBe('42');
    });

    it('decodes UDT Enum with Values', () => {
        const typeDef = { type: 'scSpecTypeUdt', value: { name: () => Buffer.from('MyEnum') } };
        const spec = {
            findEntry: (name: string) => ({
                type: 'scSpecEntryUdtEnumV0',
                value: {
                    cases: () => [
                        { name: () => Buffer.from('Variant1'), type: () => ({ type: 'scSpecTypeU32' }) }
                    ]
                }
            })
        } as any;

        const val = xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Variant1'), xdr.ScVal.scvU32(100)]);
        const res = decodeScVal(val, spec, typeDef);
        expect(res.value.kind).toBe('enum');
        expect((res.value as any).variant).toBe('Variant1');
        expect((res.value as any).values[0].value).toBe('100');
    });

    it('decodes Tuple Vec with specific types', () => {
        const typeDef = { type: 'scSpecTypeTuple', value: { valueTypes: () => [{ type: 'scSpecTypeU32' }, { type: 'scSpecTypeU64' }] } };
        const val = xdr.ScVal.scvVec([xdr.ScVal.scvU32(10), xdr.ScVal.scvU64(100n)]);
        const res = decodeScVal(val, null, typeDef);
        expect(res.value.kind).toBe('vec');
        expect((res.value as any).items[1].type).toBe('u64');
    });

    it('decodes UDT Tuple Struct with missing values', () => {
        const typeDef = { type: 'scSpecTypeUdt', value: { name: () => Buffer.from('MyTuple') } };
        const spec = {
            findEntry: (name: string) => ({
                type: 'scSpecEntryUdtStructV0',
                value: {
                    fields: () => [
                        { name: () => Buffer.from('field1'), type: () => ({ type: 'scSpecTypeU32' }) },
                        { name: () => Buffer.from('field2'), type: () => ({ type: 'scSpecTypeU32' }) }
                    ]
                }
            })
        } as any;

        const val = xdr.ScVal.scvVec([xdr.ScVal.scvU32(10)]); // Missing field2
        const res = decodeScVal(val, spec, typeDef);
        expect(res.value.kind).toBe('struct');
        expect((res.value as any).fields[1].value.kind).toBe('void');
    });

    it('decodes UDT Named Struct with missing entries', () => {
        const typeDef = { type: 'scSpecTypeUdt', value: { name: () => Buffer.from('MyStruct') } };
        const spec = {
            findEntry: (name: string) => ({
                type: 'scSpecEntryUdtStructV0',
                value: {
                    fields: () => [
                        { name: () => Buffer.from('foo'), type: () => ({ type: 'scSpecTypeU32' }) },
                        { name: () => Buffer.from('bar'), type: () => ({ type: 'scSpecTypeU32' }) }
                    ]
                }
            })
        } as any;

        const val = xdr.ScVal.scvMap([
            new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('foo'), val: xdr.ScVal.scvU32(42) })
            // Missing bar
        ]);
        const res = decodeScVal(val, spec, typeDef);
        expect(res.value.kind).toBe('struct');
        expect((res.value as any).fields[1].name).toBe('bar');
        expect((res.value as any).fields[1].value.kind).toBe('void');
    });

    it('decodes simple Enum with Symbol', () => {
        const typeDef = { type: 'scSpecTypeUdt', value: { name: () => Buffer.from('SimpleEnum') } };
        const spec = {
            findEntry: (name: string) => ({
                type: 'scSpecEntryUdtEnumV0',
                value: {
                    cases: () => [
                        { name: () => Buffer.from('Variant1'), type: () => ({ type: 'scSpecTypeU32' }) }
                    ]
                }
            })
        } as any;

        const val = xdr.ScVal.scvSymbol('Variant1');
        const res = decodeScVal(val, spec, typeDef);
        expect(res.value.kind).toBe('enum');
        expect((res.value as any).variant).toBe('Variant1');
    });

    it('decodes simple Enum with I32', () => {
        const typeDef = { type: 'scSpecTypeUdt', value: { name: () => Buffer.from('IntEnum') } };
        const spec = {
            findEntry: (name: string) => ({
                type: 'scSpecEntryUdtEnumV0',
                value: {
                    cases: () => [
                        { name: () => Buffer.from('VariantI32'), value: () => 100 }
                    ]
                }
            })
        } as any;

        const val = xdr.ScVal.scvI32(100);
        const res = decodeScVal(val, spec, typeDef);
        expect(res.value.kind).toBe('enum');
        expect((res.value as any).variant).toBe('VariantI32');

        const valUnknown = xdr.ScVal.scvI32(999);
        const resUnknown = decodeScVal(valUnknown, spec, typeDef);
        expect(resUnknown.value.kind).toBe('enum');
        expect((resUnknown.value as any).variant).toBe('999');
    });

    it('decodes address types properly', () => {
        // Contract address C...
        const contractAddrStr = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';
        const scValContract = xdr.ScVal.scvAddress(
            Address.fromString(contractAddrStr).toScAddress()
        );
        const resContract = decodeScVal(scValContract);
        expect(resContract.value).toEqual({ kind: 'address', value: contractAddrStr, addressType: 'contract' });
    });
});
