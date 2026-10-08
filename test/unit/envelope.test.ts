import { describe, it, expect } from 'vitest';
import { parseEnvelope } from '../../src/envelope.js';
import { TransactionBuilder, Networks, Keypair, Operation, Memo, Account, Asset, xdr, MuxedAccount, Address } from '@stellar/stellar-sdk';

const source = Keypair.random();
const account = new Account(source.publicKey(), '1');

describe('parseEnvelope', () => {
  it('rejects empty input', () => {
    const res = parseEnvelope('   ');
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.code).toBe('ENVELOPE_MALFORMED');
  });

  it('rejects oversized input', () => {
    const large = 'A'.repeat(200001) + '=';
    const res = parseEnvelope(large);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.code).toBe('ENVELOPE_TOO_LARGE');
  });

  it('rejects bad base64', () => {
    const res = parseEnvelope('not!base64?');
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.code).toBe('ENVELOPE_MALFORMED');
  });

  it('rejects truncated XDR', () => {
    const res = parseEnvelope('AAAAAA==');
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.code).toBe('ENVELOPE_MALFORMED');
  });

  it('rejects wrong passphrase', () => {
    const tx = new TransactionBuilder(account, { fee: '100', networkPassphrase: Networks.TESTNET })
      .addOperation(Operation.payment({ destination: source.publicKey(), asset: Asset.native(), amount: '10' }))
      .setTimeout(0)
      .build();
    const res = parseEnvelope(tx.toXDR(), Networks.TESTNET, Networks.PUBLIC);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.code).toBe('NETWORK_MISMATCH');
  });

  it('unwraps fee-bump transaction', () => {
    const inner = new TransactionBuilder(account, { fee: '100', networkPassphrase: Networks.TESTNET })
      .addOperation(Operation.payment({ destination: source.publicKey(), asset: Asset.native(), amount: '10' }))
      .setTimeout(0)
      .build();
    const feeBump = TransactionBuilder.buildFeeBumpTransaction(source, '200', inner, Networks.TESTNET);
    
    const res = parseEnvelope(feeBump.toXDR(), Networks.TESTNET);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.envelope.feeBump).toBeDefined();
      expect(res.envelope.feeBump?.fee).toBe('400');
      expect(res.envelope.feeBump?.feeSource).toBe(source.publicKey());
      expect(res.envelope.fee).toBe('100');
    }
  });

  it('returns warnings for classic-only operations', () => {
    const tx = new TransactionBuilder(account, { fee: '100', networkPassphrase: Networks.TESTNET })
      .addOperation(Operation.payment({ destination: source.publicKey(), asset: Asset.native(), amount: '10' }))
      .setTimeout(0)
      .build();
    const res = parseEnvelope(tx.toXDR(), Networks.TESTNET);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.warnings).toContainEqual(expect.objectContaining({ code: 'CLASSIC_OP_NOT_DECODED' }));
    }
  });

  it('rejects transactions with zero operations', () => {
    // This is a pre-generated valid TransactionEnvelope XDR base64 string that has an empty operations array (length = 0)
    const zeroOpsXdrBase64 = 'AAAAAgAAAABE0aqUsSMVcuqT+BDRi0dLNpFG3EZx9gDSBCSB5OHoaAAAAGQAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const res = parseEnvelope(zeroOpsXdrBase64, Networks.TESTNET);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.message).toBe('Transaction has no operations');
  });

  it('rejects transactions with multiple invokeHostFunction operations', () => {
    const invokeOp = Operation.invokeHostFunction({ func: xdr.HostFunction.hostFunctionTypeInvokeContract(new xdr.InvokeContractArgs({ contractAddress: new Address(source.publicKey()).toScAddress(), functionName: 'a', args: [] })), auth: [] });
    const tx = new TransactionBuilder(account, { fee: '100', networkPassphrase: Networks.TESTNET })
      .addOperation(invokeOp)
      .addOperation(invokeOp)
      .setTimeout(0)
      .build();
    const res = parseEnvelope(tx.toXDR(), Networks.TESTNET);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.message).toContain('Multiple invokeHostFunction operations not supported');
  });

  it('handles Muxed source account', () => {
    const muxedAcc = new MuxedAccount(account, '1234');
    const tx = new TransactionBuilder(muxedAcc, { fee: '100', networkPassphrase: Networks.TESTNET })
      .addOperation(Operation.payment({ destination: source.publicKey(), asset: Asset.native(), amount: '10' }))
      .setTimeout(0)
      .build();
    const res = parseEnvelope(tx.toXDR(), Networks.TESTNET);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.envelope.source).toContain('M');
      expect(res.envelope.source).toContain(source.publicKey());
    }
  });

  it('warns for expired time bounds', () => {
    const tx = new TransactionBuilder(account, { fee: '100', networkPassphrase: Networks.TESTNET, timebounds: { minTime: '0', maxTime: '1' } })
      .addOperation(Operation.payment({ destination: source.publicKey(), asset: Asset.native(), amount: '10' }))
      .build();
    const res = parseEnvelope(tx.toXDR(), Networks.TESTNET);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.warnings).toContainEqual(expect.objectContaining({ code: 'TX_EXPIRED' }));
    }
  });

  it('never throws for random string input', () => {
    for (let i = 0; i < 500; i++) {
      const randomStr = Math.random().toString(36).substring(2) + '===';
      expect(() => parseEnvelope(randomStr)).not.toThrow();
    }
  });
});
