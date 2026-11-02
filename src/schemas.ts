import { z } from "zod";
import { WarningCodeEnum } from "./errors.js";

/**
 * Zod schema for DisplayValue: recursive human-readable ScVal representation.
 */
export const DisplayValueSchema: z.ZodType<any> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("bool"),
      value: z.boolean(),
    }),
    z.object({
      kind: z.literal("void"),
    }),
    z.object({
      kind: z.literal("int"),
      type: z.enum([
        "u32",
        "i32",
        "u64",
        "i64",
        "u128",
        "i128",
        "u256",
        "i256",
      ]),
      value: z.string(),
    }),
    z.object({
      kind: z.enum(["timepoint", "duration"]),
      value: z.string(),
    }),
    z.object({
      kind: z.literal("bytes"),
      hex: z.string(),
      length: z.number(),
      truncated: z.boolean(),
    }),
    z.object({
      kind: z.enum(["string", "symbol"]),
      value: z.string(),
      truncated: z.boolean(),
      sanitized: z.boolean(),
    }),
    z.object({
      kind: z.literal("address"),
      value: z.string(),
      addressType: z.enum(["account", "contract", "muxed", "other"]),
    }),
    z.object({
      kind: z.literal("vec"),
      items: z.array(DisplayValueSchema),
    }),
    z.object({
      kind: z.literal("map"),
      entries: z.array(
        z.object({
          key: DisplayValueSchema,
          value: DisplayValueSchema,
        }),
      ),
    }),
    z.object({
      kind: z.literal("struct"),
      name: z.string(),
      fields: z.array(
        z.object({
          name: z.string(),
          value: DisplayValueSchema,
        }),
      ),
    }),
    z.object({
      kind: z.literal("enum"),
      name: z.string(),
      variant: z.string(),
      values: z.array(DisplayValueSchema),
    }),
    z.object({
      kind: z.literal("option"),
      value: z.nullable(DisplayValueSchema),
    }),
    z.object({
      kind: z.literal("raw"),
      scvalType: z.string(),
      xdr: z.string(),
    }),
  ]),
);

/**
 * Zod schema for DecodedArg.
 */
export const DecodedArgSchema = z.object({
  name: z.string().nullable(),
  typeName: z.string().nullable(),
  value: DisplayValueSchema,
});

/**
 * Zod schema for Warning (both ClearSignPreview and policy warnings).
 */
export const WarningSchema = z.object({
  code: z.nativeEnum(WarningCodeEnum),
  severity: z.enum(["review", "blocked"]),
  message: z.string(),
  path: z.string().optional(),
  ruleId: z.string().optional(),
});

/**
 * Zod schema for Invocation.
 */
export const InvocationSchema = z.object({
  contractId: z.string(),
  functionName: z.string(),
  args: z.array(DecodedArgSchema),
  specSource: z.enum(["wasm", "sac-builtin", "injected", "none"]),
});

/**
 * Zod schema for AuthNode recursive tree.
 */
export const AuthNodeSchema: z.ZodType<any> = z.lazy(() =>
  z.object({
    kind: z.enum(["contract-fn", "create-contract", "create-contract-v2"]),
    contractId: z.string().optional(),
    functionName: z.string().optional(),
    args: z.array(DecodedArgSchema).optional(),
    details: z.record(z.string(), z.string()).optional(),
    children: z.array(AuthNodeSchema),
    depth: z.number(),
  }),
);

/**
 * Zod schema for AuthEntry.
 */
export const AuthEntrySchema = z.object({
  credentials: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("source-account"),
    }),
    z.object({
      type: z.literal("address"),
      address: z.string(),
      nonce: z.string(),
      signatureExpirationLedger: z.number(),
      signed: z.boolean(),
    }),
  ]),
  root: AuthNodeSchema,
});

/**
 * Zod schema for BalanceDelta.
 */
export const BalanceDeltaSchema = z.object({
  tokenContractId: z.string(),
  account: z.string(),
  delta: z.string(),
  symbol: z.string().optional(),
  decimals: z.number().optional(),
  formatted: z.string().optional(),
});

/**
 * Zod schema for ClearSignPreview.
 */
export const ClearSignPreviewSchema = z.object({
  version: z.literal(1),
  risk: z.enum(["ok", "review", "blocked"]),
  warnings: z.array(WarningSchema),
  network: z.object({
    passphrase: z.string(),
    rpcMatches: z.boolean(),
    signatureBound: z.boolean(),
  }),
  envelope: z.object({
    source: z.string(),
    sequence: z.string(),
    fee: z.string(),
    feeBump: z
      .object({
        feeSource: z.string(),
        fee: z.string(),
      })
      .optional(),
    memo: z
      .object({
        type: z.string(),
        value: z.string(),
      })
      .optional(),
    timeBounds: z
      .object({
        min: z.string(),
        max: z.string(),
      })
      .optional(),
    operations: z.array(
      z.object({
        type: z.string(),
        decoded: z.boolean(),
      }),
    ),
  }),
  invocation: InvocationSchema.optional(),
  auth: z.array(AuthEntrySchema),
  simulation: z.object({
    status: z.enum([
      "success",
      "failed",
      "needs-restore",
      "unavailable",
      "skipped",
    ]),
    minResourceFee: z.string().optional(),
    error: z.string().optional(),
    returnValue: DisplayValueSchema.optional(),
    latestLedger: z.number().optional(),
  }),
  effects: z.array(BalanceDeltaSchema),
  summary: z.array(z.string()),
  raw: z.object({
    xdr: z.string(),
  }),
});

/**
 * Schema alias for TransactionSummary (the ClearSignPreview output contract).
 */
export const TransactionSummarySchema = ClearSignPreviewSchema;

