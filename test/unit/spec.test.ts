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
    
    (rpc.Server as unknown as ReturnType<typeof vi.fn>).mockImplementation(function() { 
      return {
        getContractInstance: mockGetContractInstance,
        getContractWasmByContractId: mockGetContractWasmByContractId,
      }
    });

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

  it('uses injected spec if available', async () => {
    const contractId = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB';
    const opts = { rpcUrl: 'http://localhost', specs: { [contractId]: new Uint8Array(10) } };
    
    const res = await loadSpec(contractId, opts);
    expect(res.source).toBe('injected');
    expect(contract.Spec.fromWasm).toHaveBeenCalled();
  });

  it('handles invalid injected spec', async () => {
    const contractId = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB';
    const opts = { rpcUrl: 'http://localhost', specs: { [contractId]: new Uint8Array(10) } };
    
    (contract.Spec.fromWasm as any).mockImplementationOnce(() => { throw new Error('bad'); });
    const res = await loadSpec(contractId, opts);
    expect(res.source).toBe('none');
    expect(res.warnings[0]?.code).toBe('SPEC_UNAVAILABLE');
  });

  it('returns none if no RPC URL', async () => {
    const contractId = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB';
    const opts = { rpcUrl: '' };
    
    const res = await loadSpec(contractId, opts);
    expect(res.source).toBe('none');
  });

  it('handles SAC contracts natively and caches', async () => {
    const mockGetContractInstance = vi.fn().mockResolvedValue({
        executable: { switch: () => ({ name: 'contractExecutableToken' }) }
    });
    
    (rpc.Server as unknown as ReturnType<typeof vi.fn>).mockImplementation(function() {
      return {
        getContractInstance: mockGetContractInstance,
      };
    });

    const contractId = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC';
    const opts = { rpcUrl: 'http://localhost' };

    const res1 = await loadSpec(contractId, opts);
    expect(res1.source).toBe('sac-builtin');

    const res2 = await loadSpec(contractId, opts);
    expect(res2.source).toBe('sac-builtin');
    // second time it should just use cache, so network called once
    expect(mockGetContractInstance).toHaveBeenCalledTimes(1);
  });

  it('handles RPC errors', async () => {
    const mockGetContractInstance = vi.fn().mockRejectedValue(new Error('Network fail'));
    
    (rpc.Server as unknown as ReturnType<typeof vi.fn>).mockImplementation(function() {
      return {
        getContractInstance: mockGetContractInstance,
      };
    });

    const contractId = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD';
    const opts = { rpcUrl: 'http://localhost' };

    const res = await loadSpec(contractId, opts);
    expect(res.source).toBe('none');
    expect(res.warnings[0]?.code).toBe('SPEC_UNAVAILABLE');
  });

  it('handles empty Wasm response from RPC', async () => {
    const mockGetContractInstance = vi.fn().mockResolvedValue({ executable: { wasmHash: '123' } });
    const mockGetContractWasmByContractId = vi.fn().mockResolvedValue(null);
    
    (rpc.Server as unknown as ReturnType<typeof vi.fn>).mockImplementation(function() { 
      return {
        getContractInstance: mockGetContractInstance,
        getContractWasmByContractId: mockGetContractWasmByContractId,
      }
    });

    const contractId = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB';
    const opts = { rpcUrl: 'http://localhost' };

    const res = await loadSpec(contractId, opts);
    expect(res.source).toBe('none');
    expect(res.warnings[0]?.message).toContain('No Wasm returned');
  });

  it('handles Wasm response missing wasmBytes', async () => {
    const mockGetContractInstance = vi.fn().mockResolvedValue({ executable: { wasmHash: '123' } });
    const mockGetContractWasmByContractId = vi.fn().mockResolvedValue({}); // Missing wasmBytes
    
    (rpc.Server as unknown as ReturnType<typeof vi.fn>).mockImplementation(function() { 
      return {
        getContractInstance: mockGetContractInstance,
        getContractWasmByContractId: mockGetContractWasmByContractId,
      }
    });

    const contractId = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB';
    const opts = { rpcUrl: 'http://localhost' };

    const res = await loadSpec(contractId, opts);
    expect(res.source).toBe('none');
    expect(res.warnings[0]?.message).toContain('Wasm response missing wasmBytes');
  });

  it('handles contractExecutableWasm xdr type correctly', async () => {
    const mockGetContractInstance = vi.fn().mockResolvedValue({
        executable: {
            switch: () => ({ name: 'contractExecutableWasm' }),
            wasmHash: () => Buffer.from('1234')
        }
    });
    const mockGetContractWasmByContractId = vi.fn().mockResolvedValue(Buffer.alloc(10));
    
    (rpc.Server as unknown as ReturnType<typeof vi.fn>).mockImplementation(function() { 
      return {
        getContractInstance: mockGetContractInstance,
        getContractWasmByContractId: mockGetContractWasmByContractId,
      }
    });

    const contractId = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC';
    const opts = { rpcUrl: 'http://localhost' };
    const res = await loadSpec(contractId, opts);
    
    expect(res.source).toBe('wasm');
  });

  it('LRU cache correctly evicts old items and updates existing items', () => {
    const lru = _specCache as any;
    // We mocked its cache map in beforeEach, so let's set it up to test its actual properties
    const RealLruCache = lru.constructor;
    const testLru = new RealLruCache(2);
    
    // Add two items
    testLru.set('a', 1);
    testLru.set('b', 2);
    expect(testLru.cache.size).toBe(2);

    // Update 'a'
    testLru.set('a', 10);
    expect(testLru.get('a')).toBe(10);
    
    // Add third item, should evict 'b' since 'a' was recently accessed/updated
    testLru.set('c', 3);
    expect(testLru.get('b')).toBeUndefined();
    expect(testLru.get('a')).toBe(10);
    expect(testLru.get('c')).toBe(3);
  });

  it('computes fallback hash if wasmHash is not available', async () => {
    const mockGetContractInstance = vi.fn().mockResolvedValue({ executable: {} }); // No wasmHash
    const mockGetContractWasmByContractId = vi.fn().mockResolvedValue(Buffer.alloc(10));
    
    (rpc.Server as unknown as ReturnType<typeof vi.fn>).mockImplementation(function() { 
      return {
        getContractInstance: mockGetContractInstance,
        getContractWasmByContractId: mockGetContractWasmByContractId,
      }
    });

    const contractId = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC';
    const opts = { rpcUrl: 'http://localhost' };
    const res = await loadSpec(contractId, opts);
    
    expect(res.source).toBe('wasm');
  });
});
