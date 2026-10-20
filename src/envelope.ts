import {
  FeeBumpTransaction,
  TransactionBuilder,
  Transaction,
  MuxedAccount,
  Keypair,
  xdr,
} from "@stellar/stellar-sdk";
import { MAX_XDR_BASE64_LENGTH } from "./limits.js";
import { WarningCode } from "./errors.js";

export interface EnvelopeWarning {
  code: WarningCode;
  message: string;
}

export type ParseResult =
  | {
      success: true;
      envelope: {
        source: string;
        sequence: string;
        fee: string;
        feeBump?: { feeSource: string; fee: string };
        memo?: { type: string; value: string };
        timeBounds?: { min: string; max: string };
        operations: { type: string; decoded: boolean; raw: unknown }[];
      };
      innerTransaction: Transaction;
      warnings: EnvelopeWarning[];
      signatureBound: boolean;
    }
  | {
      success: false;
      error: EnvelopeWarning;
    };

export interface ParseEnvelopeOptions {
  now?: (() => number) | number | undefined;
}

function getSignatureBytes(val: unknown): Buffer {
  if (!val) return Buffer.alloc(0);
  let current: unknown = val;
  if (typeof current === "function") current = (current as () => unknown)();
  if (
    current &&
    typeof current === "object" &&
    "value" in current &&
    (current as { value: unknown }).value !== undefined
  ) {
    current = (current as { value: unknown }).value;
  }
  return Buffer.isBuffer(current)
    ? current
    : current instanceof Uint8Array
      ? Buffer.from(current)
      : Buffer.from(String(current ?? ""));
}

function getBaseAccountId(address: string): string {
  if (address.startsWith("M")) {
    try {
      const muxed = MuxedAccount.fromAddress(address, "0");
      return muxed.baseAccount().accountId();
    } catch {
      // ignore
    }
  }
  return address;
}

function verifySignaturesForAccount(
  accountPublicKey: string,
  signatures: xdr.DecoratedSignature[] | undefined,
  hash: Buffer,
): { checked: boolean; valid: boolean } {
  if (!signatures || signatures.length === 0) {
    return { checked: false, valid: true };
  }

  let kp: Keypair;
  try {
    const baseAccount = getBaseAccountId(accountPublicKey);
    kp = Keypair.fromPublicKey(baseAccount);
  } catch {
    return { checked: false, valid: true };
  }

  const hint = Buffer.from(kp.signatureHint());
  const matching = signatures.filter((s: unknown) => {
    const sObj = s as unknown as Record<string, unknown>;
    const sHint = getSignatureBytes(sObj.hint);
    return sHint.equals(hint);
  });

  if (matching.length === 0) {
    return { checked: false, valid: true };
  }

  for (const s of matching) {
    const sObj = s as unknown as Record<string, unknown>;
    const rawSig = getSignatureBytes(sObj.signature);
    if (!kp.verify(hash, rawSig)) {
      return { checked: true, valid: false };
    }
  }

  return { checked: true, valid: true };
}

export function parseEnvelope(
  xdrInput: string,
  networkPassphrase?: string,
  rpcPassphrase?: string,
  options?: ParseEnvelopeOptions,
): ParseResult {
  const xdr = (xdrInput || "").trim();

  if (!xdr) {
    return {
      success: false,
      error: { code: "ENVELOPE_MALFORMED", message: "Empty XDR" },
    };
  }

  if (xdr.length > MAX_XDR_BASE64_LENGTH) {
    return {
      success: false,
      error: {
        code: "ENVELOPE_TOO_LARGE",
        message: "XDR exceeds maximum length",
      },
    };
  }

  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(xdr) || xdr.length % 4 !== 0) {
    return {
      success: false,
      error: { code: "ENVELOPE_MALFORMED", message: "Invalid base64 encoding" },
    };
  }

  let tx: Transaction | FeeBumpTransaction;
  try {
    tx = TransactionBuilder.fromXDR(xdr, networkPassphrase ?? "") as
      Transaction | FeeBumpTransaction;
  } catch (e: unknown) {
    return {
      success: false,
      error: { code: "ENVELOPE_MALFORMED", message: "Failed to parse XDR" },
    };
  }

  if (
    networkPassphrase &&
    rpcPassphrase &&
    networkPassphrase !== rpcPassphrase
  ) {
    return {
      success: false,
      error: {
        code: "NETWORK_MISMATCH",
        message: "RPC network does not match configured network",
      },
    };
  }

  let feeBump: { feeSource: string; fee: string } | undefined;
  let innerTransaction: Transaction;

  if (tx instanceof FeeBumpTransaction) {
    feeBump = {
      feeSource: tx.feeSource,
      fee: tx.fee,
    };
    innerTransaction = tx.innerTransaction;
  } else {
    innerTransaction = tx;
  }

  const warnings: EnvelopeWarning[] = [];

  const timeBounds = innerTransaction.timeBounds;
  let parsedTimeBounds: { min: string; max: string } | undefined;
  if (timeBounds) {
    parsedTimeBounds = { min: timeBounds.minTime, max: timeBounds.maxTime };
    if (timeBounds.maxTime !== "0") {
      const maxTimeMs = parseInt(timeBounds.maxTime, 10) * 1000;
      const getNow =
        typeof options?.now === "function"
          ? options.now
          : options?.now !== undefined
            ? () => options.now as number
            : Date.now;
      if (maxTimeMs < getNow()) {
        warnings.push({
          code: "TX_EXPIRED",
          message: "Time bounds have already expired",
        });
      }
    }
  }

  const memo = innerTransaction.memo;
  let parsedMemo: { type: string; value: string } | undefined;
  if (memo && memo.type !== "none") {
    let value = "";
    if (memo.type === "text")
      value = memo.value ? (memo.value as string).toString() : "";
    else if (memo.type === "id")
      value = memo.value ? memo.value.toString() : "";
    else if (memo.type === "hash" || memo.type === "return")
      value = (memo.value as Buffer).toString("hex");
    parsedMemo = { type: memo.type, value };
  }

  const operations = innerTransaction.operations;
  if (operations.length === 0) {
    return {
      success: false,
      error: {
        code: "ENVELOPE_MALFORMED",
        message: "Transaction has no operations",
      },
    };
  }

  let invokeCount = 0;
  const parsedOperations = operations.map((op) => {
    const isInvoke = op.type === "invokeHostFunction";
    if (isInvoke) invokeCount++;
    if (!isInvoke) {
      warnings.push({
        code: "CLASSIC_OP_NOT_DECODED",
        message: `Classic operation ${op.type} not decoded`,
      });
    }
    return {
      type: op.type,
      decoded: isInvoke,
      raw: op,
    };
  });

  if (invokeCount > 1) {
    return {
      success: false,
      error: {
        code: "ENVELOPE_MALFORMED",
        message: "Multiple invokeHostFunction operations not supported",
      },
    };
  }

  // Handle Muxed source account
  let sourceString = innerTransaction.source;
  if (sourceString.startsWith("M")) {
    try {
      const muxed = MuxedAccount.fromAddress(sourceString, "0");
      const gAddress = muxed.baseAccount().accountId();
      sourceString = `${sourceString} (${gAddress})`;
    } catch (e) {
      // ignore
    }
  }

  const resultEnvelope = {
    source: sourceString,
    sequence: innerTransaction.sequence,
    fee: innerTransaction.fee,
    operations: parsedOperations,
    ...(feeBump ? { feeBump } : {}),
    ...(parsedMemo ? { memo: parsedMemo } : {}),
    ...(parsedTimeBounds ? { timeBounds: parsedTimeBounds } : {}),
  };

  let signatureBound = false;
  let signatureInvalid = false;

  if (tx instanceof FeeBumpTransaction) {
    const feeRes = verifySignaturesForAccount(
      tx.feeSource,
      tx.signatures,
      Buffer.from(tx.hash()),
    );
    const innerRes = verifySignaturesForAccount(
      tx.innerTransaction.source,
      tx.innerTransaction.signatures,
      Buffer.from(tx.innerTransaction.hash()),
    );

    if (!feeRes.valid || !innerRes.valid) {
      signatureInvalid = true;
    } else if (feeRes.checked || innerRes.checked) {
      signatureBound = true;
    }
  } else {
    const res = verifySignaturesForAccount(
      tx.source,
      tx.signatures,
      Buffer.from(tx.hash()),
    );
    if (!res.valid) {
      signatureInvalid = true;
    } else if (res.checked) {
      signatureBound = true;
    }
  }

  if (signatureInvalid) {
    warnings.push({
      code: "SIGNATURE_INVALID",
      message: "Envelope signature is invalid for the specified network or key",
    });
    signatureBound = false;
  }

  return {
    success: true,
    envelope: resultEnvelope,
    innerTransaction,
    warnings,
    signatureBound,
  };
}
