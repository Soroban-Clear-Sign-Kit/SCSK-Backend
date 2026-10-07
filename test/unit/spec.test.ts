import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadSpec, _specCache, _wasmHashCache } from '../../src/spec.js';
import { rpc, contract } from '@stellar/stellar-sdk';

vi.mock('@stellar/stellar-sdk', async () => {
  const actual: any = await vi.importActual('@stellar/stellar-sdk');
  return {
    ...actual,
    rpc: {
      ...actual.rpc,
      Server: vi.fn(),
    },
    contract: {
      ...actual.contract,
      Spec: {
        fromWasm: vi.fn(() => ({})), // Mock Spec instance
      },
    }
  };
});

describe('spec caching', () => {
  beforeEach(() => {
    // hack to clear caches for test
    (_specCache as any).cache = new Map();
    (_wasmHashCache as any).cache = new Map();
    vi.clearAllMocks();
  });

  it('fetches once and uses cache for subsequent calls', async () => {
    const mockWasm = Buffer.alloc(10);
    const mockGetContractInstance = vi.fn().mockResolvedValue({ executable: { wasmHash: '123' } });
    const mockGetContractWasmByContractId = vi.fn().mockResolvedValue(mockWasm);
    
    (rpc.Server as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      getContractInstance: mockGetContractInstance,
      getContractWasmByContractId: mockGetContractWasmByContractId,
    }));

    const contractId = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB';
    const opts = { rpcUrl: 'http://localhost' };

    const res1 = await loadSpec(contractId, opts);
    expect(res1.source).toBe('wasm');
    expect(mockGetContractInstance).toHaveBeenCalledTimes(1);
    expect(mockGetContractWasmByContractId).toHaveBeenCalledTimes(1);

    const res2 = await loadSpec(contractId, opts);
    expect(res2.source).toBe('wasm');
    // should not have called network again
    expect(mockGetContractInstance).toHaveBeenCalledTimes(1);
    expect(mockGetContractWasmByContractId).toHaveBeenCalledTimes(1);
  });
});
