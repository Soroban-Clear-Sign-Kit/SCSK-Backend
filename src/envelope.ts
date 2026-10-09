import {
  FeeBumpTransaction,
  TransactionBuilder,
  Transaction,
  MuxedAccount,
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
        operations: { type: string; decoded: boolean; raw: any }[];
      };
      innerTransaction: Transaction;
      warnings: EnvelopeWarning[];
    }
  | {
      success: false;
      error: EnvelopeWarning;
    };

export function parseEnvelope(
  xdrInput: string,
  networkPassphrase?: string,
  rpcPassphrase?: string,
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
  } catch (e: any) {
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
      if (maxTimeMs < Date.now()) {
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

  const resultEnvelope: any = {
    source: sourceString,
    sequence: innerTransaction.sequence,
    fee: innerTransaction.fee,
    operations: parsedOperations,
  };
  if (feeBump) resultEnvelope.feeBump = feeBump;
  if (parsedMemo) resultEnvelope.memo = parsedMemo;
  if (parsedTimeBounds) resultEnvelope.timeBounds = parsedTimeBounds;

  return {
    success: true,
    envelope: resultEnvelope,
    innerTransaction,
    warnings,
  };
}
