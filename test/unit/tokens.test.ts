import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveTokenMetadata, formatAmount } from '../../src/tokens';
import { rpc, xdr, Address, Keypair } from '@stellar/stellar-sdk';
import { BalanceDelta } from '../../src/types';

describe('formatAmount', () => {
    it('formats amount correctly with 0 decimals', () => {
        expect(formatAmount('12345', 0)).toBe('12345');
    });

    it('formats amount correctly with decimals', () => {
        expect(formatAmount('12345', 2)).toBe('123.45');
        expect(formatAmount('-12345', 2)).toBe('-123.45');
    });

    it('handles padding', () => {
        expect(formatAmount('5', 2)).toBe('0.05');
        expect(formatAmount('-5', 2)).toBe('-0.05');
    });

    it('strips trailing zeros', () => {
        expect(formatAmount('12300', 2)).toBe('123');
        expect(formatAmount('12340', 2)).toBe('123.4');
    });
});

describe('resolveTokenMetadata', () => {
    let mockSimulate: any;

    beforeEach(() => {
        vi.clearAllMocks();
        mockSimulate = vi.spyOn(rpc.Server.prototype, 'simulateTransaction');
    });

    it('resolves token metadata and updates effects', async () => {
        // mock decimals call
        mockSimulate.mockResolvedValueOnce({
            result: { retval: xdr.ScVal.scvU32(7) },
            events: [],
            latestLedger: 100
        } as any);

        // mock symbol call
        mockSimulate.mockResolvedValueOnce({
            result: { retval: xdr.ScVal.scvSymbol('USDC') },
            events: [],
            latestLedger: 100
        } as any);

        vi.spyOn(rpc.Api, 'isSimulationSuccess').mockReturnValue(true);

        const sourceAccount = Keypair.random().publicKey();
        const contractId = Address.contract(Buffer.alloc(32, 1)).toString();
        const effects: BalanceDelta[] = [
            { tokenContractId: contractId, account: sourceAccount, delta: '10000000' }
        ];

        const res = await resolveTokenMetadata(effects, {
            rpcUrl: 'https://mock',
            networkPassphrase: 'test',
            sourceAccount: sourceAccount
        });

        expect(res.warnings).toEqual([]);
        expect(effects[0].symbol).toBe('USDC');
        expect(effects[0].decimals).toBe(7);
        expect(effects[0].formatted).toBe('1');
        
        vi.spyOn(rpc.Api, 'isSimulationSuccess').mockRestore();
    });

    it('resolves symbol when returned as string instead of symbol', async () => {
        mockSimulate.mockResolvedValueOnce({
            result: { retval: xdr.ScVal.scvU32(2) },
            events: [],
            latestLedger: 100
        } as any);

        mockSimulate.mockResolvedValueOnce({
            result: { retval: xdr.ScVal.scvString('USD') },
            events: [],
            latestLedger: 100
        } as any);

        vi.spyOn(rpc.Api, 'isSimulationSuccess').mockReturnValue(true);

        const sourceAccount = Keypair.random().publicKey();
        const contractId = Address.contract(Buffer.alloc(32, 2)).toString();
        const effects: BalanceDelta[] = [
            { tokenContractId: contractId, account: sourceAccount, delta: '100' }
        ];

        const res = await resolveTokenMetadata(effects, {
            rpcUrl: 'https://mock',
            networkPassphrase: 'test',
            sourceAccount: sourceAccount
        });

        expect(effects[0].symbol).toBe('USD');
        vi.spyOn(rpc.Api, 'isSimulationSuccess').mockRestore();
    });

    it('adds warning on simulation error', async () => {
        mockSimulate.mockRejectedValueOnce(new Error('Network error'));
        vi.spyOn(rpc.Api, 'isSimulationSuccess').mockReturnValue(false);

        const sourceAccount = Keypair.random().publicKey();
        const contractId = Address.contract(Buffer.alloc(32, 3)).toString();
        const effects: BalanceDelta[] = [
            { tokenContractId: contractId, account: sourceAccount, delta: '100' }
        ];

        const res = await resolveTokenMetadata(effects, {
            rpcUrl: 'https://mock',
            networkPassphrase: 'test',
            sourceAccount: sourceAccount
        });

        expect(res.warnings.length).toBe(1);
        expect(res.warnings[0].code).toBe('TOKEN_METADATA_UNAVAILABLE');
        expect(effects[0].symbol).toBeUndefined();
        
        vi.spyOn(rpc.Api, 'isSimulationSuccess').mockRestore();
    });

    it('uses cached metadata on second call', async () => {
        // Only mock once, if it calls again it'll fail or return undefined
        mockSimulate.mockResolvedValueOnce({
            result: { retval: xdr.ScVal.scvU32(1) },
            events: [],
            latestLedger: 100
        } as any);
        mockSimulate.mockResolvedValueOnce({
            result: { retval: xdr.ScVal.scvSymbol('CACHED') },
            events: [],
            latestLedger: 100
        } as any);
        vi.spyOn(rpc.Api, 'isSimulationSuccess').mockReturnValue(true);

        const sourceAccount = Keypair.random().publicKey();
        const contractId = Address.contract(Buffer.alloc(32, 4)).toString();
        const effects1: BalanceDelta[] = [{ tokenContractId: contractId, account: sourceAccount, delta: '10' }];
        const effects2: BalanceDelta[] = [{ tokenContractId: contractId, account: sourceAccount, delta: '20' }];

        await resolveTokenMetadata(effects1, { rpcUrl: 'https://mock', networkPassphrase: 'test', sourceAccount: sourceAccount });
        await resolveTokenMetadata(effects2, { rpcUrl: 'https://mock', networkPassphrase: 'test', sourceAccount: sourceAccount });

        expect(mockSimulate).toHaveBeenCalledTimes(2); // Only called for the first resolution!
        expect(effects2[0].symbol).toBe('CACHED');
        
        vi.spyOn(rpc.Api, 'isSimulationSuccess').mockRestore();
    });
});
