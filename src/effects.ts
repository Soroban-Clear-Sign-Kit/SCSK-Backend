import { xdr, Address, StrKey } from "@stellar/stellar-sdk";
import { WarningCode } from "./errors.js";
import { BalanceDelta } from "./types.js";
import { unwrap, getSwitchName, getArray } from "./accessors.js";

export function extractTokenEffects(
  events: xdr.DiagnosticEvent[] | undefined,
): {
  effects: BalanceDelta[];
  warnings: { code: WarningCode; message: string }[];
} {
  const warnings: { code: WarningCode; message: string }[] = [];
  const effects: BalanceDelta[] = [];

  if (!events) return { effects, warnings };

  const deltas: Record<string, Record<string, bigint>> = {}; // contractId -> account -> delta

  for (const diagnosticEvent of events) {
    const eventObj = diagnosticEvent as unknown as Record<string, unknown>;
    const isSuccess = Boolean(
      unwrap(
        eventObj.inSuccessfulContractCall ??
          eventObj.in_successful_contract_call,
      ),
    );
    if (!isSuccess) continue;

    const rawEvent = unwrap<Record<string, unknown>>(eventObj.event);
    if (!rawEvent) continue;

    const eventType =
      getSwitchName(rawEvent.type) ??
      (typeof rawEvent.type === "string" ? rawEvent.type : undefined);
    if (
      eventType !== "contract" &&
      eventType !== "contractEventTypeContract" &&
      unwrap<number>(rawEvent.type) !== 1
    ) {
      continue;
    }

    const eventContractIdRaw = unwrap(
      rawEvent.contractId ?? rawEvent.contract_id,
    );
    let eventContractId: Buffer | Uint8Array | null = null;
    if (eventContractIdRaw) {
      if (typeof eventContractIdRaw === "string") {
        if (eventContractIdRaw.startsWith("C")) {
          try {
            eventContractId = StrKey.decodeContract(eventContractIdRaw);
          } catch {
            // ignore
          }
        } else if (eventContractIdRaw.length === 64) {
          eventContractId = Buffer.from(eventContractIdRaw, "hex");
        }
      } else if (
        Buffer.isBuffer(eventContractIdRaw) ||
        eventContractIdRaw instanceof Uint8Array
      ) {
        eventContractId = eventContractIdRaw;
      } else if (
        typeof eventContractIdRaw === "object" &&
        eventContractIdRaw !== null &&
        "value" in eventContractIdRaw &&
        (Buffer.isBuffer((eventContractIdRaw as { value: unknown }).value) ||
          (eventContractIdRaw as { value: unknown }).value instanceof
            Uint8Array)
      ) {
        eventContractId = (eventContractIdRaw as { value: Buffer | Uint8Array })
          .value;
      } else if (
        typeof (eventContractIdRaw as { toString?: unknown }).toString ===
        "function"
      ) {
        const hex = (
          eventContractIdRaw as { toString: (enc?: string) => string }
        ).toString("hex");
        if (hex && hex.length === 64) eventContractId = Buffer.from(hex, "hex");
      }
    }

    let contractId: string | null = null;
    if (eventContractId) {
      try {
        if (eventContractId.length !== 32) {
          throw new Error("contract ID must be 32 bytes");
        }
        contractId = StrKey.encodeContract(Buffer.from(eventContractId));
      } catch {
        warnings.push({
          code: "EVENT_SHAPE_UNKNOWN",
          message: "Skipped an event whose emitting contract ID is invalid",
        });
      }
    }
    if (!contractId) continue;

    const eventBody = unwrap<Record<string, unknown>>(rawEvent.body);
    if (!eventBody) continue;
    const bodyValue = unwrap<Record<string, unknown>>(
      eventBody.v0 ?? eventBody.value ?? eventBody,
    );

    if (!bodyValue || !bodyValue.topics || !bodyValue.data) continue;
    const topics = getArray<xdr.ScVal>(bodyValue.topics);
    if (topics.length < 1) continue;

    const topic0 = topics[0];
    const topic0Type = getSwitchName(topic0);
    if (topic0Type !== "scvSymbol") continue;
    const rawSym = unwrap<Buffer | string | { toString: () => string }>(
      (topic0 as unknown as Record<string, unknown>).sym,
    );
    const action = rawSym ? rawSym.toString() : "";

    let from: string | null = null;
    let to: string | null = null;
    let amount: bigint | null = null;

    if (action === "transfer" && topics.length >= 3) {
      from = extractAddress(topics[1]);
      to = extractAddress(topics[2]);
      amount = extractAmount(unwrap(bodyValue.data), warnings);
    } else if (action === "mint" && topics.length >= 2) {
      to = extractAddress(topics[1]);
      amount = extractAmount(unwrap(bodyValue.data), warnings);
    } else if (action === "burn" && topics.length >= 2) {
      from = extractAddress(topics[1]);
      amount = extractAmount(unwrap(bodyValue.data), warnings);
    } else if (action === "clawback" && topics.length >= 2) {
      from = extractAddress(topics[1]);
      amount = extractAmount(unwrap(bodyValue.data), warnings);
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
          delta: delta.toString(),
        });
      }
    }
  }

  return { effects, warnings };
}

function extractAddress(scval: xdr.ScVal | unknown): string | null {
  if (!scval) return null;
  const val = scval as Record<string, unknown>;
  const type = getSwitchName(val);
  if (type === "scvAddress") {
    const address =
      typeof val.address === "function"
        ? (val.address as () => unknown)()
        : val.address;
    if (address) {
      try {
        return Address.fromScAddress(address as xdr.ScAddress).toString();
      } catch {
        return null;
      }
    }
  }
  return null;
}

function extractAmount(
  data: xdr.ScVal | unknown,
  warnings: { code: WarningCode; message: string }[],
): bigint | null {
  if (!data) return null;
  const type = getSwitchName(data);
  const val = data as Record<string, unknown>;

  if (type === "scvI128") {
    const parts = unwrap<Record<string, unknown>>(val.i128);
    if (parts) {
      const loRaw = unwrap<bigint | number | string>(parts.lo);
      const hiRaw = unwrap<bigint | number | string>(parts.hi);
      const lo = BigInt(loRaw?.toString() ?? "0");
      const hi = BigInt(hiRaw?.toString() ?? "0");
      return (hi << 64n) | lo;
    }
  } else if (type === "scvMap") {
    const entries = getArray<Record<string, unknown>>(val.map);
    for (const entry of entries) {
      const key = unwrap<Record<string, unknown>>(entry.key);
      const keyType = getSwitchName(key);
      const keySym = unwrap<Buffer | string | { toString: () => string }>(
        key ? (key as Record<string, unknown>).sym : undefined,
      );
      if (keyType === "scvSymbol" && keySym && keySym.toString() === "amount") {
        return extractAmount(unwrap(entry.val), warnings);
      }
    }
  }

  warnings.push({
    code: "EVENT_SHAPE_UNKNOWN",
    message: "Unknown shape for token amount data",
  });
  return null;
}
