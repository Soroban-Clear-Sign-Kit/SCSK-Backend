import { describe, it, expect, vi, beforeEach } from 'vitest';
import { decodeEvent } from '../../src/events.js';
import { xdr, Address, StrKey } from '@stellar/stellar-sdk';
import { loadSpec } from '../../src/spec.js';

vi.mock('../../src/spec.js', async () => {
  const actual: any = await vi.importActual('../../src/spec.js');
  return {
    ...actual,
    loadSpec: vi.fn(),
  };
});

const contractId = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';

describe('decodeEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('decodes a basic contract event without spec', async () => {
    (loadSpec as any).mockResolvedValue({ spec: null, source: 'none', warnings: [] });
    
    const event = new xdr.ContractEvent({
      ext: xdr.ExtensionPoint.v0(),
      contractId: StrKey.decodeContract(contractId),
      type: xdr.ContractEventType.contract,
      body: xdr.ContractEventBody.v0(new xdr.ContractEventV0({
        topics: [xdr.ScVal.scvSymbol('transfer'), xdr.ScVal.scvU32(1)],
        data: xdr.ScVal.scvString('hello')
      }))
    });

    const res = await decodeEvent(event, { rpcUrl: '' });
    expect(res.contractId).toBe(contractId);
    expect(res.type).toBe('contract');
    expect(res.specSource).toBe('none');
    expect(res.eventName).toBe('transfer');
    expect(res.topics.length).toBe(2);
    expect(res.data.kind).toBe('string');
  });

  it('handles unknown event types', async () => {
    (loadSpec as any).mockResolvedValue({ spec: null, source: 'none', warnings: [] });
    
    const event = new xdr.ContractEvent({
      ext: xdr.ExtensionPoint.v0(),
      contractId: null,
      type: xdr.ContractEventType.diagnostic,
      body: xdr.ContractEventBody.v0(new xdr.ContractEventV0({
        topics: [],
        data: xdr.ScVal.scvVoid()
      }))
    });

    const res = await decodeEvent(event, { rpcUrl: '' });
    expect(res.contractId).toBeNull();
    expect(res.type).toBe('diagnostic');
  });
});
