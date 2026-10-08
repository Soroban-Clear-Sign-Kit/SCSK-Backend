import { xdr, Address } from '@stellar/stellar-sdk';
import { WarningCode } from './errors.js';
import { BalanceDelta } from './types.js';

export function extractTokenEffects(
  events: xdr.DiagnosticEvent[] | undefined
): { effects: BalanceDelta[]; warnings: { code: WarningCode; message: string }[] } {
  const warnings: { code: WarningCode; message: string }[] = [];
  const effects: BalanceDelta[] = [];

  if (!events) return { effects, warnings };

  const deltas: Record<string, Record<string, bigint>> = {}; // contractId -> account -> delta

  for (const diagnosticEvent of events) {
    const isSuccess = diagnosticEvent.inSuccessfulContractCall;
    if (!isSuccess) continue;
    const event: any = diagnosticEvent.event;
    
    const eventType: any = typeof event.type === 'function' ? event.type() : event.type;
    if (eventType.name !== 'contractEventTypeContract' && eventType.value !== 0) continue; // contract = 0

    const eventContractId = typeof event.contractId === 'function' ? event.contractId() : event.contractId;
    const contractId = eventContractId ? Address.fromScAddress(eventContractId).toString() : null;
    if (!contractId) continue;

    const eventBody = typeof event.body === 'function' ? event.body() : event.body;
    const bodyValue = typeof eventBody.value === 'function' ? eventBody.value() : (eventBody.v0 || eventBody.value);
    
    if (!bodyValue || !bodyValue.topics || !bodyValue.data) continue;
    const topics = (typeof bodyValue.topics === 'function' ? bodyValue.topics() : bodyValue.topics) as xdr.ScVal[];
    if (topics.length < 1) continue;

    const topic0: any = topics[0];
    const topic0Type = typeof topic0.switch === 'function' ? topic0.switch().name : topic0.type;
    if (topic0Type !== 'scvSymbol') continue;
    const rawSym = typeof topic0.sym === 'function' ? topic0.sym() : topic0.sym;
    const action = rawSym ? rawSym.toString() : '';

    let from: string | null = null;
    let to: string | null = null;
    let amount: bigint | null = null;

    if (action === 'transfer' && topics.length >= 3) {
      from = extractAddress(topics[1]);
      to = extractAddress(topics[2]);
      amount = extractAmount(typeof bodyValue.data === 'function' ? bodyValue.data() : bodyValue.data, warnings);
    } else if (action === 'mint' && topics.length >= 2) {
      to = extractAddress(topics[1]);
      amount = extractAmount(typeof bodyValue.data === 'function' ? bodyValue.data() : bodyValue.data, warnings);
    } else if (action === 'burn' && topics.length >= 2) {
      from = extractAddress(topics[1]);
      amount = extractAmount(typeof bodyValue.data === 'function' ? bodyValue.data() : bodyValue.data, warnings);
    } else if (action === 'clawback' && topics.length >= 2) {
      from = extractAddress(topics[1]);
      amount = extractAmount(typeof bodyValue.data === 'function' ? bodyValue.data() : bodyValue.data, warnings);
    }

    if (amount !== null) {
      if (!deltas[contractId]) deltas[contractId] = {};
      
      if (from) {
        deltas[contractId][from] = (deltas[contractId][from] || 0n) - amount;
      }
      if (to) {
        deltas[contractId][to] = (deltas[contractId][to] || 0n) + amount;
      }
    }
  }

  for (const contractId in deltas) {
    for (const account in deltas[contractId]) {
      const delta = deltas[contractId][account];
      if (delta !== 0n) {
        effects.push({
          tokenContractId: contractId,
          account,
          delta: delta!.toString()
        });
      }
    }
  }

  return { effects, warnings };
}

function extractAddress(scval: xdr.ScVal | undefined): string | null {
  if (!scval) return null;
  const val: any = scval;
  if (val.switch().name === 'scvAddress') {
    return Address.fromScAddress(val.address()).toString();
  }
  return null;
}

function extractAmount(data: xdr.ScVal | undefined, warnings: { code: WarningCode; message: string }[]): bigint | null {
  if (!data) return null;
  const val: any = data;
  const type = val.switch().name;
  if (type === 'scvI128') {
    const parts = val.i128();
    const lo = BigInt(parts.lo().toString());
    const hi = BigInt(parts.hi().toString());
    return (hi << 64n) | lo;
  } else if (type === 'scvMap') {
    const entries = val.map();
    if (entries) {
      for (const entry of entries) {
        const key: any = typeof entry.key === 'function' ? entry.key() : entry.key;
        if (key.switch().name === 'scvSymbol' && key.sym().toString() === 'amount') {
          return extractAmount(typeof entry.val === 'function' ? entry.val() : entry.val, warnings);
        }
      }
    }
  }
  
  warnings.push({ code: 'EVENT_SHAPE_UNKNOWN', message: 'Unknown shape for token amount data' });
  return null;
}
