import { xdr, Address, StrKey } from '@stellar/stellar-sdk';
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
    if (eventType.name !== 'contractEventTypeContract' && eventType.name !== 'contract' && eventType.value !== 1) continue;

    const eventContractIdRaw = typeof event.contractId === 'function' ? event.contractId() : event.contractId;
    let eventContractId: Buffer | Uint8Array | null = null;
    if (eventContractIdRaw) {
      if (Buffer.isBuffer(eventContractIdRaw) || eventContractIdRaw instanceof Uint8Array) {
        eventContractId = eventContractIdRaw;
      } else if (eventContractIdRaw.value && (Buffer.isBuffer(eventContractIdRaw.value) || eventContractIdRaw.value instanceof Uint8Array)) {
        eventContractId = eventContractIdRaw.value;
      } else if (typeof eventContractIdRaw.toString === 'function') {
        const hex = eventContractIdRaw.toString('hex');
        if (hex && hex.length === 64) eventContractId = Buffer.from(hex, 'hex');
      }
    }
    
    let contractId: string | null = null;
    if (eventContractId) {
      try {
        contractId = StrKey.encodeContract(Buffer.from(eventContractId));
      } catch (err) {
        console.error('encodeContract error. eventContractId:', eventContractId, err);
      }
    }
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
      const contractDeltas = (deltas[contractId] ??= {});

      if (from) {
        contractDeltas[from] = (contractDeltas[from] ?? 0n) - amount;
      }
      if (to) {
        contractDeltas[to] = (contractDeltas[to] ?? 0n) + amount;
      }
    }
  }

  for (const [contractId, contractDeltas] of Object.entries(deltas)) {
    for (const [account, delta] of Object.entries(contractDeltas)) {
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

function extractAddress(scval: xdr.ScVal | undefined): string | null {
  if (!scval) return null;
  const val: any = scval;
  const type = typeof val.switch === 'function' ? val.switch().name : val.type;
  if (type === 'scvAddress') {
    const address = typeof val.address === 'function' ? val.address() : val.address;
    return Address.fromScAddress(address).toString();
  }
  return null;
}

function extractAmount(data: xdr.ScVal | undefined, warnings: { code: WarningCode; message: string }[]): bigint | null {
  if (!data) return null;
  const val: any = data;
  const type = typeof val.switch === 'function' ? val.switch().name : val.type;
  if (type === 'scvI128') {
    const parts = typeof val.i128 === 'function' ? val.i128() : val.i128;
    const lo = BigInt((typeof parts.lo === 'function' ? parts.lo() : parts.lo).toString());
    const hi = BigInt((typeof parts.hi === 'function' ? parts.hi() : parts.hi).toString());
    return (hi << 64n) | lo;
  } else if (type === 'scvMap') {
    const entries = typeof val.map === 'function' ? val.map() : val.map;
    if (entries) {
      for (const entry of entries) {
        const key: any = typeof entry.key === 'function' ? entry.key() : entry.key;
        const keyType = typeof key.switch === 'function' ? key.switch().name : key.type;
        const keySym = typeof key.sym === 'function' ? key.sym() : key.sym;
        if (keyType === 'scvSymbol' && keySym.toString() === 'amount') {
          return extractAmount(typeof entry.val === 'function' ? entry.val() : entry.val, warnings);
        }
      }
    }
  }
  
  warnings.push({ code: 'EVENT_SHAPE_UNKNOWN', message: 'Unknown shape for token amount data' });
  return null;
}
