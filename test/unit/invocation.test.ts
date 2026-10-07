import { describe, it, expect, vi, beforeEach } from 'vitest';
import { decodeInvocation } from '../../src/invocation.js';
import { xdr, Address, Keypair } from '@stellar/stellar-sdk';
import { loadSpec } from '../../src/spec.js';

vi.mock('../../src/spec.js', async () => {
  const actual: any = await vi.importActual('../../src/spec.js');
  return {
    ...actual,
    loadSpec: vi.fn(),
  };
});

const source = Keypair.random();
const contractId = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';

describe('decodeInvocation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('decodes invokeHostFunction without spec', async () => {
    (loadSpec as any).mockResolvedValue({ spec: null, source: 'none', warnings: [] });
    
    const op = new xdr.Operation({
      body: xdr.OperationBody.invokeHostFunction(
        new xdr.InvokeHostFunctionOp({
          hostFunction: xdr.HostFunction.hostFunctionTypeInvokeContract(
            new xdr.InvokeContractArgs({
              contractAddress: Address.fromString(contractId).toScAddress(),
              functionName: 'testFunc',
              args: [xdr.ScVal.scvU32(42)]
            })
          ),
          auth: []
        })
      )
    });
    
    const res = await decodeInvocation(op as any, { rpcUrl: '' });
    expect(res.invocation.functionName).toBe('testFunc');
    expect(res.invocation.specSource).toBe('none');
    expect(res.invocation.args[0].name).toBeNull();
    expect(res.invocation.args[0].value.kind).toBe('int');
  });

  it('decodes SAC functions', async () => {
    (loadSpec as any).mockResolvedValue({ spec: null, source: 'sac-builtin', warnings: [] });
    
    const op = new xdr.Operation({
      body: xdr.OperationBody.invokeHostFunction(
        new xdr.InvokeHostFunctionOp({
          hostFunction: xdr.HostFunction.hostFunctionTypeInvokeContract(
            new xdr.InvokeContractArgs({
              contractAddress: Address.fromString(contractId).toScAddress(),
              functionName: 'transfer',
              args: [
                 xdr.ScVal.scvAddress(Address.fromString(source.publicKey()).toScAddress()),
                 xdr.ScVal.scvAddress(Address.fromString(source.publicKey()).toScAddress()),
                 xdr.ScVal.scvI128(new xdr.Int128Parts({hi: xdr.Int64.fromString('0'), lo: xdr.Uint64.fromString('100')}))
              ]
            })
          ),
          auth: []
        })
      )
    });
    
    const res = await decodeInvocation(op as any, { rpcUrl: '' });
    expect(res.invocation.functionName).toBe('transfer');
    expect(res.invocation.specSource).toBe('sac-builtin');
    expect(res.invocation.args[0].name).toBe('from');
    expect(res.invocation.args[1].name).toBe('to');
    expect(res.invocation.args[2].name).toBe('amount');
  });

  it('decodes create contract deployment', async () => {
    const op = new xdr.Operation({
      body: xdr.OperationBody.invokeHostFunction(
        new xdr.InvokeHostFunctionOp({
          hostFunction: xdr.HostFunction.hostFunctionTypeCreateContract(
            new xdr.CreateContractArgs({
              contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(
                new xdr.ContractIdPreimageFromAddress({
                  address: Address.fromString(source.publicKey()).toScAddress(),
                  salt: Buffer.alloc(32, 1)
                })
              ),
              executable: xdr.ContractExecutable.contractExecutableStellarAsset()
            })
          ),
          auth: []
        })
      )
    });

    const res = await decodeInvocation(op as any, { rpcUrl: '' });
    expect(res.warnings).toContainEqual(expect.objectContaining({ code: 'CONTRACT_DEPLOYMENT' }));
    expect(res.invocation.functionName).toBe('Deploy contract');
    expect(res.invocation.args[0].name).toBe('deployer');
    expect(res.invocation.args[1].name).toBe('salt');
    expect(res.invocation.args[2].name).toBe('executable');
    expect((res.invocation.args[2].value as any).value).toBe('Stellar Asset');
  });
});
