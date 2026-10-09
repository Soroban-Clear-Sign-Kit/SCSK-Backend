export type WarningSeverity = "review" | "blocked";

export type WarningCode =
  | "ENVELOPE_MALFORMED"
  | "ENVELOPE_TOO_LARGE"
  | "NETWORK_MISMATCH"
  | "TX_EXPIRED"
  | "CLASSIC_OP_NOT_DECODED"
  | "CONTRACT_DEPLOYMENT"
  | "WASM_UPLOAD"
  | "SPEC_UNAVAILABLE"
  | "ARG_COUNT_MISMATCH"
  | "ARG_TYPE_MISMATCH"
  | "UNSUPPORTED_SCVAL"
  | "VALUE_TOO_DEEP"
  | "AUTH_TREE_TOO_LARGE"
  | "AUTH_EXPIRING"
  | "AUTH_EXPIRED"
  | "AUTH_DUPLICATE_NONCE"
  | "AUTH_UNKNOWN_CONTRACT"
  | "AUTH_EXTRA_CONTRACT"
  | "AUTH_CREATES_CONTRACT"
  | "SIMULATION_FAILED"
  | "SIMULATION_UNAVAILABLE"
  | "RESTORE_REQUIRED"
  | "FEE_UNUSUALLY_HIGH"
  | "EVENT_SHAPE_UNKNOWN"
  | "TOKEN_METADATA_UNAVAILABLE"
  | "INTENT_MISMATCH"
  | "INTENT_SPEND_EXCEEDED"
  | "INTENT_UNEXPECTED_AUTH"
  | "INTENT_UNVERIFIABLE"
  | "INTERNAL_ERROR";

export const WARNING_SEVERITY: Record<WarningCode, WarningSeverity> = {
  ENVELOPE_MALFORMED: "blocked",
  ENVELOPE_TOO_LARGE: "blocked",
  NETWORK_MISMATCH: "blocked",
  TX_EXPIRED: "blocked",
  CLASSIC_OP_NOT_DECODED: "review",
  CONTRACT_DEPLOYMENT: "review",
  WASM_UPLOAD: "review",
  SPEC_UNAVAILABLE: "review",
  ARG_COUNT_MISMATCH: "blocked",
  ARG_TYPE_MISMATCH: "blocked",
  UNSUPPORTED_SCVAL: "review",
  VALUE_TOO_DEEP: "review",
  AUTH_TREE_TOO_LARGE: "blocked",
  AUTH_EXPIRING: "review",
  AUTH_EXPIRED: "blocked",
  AUTH_DUPLICATE_NONCE: "blocked",
  AUTH_UNKNOWN_CONTRACT: "review",
  AUTH_EXTRA_CONTRACT: "review",
  AUTH_CREATES_CONTRACT: "review",
  SIMULATION_FAILED: "blocked",
  SIMULATION_UNAVAILABLE: "blocked",
  RESTORE_REQUIRED: "review",
  FEE_UNUSUALLY_HIGH: "review",
  EVENT_SHAPE_UNKNOWN: "review",
  TOKEN_METADATA_UNAVAILABLE: "review",
  INTENT_MISMATCH: "blocked",
  INTENT_SPEND_EXCEEDED: "blocked",
  INTENT_UNEXPECTED_AUTH: "blocked",
  INTENT_UNVERIFIABLE: "blocked",
  INTERNAL_ERROR: "blocked",
};

export class ClearSignError extends Error {
  constructor(
    public code: WarningCode,
    message: string,
  ) {
    super(message);
    this.name = "ClearSignError";
  }
}
