import { describe, it, expect, vi } from 'vitest';
import { simulateTransaction } from '../../src/simulate';
import { TransactionBuilder, Networks, rpc, Account, Keypair, xdr, Operation, Asset } from '@stellar/stellar-sdk';

vi.mock('@stellar/stellar-sdk', async (importOriginal) => {
    const actual: any = await importOriginal();
    return {
        ...actual,
        rpc: {
            ...actual.rpc,
            Server: class MockServer {
                simulateTransaction(tx: any) {
                    if ((tx as any)._throw) {
                        return Promise.reject(new Error('RPC Timeout'));
                    }
                    if ((tx as any)._timeout) {
                        return new Promise(resolve => setTimeout(resolve, 20000));
                    }
                    return Promise.resolve((tx as any)._mockSim);
                }
            }
        }
    };
});

describe('simulateTransaction', () => {
    const account = new Account(Keypair.random().publicKey(), '0');
    
    it('returns unavailable on error', async () => {
        const tx = new TransactionBuilder(account, { fee: '100', networkPassphrase: Networks.TESTNET })
            .setTimeout(10)
            .build();
        (tx as any)._throw = true;
        
        const sim = await simulateTransaction(tx, { rpcUrl: 'http://mock', networkPassphrase: Networks.TESTNET });
        expect(sim.status).toBe('unavailable');
        expect(sim.warnings[0].code).toBe('SIMULATION_UNAVAILABLE');
    });

    it('returns failed on simulation error', async () => {
        const tx = new TransactionBuilder(account, { fee: '100', networkPassphrase: Networks.TESTNET })
            .setTimeout(10)
            .build();
        (tx as any)._mockSim = { error: 'Failed', _isSimulationError: true };
        
        // Mocking the rpc.Api functions because they rely on object shape
        const isSimulationErrorMock = vi.spyOn(rpc.Api, 'isSimulationError').mockReturnValue(true);
        
        const sim = await simulateTransaction(tx, { rpcUrl: 'http://mock', networkPassphrase: Networks.TESTNET });
        expect(sim.status).toBe('failed');
        expect(sim.error).toBe('Failed');
        expect(sim.warnings[0].code).toBe('SIMULATION_FAILED');
        
        isSimulationErrorMock.mockRestore();
    });

    it('returns needs-restore on restore', async () => {
        const tx = new TransactionBuilder(account, { fee: '100', networkPassphrase: Networks.TESTNET })
            .setTimeout(10)
            .build();
        (tx as any)._mockSim = { restore: true };
        
        const isSimulationErrorMock = vi.spyOn(rpc.Api, 'isSimulationError').mockReturnValue(false);
        const isSimulationRestoreMock = vi.spyOn(rpc.Api, 'isSimulationRestore').mockReturnValue(true);
        
        const sim = await simulateTransaction(tx, { rpcUrl: 'http://mock', networkPassphrase: Networks.TESTNET });
        expect(sim.status).toBe('needs-restore');
        expect(sim.warnings[0].code).toBe('RESTORE_REQUIRED');
        
        isSimulationErrorMock.mockRestore();
        isSimulationRestoreMock.mockRestore();
    });

    it('returns success on success with high fee warning', async () => {
        const tx = new TransactionBuilder(account, { fee: '1000000000', networkPassphrase: Networks.TESTNET })
            .addOperation(Operation.payment({ destination: account.accountId(), asset: Asset.native(), amount: '10' }))
            .setTimeout(10)
            .build();
        (tx as any)._mockSim = { minResourceFee: '10', latestLedger: 100, events: [] };
        
        const isSimulationErrorMock = vi.spyOn(rpc.Api, 'isSimulationError').mockReturnValue(false);
        const isSimulationRestoreMock = vi.spyOn(rpc.Api, 'isSimulationRestore').mockReturnValue(false);
        const isSimulationSuccessMock = vi.spyOn(rpc.Api, 'isSimulationSuccess').mockReturnValue(true);
        
        const sim = await simulateTransaction(tx, { rpcUrl: 'http://mock', networkPassphrase: Networks.TESTNET, feeWarningMultiplier: 2 });
        expect(sim.status).toBe('success');
        expect(sim.warnings.some(w => w.code === 'FEE_UNUSUALLY_HIGH')).toBe(true);
        
        isSimulationErrorMock.mockRestore();
        isSimulationRestoreMock.mockRestore();
        isSimulationSuccessMock.mockRestore();
    });
});
