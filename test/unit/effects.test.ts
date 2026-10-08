import { describe, it, expect } from 'vitest';
import { extractTokenEffects } from '../../src/effects.js';
import { xdr } from '@stellar/stellar-sdk';

describe('extractTokenEffects', () => {
    const fromStr = 'GB7D4G6B7D4G6B7D4G6B7D4G6B7D4G6B7D4G6B7D4G6B7D4G6B7D4G6B';
    const contractId = Buffer.alloc(32, 1);
    const from = Buffer.alloc(32, 2);
    const to = Buffer.alloc(32, 3);
    
    it('returns empty on undefined', () => {
        expect(extractTokenEffects(undefined).effects).toEqual([]);
    });

    it('ignores non-successful contract calls', () => {
        const events = [
            new xdr.DiagnosticEvent({
                inSuccessfulContractCall: false,
                event: new xdr.ContractEvent({
                    ext: xdr.ExtensionPoint.v0(),
                    contractId: undefined,
                    type: xdr.ContractEventType.system,
                    body: xdr.ContractEventBody.v0(new xdr.ContractEventV0({
                        topics: [],
                        data: xdr.ScVal.scvVoid()
                    }))
                })
            })
        ];
        const res = extractTokenEffects(events);
        expect(res.effects).toEqual([]);
    });

    it('extracts transfer events', () => {
        const topics = [
            xdr.ScVal.scvSymbol('transfer'),
            xdr.ScVal.scvAddress(xdr.ScAddress.scAddressTypeAccount(xdr.PublicKey.publicKeyTypeEd25519(from))),
            xdr.ScVal.scvAddress(xdr.ScAddress.scAddressTypeAccount(xdr.PublicKey.publicKeyTypeEd25519(to)))
        ];
        
        const data = xdr.ScVal.scvI128(new xdr.Int128Parts({ hi: 0n, lo: 100n }));

        const events = [
            new xdr.DiagnosticEvent({
                inSuccessfulContractCall: true,
                event: new xdr.ContractEvent({
                    ext: xdr.ExtensionPoint.v0(),
                    contractId: contractId,
                    type: xdr.ContractEventType.contract,
                    body: xdr.ContractEventBody.v0(new xdr.ContractEventV0({
                        topics: topics,
                        data: data
                    }))
                })
            })
        ];
        
        const res = extractTokenEffects(events);
        expect(res.effects.length).toBe(2);
        expect(res.effects[0].delta).toBe('-100');
        expect(res.effects[1].delta).toBe('100');
    });

    it('extracts mint events', () => {
        const topics = [
            xdr.ScVal.scvSymbol('mint'),
            xdr.ScVal.scvAddress(xdr.ScAddress.scAddressTypeAccount(xdr.PublicKey.publicKeyTypeEd25519(to)))
        ];
        const data = xdr.ScVal.scvI128(new xdr.Int128Parts({ hi: 0n, lo: 50n }));
        const events = [
            new xdr.DiagnosticEvent({
                inSuccessfulContractCall: true,
                event: new xdr.ContractEvent({
                    ext: xdr.ExtensionPoint.v0(),
                    contractId: contractId,
                    type: xdr.ContractEventType.contract,
                    body: xdr.ContractEventBody.v0(new xdr.ContractEventV0({ topics, data }))
                })
            })
        ];
        const res = extractTokenEffects(events);
        expect(res.effects.length).toBe(1);
        expect(res.effects[0].delta).toBe('50');
    });

    it('extracts burn events', () => {
        const topics = [
            xdr.ScVal.scvSymbol('burn'),
            xdr.ScVal.scvAddress(xdr.ScAddress.scAddressTypeAccount(xdr.PublicKey.publicKeyTypeEd25519(from)))
        ];
        const data = xdr.ScVal.scvI128(new xdr.Int128Parts({ hi: 0n, lo: 20n }));
        const events = [
            new xdr.DiagnosticEvent({
                inSuccessfulContractCall: true,
                event: new xdr.ContractEvent({
                    ext: xdr.ExtensionPoint.v0(),
                    contractId: contractId,
                    type: xdr.ContractEventType.contract,
                    body: xdr.ContractEventBody.v0(new xdr.ContractEventV0({ topics, data }))
                })
            })
        ];
        const res = extractTokenEffects(events);
        expect(res.effects.length).toBe(1);
        expect(res.effects[0].delta).toBe('-20');
    });

    it('extracts clawback events', () => {
        const topics = [
            xdr.ScVal.scvSymbol('clawback'),
            xdr.ScVal.scvAddress(xdr.ScAddress.scAddressTypeAccount(xdr.PublicKey.publicKeyTypeEd25519(from)))
        ];
        const data = xdr.ScVal.scvI128(new xdr.Int128Parts({ hi: 0n, lo: 30n }));
        const events = [
            new xdr.DiagnosticEvent({
                inSuccessfulContractCall: true,
                event: new xdr.ContractEvent({
                    ext: xdr.ExtensionPoint.v0(),
                    contractId: contractId,
                    type: xdr.ContractEventType.contract,
                    body: xdr.ContractEventBody.v0(new xdr.ContractEventV0({ topics, data }))
                })
            })
        ];
        const res = extractTokenEffects(events);
        expect(res.effects.length).toBe(1);
        expect(res.effects[0].delta).toBe('-30');
    });

    it('handles map amount shape', () => {
        const topics = [
            xdr.ScVal.scvSymbol('mint'),
            xdr.ScVal.scvAddress(xdr.ScAddress.scAddressTypeAccount(xdr.PublicKey.publicKeyTypeEd25519(to)))
        ];
        const data = xdr.ScVal.scvMap([
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('amount'),
                val: xdr.ScVal.scvI128(new xdr.Int128Parts({ hi: 0n, lo: 50n }))
            })
        ]);
        const events = [
            new xdr.DiagnosticEvent({
                inSuccessfulContractCall: true,
                event: new xdr.ContractEvent({
                    ext: xdr.ExtensionPoint.v0(),
                    contractId: contractId,
                    type: xdr.ContractEventType.contract,
                    body: xdr.ContractEventBody.v0(new xdr.ContractEventV0({ topics, data }))
                })
            })
        ];
        const res = extractTokenEffects(events);
        expect(res.effects.length).toBe(1);
        expect(res.effects[0].delta).toBe('50');
    });

    it('warns on unknown amount shape', () => {
        const topics = [
            xdr.ScVal.scvSymbol('mint'),
            xdr.ScVal.scvAddress(xdr.ScAddress.scAddressTypeAccount(xdr.PublicKey.publicKeyTypeEd25519(to)))
        ];
        const data = xdr.ScVal.scvVoid(); // bad shape
        const events = [
            new xdr.DiagnosticEvent({
                inSuccessfulContractCall: true,
                event: new xdr.ContractEvent({
                    ext: xdr.ExtensionPoint.v0(),
                    contractId: contractId,
                    type: xdr.ContractEventType.contract,
                    body: xdr.ContractEventBody.v0(new xdr.ContractEventV0({ topics, data }))
                })
            })
        ];
        const res = extractTokenEffects(events);
        expect(res.effects.length).toBe(0);
        expect(res.warnings).toContainEqual(expect.objectContaining({ code: 'EVENT_SHAPE_UNKNOWN' }));
    });
});
