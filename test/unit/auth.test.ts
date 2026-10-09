import { describe, it, expect, vi, beforeEach } from 'vitest';
import { decodeAuthEntries } from '../../src/auth.js';
import * as spec from '../../src/spec.js';
import * as scval from '../../src/scval.js';
import { xdr, Address, Keypair } from '@stellar/stellar-sdk';

vi.mock('../../src/spec.js', async () => {
    const actual: any = await vi.importActual('../../src/spec.js');
    return {
        ...actual,
        loadSpec: vi.fn(),
    };
});
vi.mock('../../src/scval.js');

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
        expect(res.auth[0]?.credentials?.type).toBe('source-account');
        expect(res.auth[0]?.root?.kind).toBe('contract-fn');
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
                        signatureExpirationLedger: () => 90, // < 100 (expired)
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
            },
            {
                credentials: () => ({
                    switch: () => ({ name: 'sorobanCredentialsAddress' }),
                    address: () => ({
                        address: () => Address.fromString(keypair.publicKey()).toScAddress(),
                        nonce: () => 6789n,
                        signatureExpirationLedger: () => 105, // < 100 + 12 (expiring)
                        signature: () => ({ switch: () => ({ name: 'scvVoid' }) })
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
        expect(res.warnings).toContainEqual({ code: 'AUTH_EXPIRING', message: 'Signature expiration ledger is approaching' });
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
        expect(res.auth[0]?.root?.kind).toBe('create-contract');
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

    it('warns on unknown credentials', async () => {
        const entries = [
            {
                credentials: () => ({ switch: () => ({ name: 'unknownCredentials' }) }),
                rootInvocation: () => ({
                    function: () => ({ switch: () => ({ name: 'sorobanAuthorizedFunctionTypeCreateContractHostFn' }) }),
                    subInvocations: () => []
                })
            }
        ];
        const res = await decodeAuthEntries(entries, 100, { rpcUrl: '', networkPassphrase: '' });
        expect(res.warnings).toContainEqual({ code: 'INTERNAL_ERROR', message: 'Unknown credentials type' });
        expect(res.auth.length).toBe(0);
    });

    it('warns on extra contract', async () => {
        const entries = [
            {
                credentials: () => ({ switch: () => ({ name: 'sorobanCredentialsSourceAccount' }) }),
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
        const topLevelId = Address.contract(Buffer.alloc(32, 1)).toString();

        const res = await decodeAuthEntries(entries, 100, { rpcUrl: '', networkPassphrase: '', topLevelContractId: topLevelId });
        expect(res.warnings).toContainEqual(expect.objectContaining({ code: 'AUTH_EXTRA_CONTRACT' }));
    });

    it('decodes arguments using spec', async () => {
        const entries = [
            {
                credentials: () => ({ switch: () => ({ name: 'sorobanCredentialsSourceAccount' }) }),
                rootInvocation: () => ({
                    function: () => ({
                        switch: () => ({ name: 'sorobanAuthorizedFunctionTypeContractFn' }),
                        contractFn: () => ({
                            contractAddress: () => Address.contract(Buffer.alloc(32)).toScAddress(),
                            functionName: () => 'transfer',
                            args: () => [1, 2]
                        })
                    }),
                    subInvocations: () => []
                })
            }
        ];
        
        const mockSpec = {
            getFunc: (name: string) => ({
                inputs: [
                    { name: 'amount', type: { type: 'scSpecTypeU32' } },
                    { name: 'to', type: { type: 'scSpecTypeAddress' } }
                ]
            })
        };

        vi.mocked(spec.loadSpec).mockResolvedValue({ spec: mockSpec as any, source: 'wasm', warnings: [] });
        vi.mocked(scval.decodeScVal).mockReturnValue({ value: { kind: 'int', type: 'u32', value: '1' } as any, warnings: [] });

        const res = await decodeAuthEntries(entries, 100, { rpcUrl: '', networkPassphrase: '' });
        expect((res.auth[0]?.root as any)?.args?.[0]?.name).toBe('amount');
        expect((res.auth[0]?.root as any)?.args?.[1]?.name).toBe('to');
    });

    it('decodes arguments using sac-builtin', async () => {
        const entries = [
            {
                credentials: () => ({ switch: () => ({ name: 'sorobanCredentialsSourceAccount' }) }),
                rootInvocation: () => ({
                    function: () => ({
                        switch: () => ({ name: 'sorobanAuthorizedFunctionTypeContractFn' }),
                        contractFn: () => ({
                            contractAddress: () => Address.contract(Buffer.alloc(32)).toScAddress(),
                            functionName: () => 'transfer',
                            args: () => [1, 2, 3]
                        })
                    }),
                    subInvocations: () => []
                })
            }
        ];
        
        vi.mocked(spec.loadSpec).mockResolvedValue({ spec: null, source: 'sac-builtin', warnings: [] });
        vi.mocked(scval.decodeScVal).mockReturnValue({ value: { kind: 'int', type: 'u32', value: '1' } as any, warnings: [] });

        const res = await decodeAuthEntries(entries, 100, { rpcUrl: '', networkPassphrase: '' });
        expect((res.auth[0]?.root as any)?.args?.[0]?.name).toBe('from');
    });

    it('warns on node count limit exceeded', async () => {
        const buildWideInv = (breadth: number): any => {
            const subInvocations: any[] = [];
            for (let i = 0; i < breadth; i++) {
                subInvocations.push({
                    function: () => ({ switch: () => ({ name: 'scvVoid' }) }),
                    subInvocations: () => []
                });
            }
            return {
                function: () => ({ switch: () => ({ name: 'scvVoid' }) }),
                subInvocations: () => subInvocations
            };
        };
        const entries = [
            {
                credentials: () => ({ switch: () => ({ name: 'sorobanCredentialsSourceAccount' }) }),
                rootInvocation: () => buildWideInv(300) // exceeds MAX_AUTH_NODES=256
            }
        ];
        const res = await decodeAuthEntries(entries, 100, { rpcUrl: '', networkPassphrase: '' });
        expect(res.warnings).toContainEqual({ code: 'AUTH_TREE_TOO_LARGE', message: 'Maximum auth nodes exceeded' });
    });

    it('decodes arguments without spec', async () => {
        const entries = [
            {
                credentials: () => ({ switch: () => ({ name: 'sorobanCredentialsSourceAccount' }) }),
                rootInvocation: () => ({
                    function: () => ({
                        switch: () => ({ name: 'sorobanAuthorizedFunctionTypeContractFn' }),
                        contractFn: () => ({
                            contractAddress: () => Address.contract(Buffer.alloc(32)).toScAddress(),
                            functionName: () => 'someFunc',
                            args: () => [1, 2]
                        })
                    }),
                    subInvocations: () => []
                })
            }
        ];
        
        vi.mocked(spec.loadSpec).mockResolvedValue({ spec: null, source: 'wasm', warnings: [] }); 
        vi.mocked(scval.decodeScVal).mockReturnValue({ value: { kind: 'int', type: 'u32', value: '1' } as any, warnings: [] });

        const res = await decodeAuthEntries(entries, 100, { rpcUrl: '', networkPassphrase: '' });
        expect((res.auth[0]?.root as any)?.args?.[0]?.name).toBeNull();
    });
    it('returns AUTH_UNKNOWN_CONTRACT for missing spec on non-top-level contract', async () => {
        vi.mocked(spec.loadSpec).mockResolvedValue({ source: 'none', spec: null, warnings: [] });
        const res = await decodeAuthEntries([
            {
                credentials: { type: 'sorobanCredentialsSourceAccount' },
                rootInvocation: {
                    function: { type: 'sorobanAuthorizedFunctionTypeContractFn', contractFn: { contractAddress: Address.contract(Buffer.alloc(32, 2)).toScAddress(), functionName: 'test', args: [] } },
                    subInvocations: []
                }
            }
        ], 50, { topLevelContractId: Address.contract(Buffer.alloc(32, 1)).toString(), rpcUrl: '', networkPassphrase: '' });
        expect(res.warnings).toContainEqual(expect.objectContaining({ code: 'AUTH_UNKNOWN_CONTRACT' }));
    });

    it('skips children and does not return AUTH_UNKNOWN_CONTRACT for top-level contract', async () => {
        vi.mocked(spec.loadSpec).mockResolvedValue({ source: 'none', spec: null, warnings: [] });
        const res = await decodeAuthEntries([
            {
                credentials: { type: 'sorobanCredentialsSourceAccount' },
                rootInvocation: {
                    function: { type: 'sorobanAuthorizedFunctionTypeContractFn', contractFn: { contractAddress: Address.contract(Buffer.alloc(32, 1)).toScAddress(), functionName: 'test', args: [] } },
                    subInvocations: [
                        { function: { type: 'sorobanAuthorizedFunctionTypeContractFn', contractFn: { contractAddress: Address.contract(Buffer.alloc(32, 3)).toScAddress(), functionName: 'test', args: [] } }, subInvocations: [] }
                    ]
                }
            }
        ], 50, { topLevelContractId: Address.contract(Buffer.alloc(32, 1)).toString(), rpcUrl: '', networkPassphrase: '' });
        expect(res.warnings).not.toContainEqual(expect.objectContaining({ code: 'AUTH_UNKNOWN_CONTRACT' }));
        expect(res.auth[0]?.root?.children).toEqual([]); // children should be skipped!
    });
});
