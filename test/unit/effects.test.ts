import { describe, it, expect } from 'vitest';
import { extractTokenEffects } from '../../src/effects';
import { xdr } from '@stellar/stellar-sdk';

describe('extractTokenEffects', () => {
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
        const contractId = Buffer.alloc(32, 1);
        const from = Buffer.alloc(32, 2);
        const to = Buffer.alloc(32, 3);
        
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
});
