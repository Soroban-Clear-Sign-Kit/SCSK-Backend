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
    if (!diagnosticEvent.inSuccessfulContractCall()) continue;
    const event = diagnosticEvent.event();
    if (event.type().name !== 'contractEventTypeContract' && event.type().value !== 0) continue; // contract = 0

    const contractId = event.contractId() ? Address.fromScAddress(event.contractId()!).toString() : null;
    if (!contractId) continue;

    const body = event.body().value() as any;
    if (!body || !body.topics || !body.data) continue;

    const topics = body.topics() as xdr.ScVal[];
    if (topics.length < 1) continue;

    const topic0 = topics[0];
    if (topic0.switch().name !== 'scvSymbol') continue;
    const action = topic0.sym().toString();

    let from: string | null = null;
    let to: string | null = null;
    let amount: bigint | null = null;

    if (action === 'transfer' && topics.length >= 3) {
      from = extractAddress(topics[1]);
      to = extractAddress(topics[2]);
      amount = extractAmount(body.data(), warnings);
    } else if (action === 'mint' && topics.length >= 2) {
      to = extractAddress(topics[1]);
      amount = extractAmount(body.data(), warnings);
    } else if (action === 'burn' && topics.length >= 2) {
      from = extractAddress(topics[1]);
      amount = extractAmount(body.data(), warnings);
    } else if (action === 'clawback' && topics.length >= 2) {
      from = extractAddress(topics[1]);
      amount = extractAmount(body.data(), warnings);
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
          delta: delta.toString()
        });
      }
    }
  }

  return { effects, warnings };
}

function extractAddress(scval: xdr.ScVal): string | null {
  if (scval.switch().name === 'scvAddress') {
    return Address.fromScAddress(scval.address()).toString();
  }
  return null;
}

function extractAmount(data: xdr.ScVal, warnings: { code: WarningCode; message: string }[]): bigint | null {
  const type = data.switch().name;
  if (type === 'scvI128') {
    const parts = data.i128();
    const lo = BigInt(parts.lo().toString());
    const hi = BigInt(parts.hi().toString());
    return (hi << 64n) | lo;
  } else if (type === 'scvMap') {
    const entries = data.map();
    if (entries) {
      for (const entry of entries) {
        const key = entry.key();
        if (key.switch().name === 'scvSymbol' && key.sym().toString() === 'amount') {
          return extractAmount(entry.val(), warnings);
        }
      }
    }
  }
  
  warnings.push({ code: 'EVENT_SHAPE_UNKNOWN', message: 'Unknown shape for token amount data' });
  return null;
}
