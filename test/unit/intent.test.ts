import { describe, it, expect } from 'vitest';
import { verifyIntent } from '../../src/intent.js';
import { Intent, Invocation, AuthEntry, BalanceDelta } from '../../src/types.js';

describe('intent verification', () => {
  const defaultInvocation: Invocation = {
    contractId: 'C123',
    functionName: 'transfer',
    args: [
      { name: 'to', typeName: 'address', value: { kind: 'address', value: 'G456', addressType: 'account' } },
      { name: 'amount', typeName: 'i128', value: { kind: 'int', type: 'i128', value: '100' } }
    ],
    specSource: 'wasm'
  };

  it('passes on matching intent', () => {
    const intent: Intent = {
      contractId: 'C123',
      functionName: 'transfer',
      args: { to: 'G456', amount: '100' }
    };
    const { warnings } = verifyIntent(intent, defaultInvocation, [], [], 'G123');
    expect(warnings).toEqual([]);
  });

  it('fails on swapped recipient address', () => {
    const intent: Intent = {
      contractId: 'C123',
      functionName: 'transfer',
      args: { to: 'G789', amount: '100' }
    };
    const { warnings } = verifyIntent(intent, defaultInvocation, [], [], 'G123');
    expect(warnings).toContainEqual(expect.objectContaining({ code: 'INTENT_MISMATCH', path: 'args.to' }));
  });

  it('fails on amount off by one', () => {
    const intent: Intent = {
      contractId: 'C123',
      functionName: 'transfer',
      args: { to: 'G456', amount: '101' }
    };
    const { warnings } = verifyIntent(intent, defaultInvocation, [], [], 'G123');
    expect(warnings).toContainEqual(expect.objectContaining({ code: 'INTENT_MISMATCH', path: 'args.amount' }));
  });

  it('fails on maxSpend exceeded', () => {
    const intent: Intent = {
      contractId: 'C123',
      functionName: 'transfer',
      maxSpend: { token: 'T1', account: 'G123', amount: '50' }
    };
    const effects: BalanceDelta[] = [
      { tokenContractId: 'T1', account: 'G123', delta: '-100' }
    ];
    const { warnings } = verifyIntent(intent, defaultInvocation, [], effects, 'G123');
    expect(warnings).toContainEqual(expect.objectContaining({ code: 'INTENT_SPEND_EXCEEDED' }));
  });
});
