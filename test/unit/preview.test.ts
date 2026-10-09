import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildPreview } from '../../src/preview';
import * as envelope from '../../src/envelope';
import * as simulate from '../../src/simulate';
import * as invocation from '../../src/invocation';
import * as auth from '../../src/auth';
import * as effects from '../../src/effects';
import * as intent from '../../src/intent';
import * as tokens from '../../src/tokens';
import * as risk from '../../src/risk';
import * as summary from '../../src/summary';
import { rpc } from '@stellar/stellar-sdk';

vi.mock('../../src/envelope');
vi.mock('../../src/simulate');
vi.mock('../../src/invocation');
vi.mock('../../src/auth');
vi.mock('../../src/effects');
vi.mock('../../src/intent');
vi.mock('../../src/tokens');
vi.mock('../../src/risk');
vi.mock('../../src/summary');
vi.mock('@stellar/stellar-sdk', async () => {
    const actual = await vi.importActual('@stellar/stellar-sdk') as any;
    return {
        ...actual,
        rpc: {
            ...actual.rpc,
            Server: vi.fn().mockImplementation(() => ({
                getNetwork: vi.fn(),
                getLatestLedger: vi.fn()
            }))
        }
    };
});

describe('buildPreview', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns blocked on parse envelope failure', async () => {
        vi.mocked(envelope.parseEnvelope).mockReturnValue({
            success: false,
            error: { code: 'ENVELOPE_MALFORMED', message: 'malformed' }
        });

        const res = await buildPreview({ xdr: 'bad', rpcUrl: 'http://mock', networkPassphrase: 'test' });
        
        expect(res.risk).toBe('blocked');
        expect(res.simulation.status).toBe('skipped');
        expect(res.warnings).toEqual([{ code: 'ENVELOPE_MALFORMED', message: 'malformed', severity: 'blocked' }]);
    });

    it('returns blocked on network mismatch', async () => {
        vi.mocked(envelope.parseEnvelope).mockReturnValue({
            success: true,
            warnings: [{ code: 'NETWORK_MISMATCH', message: 'mismatch' }],
            envelope: { source: '', sequence: '', fee: '', operations: [] } as any,
            innerTransaction: { operations: [] } as any
        });

        const res = await buildPreview({ xdr: 'ok', rpcUrl: 'http://mock', networkPassphrase: 'test' });
        
        expect(res.risk).toBe('blocked');
        expect(res.simulation.status).toBe('skipped');
    });

    it('orchestrates successful flow', async () => {
        vi.mocked(envelope.parseEnvelope).mockReturnValue({
            success: true,
            warnings: [],
            envelope: { source: '', sequence: '', fee: '', operations: [] } as any,
            innerTransaction: { operations: [{ type: 'invokeHostFunction', func: {} }] } as any
        });

        vi.mocked(invocation.decodeInvocation).mockResolvedValue({
            invocation: { contractId: 'CC', functionName: 'test', args: [], specSource: 'none' },
            warnings: []
        });

        vi.mocked(simulate.simulateTransaction).mockResolvedValue({
            status: 'success',
            latestLedger: 100,
            events: [],
            auth: [],
            warnings: []
        });

        vi.mocked(effects.extractTokenEffects).mockReturnValue({
            effects: [], warnings: []
        });

        vi.mocked(tokens.resolveTokenMetadata).mockResolvedValue({ warnings: [] });

        vi.mocked(auth.decodeAuthEntries).mockResolvedValue({
            auth: [], warnings: []
        });

        vi.mocked(intent.verifyIntent).mockReturnValue({ warnings: [] });

        vi.mocked(summary.generateSummary).mockReturnValue(['All good']);

        vi.mocked(risk.computeRisk).mockReturnValue('ok');

        const res = await buildPreview({ xdr: 'ok', rpcUrl: 'http://mock', networkPassphrase: 'test' });
        
        expect(res.risk).toBe('ok');
        expect(res.simulation.status).toBe('success');
        expect(res.summary).toEqual(['All good']);
    });

    it('sets severities for warnings', async () => {
        vi.mocked(envelope.parseEnvelope).mockReturnValue({
            success: true,
            warnings: [],
            envelope: { source: '', sequence: '', fee: '', operations: [] } as any,
            innerTransaction: { operations: [{ type: 'invokeHostFunction', func: {} }] } as any
        });

        // Return a warning to trigger lines 142-144
        vi.mocked(invocation.decodeInvocation).mockResolvedValue({
            invocation: { contractId: 'CC', functionName: 'test', args: [], specSource: 'none' },
            warnings: [{ code: 'SPEC_UNAVAILABLE', message: 'test' }]
        });
        
        vi.mocked(simulate.simulateTransaction).mockResolvedValue({ status: 'unavailable', warnings: [] });
        vi.mocked(effects.extractTokenEffects).mockReturnValue({ effects: [], warnings: [] });
        vi.mocked(tokens.resolveTokenMetadata).mockResolvedValue({ warnings: [] });
        vi.mocked(auth.decodeAuthEntries).mockResolvedValue({ auth: [], warnings: [] });
        vi.mocked(intent.verifyIntent).mockReturnValue({ warnings: [] });
        vi.mocked(summary.generateSummary).mockReturnValue([]);
        vi.mocked(risk.computeRisk).mockReturnValue('review');

        const res = await buildPreview({ xdr: 'ok', rpcUrl: 'http://mock', networkPassphrase: 'test' });
        
        expect(res.warnings.length).toBe(1);
        expect(res.warnings[0]?.severity).toBe('review');
    });

    it('returns internal error on throw', async () => {
        vi.mocked(envelope.parseEnvelope).mockImplementation(() => {
            throw new Error('Something exploded');
        });

        const res = await buildPreview({ xdr: 'ok', rpcUrl: 'http://mock', networkPassphrase: 'test' });
        
        expect(res.risk).toBe('blocked');
        expect(res.warnings.length).toBe(1);
        expect(res.warnings[0]?.code).toBe('INTERNAL_ERROR');
        expect(res.warnings[0]?.message).toBe('Something exploded');
        expect(res.warnings[0]?.severity).toBe('blocked');
    });

    it('sets verified to false if getNetwork fails', async () => {
        vi.mocked(envelope.parseEnvelope).mockReturnValue({
            success: true,
            warnings: [],
            envelope: { source: '', sequence: '', fee: '', operations: [] } as any,
            innerTransaction: { operations: [{ type: 'invokeHostFunction', func: {} }] } as any
        });
        vi.mocked(invocation.decodeInvocation).mockResolvedValue({
            invocation: { contractId: 'CC', functionName: 'test', args: [], specSource: 'none' },
            warnings: []
        });
        vi.mocked(simulate.simulateTransaction).mockResolvedValue({ status: 'unavailable', warnings: [] });
        vi.mocked(effects.extractTokenEffects).mockReturnValue({ effects: [], warnings: [] });
        vi.mocked(tokens.resolveTokenMetadata).mockResolvedValue({ warnings: [] });
        vi.mocked(auth.decodeAuthEntries).mockResolvedValue({ auth: [], warnings: [] });
        vi.mocked(intent.verifyIntent).mockReturnValue({ warnings: [] });
        vi.mocked(summary.generateSummary).mockReturnValue([]);
        vi.mocked(risk.computeRisk).mockReturnValue('ok');

        const mockGetNetwork = vi.fn().mockRejectedValue(new Error('timeout'));
        vi.mocked(rpc.Server).mockImplementation(() => ({
            getNetwork: mockGetNetwork,
            getLatestLedger: vi.fn().mockResolvedValue({ sequence: 100 })
        }) as any);

        const res = await buildPreview({ xdr: 'ok', rpcUrl: 'http://mock', networkPassphrase: 'test' });
        
        expect(res.network.verified).toBe(false);
        expect(res.network.passphrase).toBe('test');
    });
});
