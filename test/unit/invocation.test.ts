import { describe, it, expect, vi, beforeEach } from 'vitest';
import { decodeInvocation } from '../../src/invocation';
import * as spec from '../../src/spec';
import * as scval from '../../src/scval';
import { xdr, Address, Keypair } from '@stellar/stellar-sdk';

vi.mock('../../src/spec');
vi.mock('../../src/scval');

describe('decodeInvocation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('decodes classic operations with warnings', async () => {
        const op = { type: 'payment', func: null };
        const res = await decodeInvocation(op, { rpcUrl: '', networkPassphrase: '' });
        expect(res.warnings).toContainEqual({ code: 'CLASSIC_OP_NOT_DECODED', message: 'Operation is not invokeHostFunction' });
        expect(res.invocation.functionName).toBe('payment');
    });

    it('decodes sac-builtin with arg count mismatch', async () => {
        const keypair = Keypair.random();
        const op = {
            body: () => ({
                switch: () => ({ name: 'invokeHostFunction' }),
                invokeHostFunction: () => ({
                    hostFunction: () => ({
                        switch: () => ({ name: 'hostFunctionTypeInvokeContract' }),
                        invokeContract: () => ({
                            contractAddress: () => Address.fromString(keypair.publicKey()).toScAddress(),
                            functionName: 'transfer',
                            args: () => [1, 2, 3, 4] // Transfer takes 3 args
                        })
                    })
                })
            })
        };

        vi.mocked(spec.loadSpec).mockResolvedValue({ spec: null, source: 'sac-builtin', warnings: [] });
        vi.mocked(scval.decodeScVal).mockReturnValue({ value: { kind: 'int', type: 'u32', value: '1' } as any, warnings: [] });

        const res = await decodeInvocation(op, { rpcUrl: '', networkPassphrase: '' });
        expect(res.warnings).toContainEqual({ code: 'ARG_COUNT_MISMATCH', message: 'Argument count does not match SAC definition' });
        expect(res.invocation.args.length).toBe(4);
    });

    it('decodes spec with missing func matching', async () => {
        const keypair = Keypair.random();
        const op = {
            body: () => ({
                switch: () => ({ name: 'invokeHostFunction' }),
                invokeHostFunction: () => ({
                    hostFunction: () => ({
                        switch: () => ({ name: 'hostFunctionTypeInvokeContract' }),
                        invokeContract: () => ({
                            contractAddress: () => Address.fromString(keypair.publicKey()).toScAddress(),
                            functionName: 'unknown',
                            args: () => [1]
                        })
                    })
                })
            })
        };

        const mockSpec = {
            getFunc: (name: string) => undefined
        };

        vi.mocked(spec.loadSpec).mockResolvedValue({ spec: mockSpec as any, source: 'network', warnings: [] });
        vi.mocked(scval.decodeScVal).mockReturnValue({ value: { kind: 'int', type: 'u32', value: '1' } as any, warnings: [] });

        const res = await decodeInvocation(op, { rpcUrl: '', networkPassphrase: '' });
        expect(res.invocation.args.length).toBe(1);
        expect(res.invocation.args[0].name).toBeNull();
    });

    it('decodes spec with arg count mismatch and type mismatch', async () => {
        const keypair = Keypair.random();
        const op = {
            body: () => ({
                switch: () => ({ name: 'invokeHostFunction' }),
                invokeHostFunction: () => ({
                    hostFunction: () => ({
                        switch: () => ({ name: 'hostFunctionTypeInvokeContract' }),
                        invokeContract: () => ({
                            contractAddress: () => Address.fromString(keypair.publicKey()).toScAddress(),
                            functionName: 'swap',
                            args: () => [{ type: 'scvI32' }]
                        })
                    })
                })
            })
        };

        const mockSpec = {
            getFunc: (name: string) => ({
                inputs: [
                    { name: 'amount', type: { type: 'scSpecTypeU32' } },
                    { name: 'to', type: { type: 'scSpecTypeAddress' } }
                ]
            })
        };

        vi.mocked(spec.loadSpec).mockResolvedValue({ spec: mockSpec as any, source: 'network', warnings: [] });
        vi.mocked(scval.decodeScVal).mockReturnValue({ value: { kind: 'int', type: 'u32', value: '1' } as any, warnings: [] });

        const res = await decodeInvocation(op, { rpcUrl: '', networkPassphrase: '' });
        expect(res.warnings).toContainEqual({ code: 'ARG_COUNT_MISMATCH', message: 'Argument count does not match contract spec' });
        expect(res.warnings).toContainEqual({ code: 'ARG_TYPE_MISMATCH', message: 'Expected u32, got i32' });
        expect(res.invocation.args.length).toBe(1);
    });

    it('decodes create contract v1', async () => {
        const keypair = Keypair.random();
        const op = {
            body: () => ({
                switch: () => ({ name: 'invokeHostFunction' }),
                invokeHostFunction: () => ({
                    hostFunction: () => ({
                        switch: () => ({ name: 'hostFunctionTypeCreateContract' }),
                        value: {
                            contractIdPreimage: {
                                type: 'contractIdPreimageFromAddress',
                                value: { address: Address.fromString(keypair.publicKey()).toScAddress(), salt: Buffer.alloc(32) }
                            },
                            executable: {
                                type: 'contractExecutableWasm',
                                value: Buffer.alloc(32)
                            }
                        }
                    })
                })
            })
        };

        const res = await decodeInvocation(op, { rpcUrl: '', networkPassphrase: '' });
        expect(res.warnings).toContainEqual({ code: 'CONTRACT_DEPLOYMENT', message: 'Transaction deploys a contract' });
        expect(res.invocation.contractId).toBe('Deploy');
        expect(res.invocation.args[0].value.value).toBe(keypair.publicKey());
    });

    it('decodes create contract v2', async () => {
        const keypair = Keypair.random();
        const op = {
            body: () => ({
                switch: () => ({ name: 'invokeHostFunction' }),
                invokeHostFunction: () => ({
                    hostFunction: () => ({
                        switch: () => ({ name: 'hostFunctionTypeCreateContractV2' }),
                        createContractV2: () => ({
                            contractIdPreimage: () => ({
                                switch: () => ({ name: 'contractIdPreimageFromAddress' }),
                                value: () => ({
                                    address: () => Address.fromString(keypair.publicKey()).toScAddress(),
                                    salt: () => Buffer.alloc(32)
                                })
                            }),
                            executable: () => ({
                                switch: () => ({ name: 'contractExecutableStellarAsset' })
                            }),
                            constructorArgs: () => [{}]
                        })
                    })
                })
            })
        };

        vi.mocked(scval.decodeScVal).mockReturnValue({ value: { kind: 'int', type: 'u32', value: '1' } as any, warnings: [] });

        const res = await decodeInvocation(op, { rpcUrl: '', networkPassphrase: '' });
        expect(res.warnings).toContainEqual({ code: 'CONTRACT_DEPLOYMENT', message: 'Transaction deploys a contract' });
        expect(res.invocation.contractId).toBe('Deploy');
        expect(res.invocation.args[0].value.value).toBe(keypair.publicKey());
        expect(res.invocation.args[2].value.value).toBe('Stellar Asset');
        expect(res.invocation.args[3].name).toBe('constructorArgs');
    });

    it('decodes upload wasm', async () => {
        const op = {
            body: () => ({
                switch: () => ({ name: 'invokeHostFunction' }),
                invokeHostFunction: () => ({
                    hostFunction: () => ({
                        switch: () => ({ name: 'hostFunctionTypeUploadContractWasm' }),
                        value: Buffer.alloc(100)
                    })
                })
            })
        };

        const res = await decodeInvocation(op, { rpcUrl: '', networkPassphrase: '' });
        expect(res.warnings).toContainEqual({ code: 'WASM_UPLOAD', message: 'Transaction uploads contract code' });
        expect(res.invocation.contractId).toBe('Upload');
        expect(res.invocation.args[0].value.value).toBe('100');
    });

    it('handles unknown invoke function', async () => {
        const op = {
            body: () => ({
                switch: () => ({ name: 'invokeHostFunction' }),
                invokeHostFunction: () => ({
                    hostFunction: () => ({
                        switch: () => ({ name: 'unknown' })
                    })
                })
            })
        };

        const res = await decodeInvocation(op, { rpcUrl: '', networkPassphrase: '' });
        expect(res.invocation.contractId).toBe('');
        expect(res.invocation.functionName).toBe('Unknown');
    });
});
