import { describe, it, expect, vi, beforeEach } from 'vitest';
import { decodeAuthEntries } from '../../src/auth';
import * as spec from '../../src/spec';
import * as scval from '../../src/scval';
import { xdr, Address, Keypair } from '@stellar/stellar-sdk';

vi.mock('../../src/spec');
vi.mock('../../src/scval');

describe('decodeAuthEntries', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('decodes source account credentials', async () => {
        const entries = [
            {
                credentials: () => ({
                    switch: () => ({ name: 'sorobanCredentialsSourceAccount' })
                }),
                rootInvocation: () => ({
                    function: () => ({
                        switch: () => ({ name: 'sorobanAuthorizedFunctionTypeContractFn' }),
                        contractFn: () => ({
                            contractAddress: () => Address.contract(Buffer.alloc(32)).toScAddress(),
                            functionName: () => 'swap',
                            args: () => []
                        })
                    }),
                    subInvocations: () => []
                })
            }
        ];

        vi.mocked(spec.loadSpec).mockResolvedValue({ spec: null, source: 'none', warnings: [] });

        const res = await decodeAuthEntries(entries, 100, { rpcUrl: '', networkPassphrase: '' });
        expect(res.warnings).toEqual([{ code: 'AUTH_UNKNOWN_CONTRACT', message: `No spec found for auth contract ${Address.contract(Buffer.alloc(32)).toString()}` }]);
        expect(res.auth[0].credentials.type).toBe('source-account');
        expect(res.auth[0].root.kind).toBe('contract-fn');
    });

    it('decodes address credentials and checks expirations', async () => {
        const keypair = Keypair.random();
        const entries = [
            {
                credentials: () => ({
                    switch: () => ({ name: 'sorobanCredentialsAddress' }),
                    address: () => ({
                        address: () => Address.fromString(keypair.publicKey()).toScAddress(),
                        nonce: () => 12345n,
                        signatureExpirationLedger: () => 90, // < 100
                        signature: () => ({ switch: () => ({ name: 'scvVoid' }) }) // not signed
                    })
                }),
                rootInvocation: () => ({
                    function: () => ({
                        switch: () => ({ name: 'sorobanAuthorizedFunctionTypeContractFn' }),
                        contractFn: () => ({
                            contractAddress: () => Address.contract(Buffer.alloc(32)).toScAddress(),
                            functionName: () => 'swap',
                            args: () => []
                        })
                    }),
                    subInvocations: () => []
                })
            }
        ];

        vi.mocked(spec.loadSpec).mockResolvedValue({ spec: null, source: 'none', warnings: [] });

        const res = await decodeAuthEntries(entries, 100, { rpcUrl: '', networkPassphrase: '' });
        expect(res.warnings).toContainEqual({ code: 'AUTH_EXPIRED', message: 'Signature expiration ledger already passed' });
        expect(res.auth[0].credentials.type).toBe('address');
        expect((res.auth[0].credentials as any).nonce).toBe('12345');
        expect((res.auth[0].credentials as any).signed).toBe(false);
    });

    it('warns on duplicate nonce', async () => {
        const keypair = Keypair.random();
        const creds = {
            switch: () => ({ name: 'sorobanCredentialsAddress' }),
            address: () => ({
                address: () => Address.fromString(keypair.publicKey()).toScAddress(),
                nonce: () => 12345n,
                signatureExpirationLedger: () => 150, // >= 100
                signature: () => ({ switch: () => ({ name: 'scvVoid' }) })
            })
        };

        const rootInv = {
            function: () => ({
                switch: () => ({ name: 'sorobanAuthorizedFunctionTypeContractFn' }),
                contractFn: () => ({
                    contractAddress: () => Address.contract(Buffer.alloc(32)).toScAddress(),
                    functionName: () => 'swap',
                    args: () => []
                })
            }),
            subInvocations: () => []
        };

        const entries = [
            { credentials: () => creds, rootInvocation: () => rootInv },
            { credentials: () => creds, rootInvocation: () => rootInv }
        ];

        vi.mocked(spec.loadSpec).mockResolvedValue({ spec: null, source: 'none', warnings: [] });

        const res = await decodeAuthEntries(entries, 100, { rpcUrl: '', networkPassphrase: '' });
        expect(res.warnings).toContainEqual({ code: 'AUTH_DUPLICATE_NONCE', message: 'Duplicate nonce in authorization entries' });
    });

    it('decodes create contract function type', async () => {
        const entries = [
            {
                credentials: () => ({ switch: () => ({ name: 'sorobanCredentialsSourceAccount' }) }),
                rootInvocation: () => ({
                    function: () => ({ switch: () => ({ name: 'sorobanAuthorizedFunctionTypeCreateContractHostFn' }) }),
                    subInvocations: () => []
                })
            }
        ];
        const res = await decodeAuthEntries(entries, 100, { rpcUrl: '', networkPassphrase: '' });
        expect(res.warnings).toContainEqual({ code: 'AUTH_CREATES_CONTRACT', message: 'Create-contract node inside auth' });
        expect(res.auth[0].root.kind).toBe('create-contract');
    });

    it('warns on depth limits', async () => {
        const buildDeepInv = (depth: number): any => {
            if (depth === 0) return {
                function: () => ({ switch: () => ({ name: 'scvVoid' }) }),
                subInvocations: () => []
            };
            return {
                function: () => ({
                    switch: () => ({ name: 'sorobanAuthorizedFunctionTypeCreateContractHostFn' })
                }),
                subInvocations: () => [buildDeepInv(depth - 1)]
            };
        };

        const entries = [
            {
                credentials: () => ({ switch: () => ({ name: 'sorobanCredentialsSourceAccount' }) }),
                rootInvocation: () => buildDeepInv(50) // depth 50 will hit > MAX_AUTH_DEPTH
            }
        ];
        const res = await decodeAuthEntries(entries, 100, { rpcUrl: '', networkPassphrase: '' });
        expect(res.warnings).toContainEqual({ code: 'AUTH_TREE_TOO_LARGE', message: 'Maximum auth depth exceeded' });
    });
});
