import { describe, it, expect, vi, beforeEach } from "vitest";
import { decodeEvent } from "../../src/events.js";
import { xdr, StrKey } from "@stellar/stellar-sdk";
import { loadSpec } from "../../src/spec.js";

vi.mock("../../src/spec.js", async () => {
  const actual: any = await vi.importActual("../../src/spec.js");
  return {
    ...actual,
    loadSpec: vi.fn(),
  };
});

const contractId = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";

describe("decodeEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("decodes a basic contract event without spec", async () => {
    (loadSpec as any).mockResolvedValue({
      spec: null,
      source: "none",
      warnings: [],
    });

    const event = new xdr.ContractEvent({
      ext: xdr.ExtensionPoint.v0(),
      contractId: StrKey.decodeContract(contractId) as any,
      type: xdr.ContractEventType.contract,
      body: xdr.ContractEventBody.v0(
        new xdr.ContractEventV0({
          topics: [xdr.ScVal.scvSymbol("transfer"), xdr.ScVal.scvU32(1)],
          data: xdr.ScVal.scvString("hello"),
        }),
      ),
    });

    const res = await decodeEvent(event, { rpcUrl: "" });
    expect(res.contractId).toBe(contractId);
    expect(res.type).toBe("contract");
    expect(res.specSource).toBe("none");
    expect(res.eventName).toBe("transfer");
    expect(res.topics.length).toBe(2);
    expect(res.data.kind).toBe("string");
  });

  it("handles diagnostic and system event types", async () => {
    (loadSpec as any).mockResolvedValue({
      spec: null,
      source: "none",
      warnings: [],
    });

    const event1 = new xdr.ContractEvent({
      ext: xdr.ExtensionPoint.v0(),
      contractId: null,
      type: xdr.ContractEventType.diagnostic,
      body: xdr.ContractEventBody.v0(
        new xdr.ContractEventV0({
          topics: [],
          data: xdr.ScVal.scvVoid(),
        }),
      ),
    });

    const res1 = await decodeEvent(event1, { rpcUrl: "" });
    expect(res1.contractId).toBeNull();
    expect(res1.type).toBe("diagnostic");

    const event2 = new xdr.ContractEvent({
      ext: xdr.ExtensionPoint.v0(),
      contractId: null,
      type: xdr.ContractEventType.system,
      body: xdr.ContractEventBody.v0(
        new xdr.ContractEventV0({
          topics: [],
          data: xdr.ScVal.scvVoid(),
        }),
      ),
    });

    const res2 = await decodeEvent(event2, { rpcUrl: "" });
    expect(res2.type).toBe("system");

    // Test string event types
    const event3 = {
      contractId: null,
      type: "contract",
      body: { value: { topics: [], data: xdr.ScVal.scvVoid() } },
    };
    const res3 = await decodeEvent(event3 as any, { rpcUrl: "" });
    expect(res3.type).toBe("contract");
  });

  it("decodes event with matching spec", async () => {
    const specEvents = [
      {
        value: {
          name: () => Buffer.from("transfer"),
          topics: [{ type: "scSpecTypeSymbol" }, { type: "scSpecTypeU32" }],
          data: { type: "scSpecTypeString" },
        },
      },
    ];

    const spec = {
      events: () => specEvents,
    };

    (loadSpec as any).mockResolvedValue({ spec, source: "wasm", warnings: [] });

    const event = new xdr.ContractEvent({
      ext: xdr.ExtensionPoint.v0(),
      contractId: StrKey.decodeContract(contractId) as any,
      type: xdr.ContractEventType.contract,
      body: xdr.ContractEventBody.v0(
        new xdr.ContractEventV0({
          topics: [xdr.ScVal.scvSymbol("transfer"), xdr.ScVal.scvU32(100)],
          data: xdr.ScVal.scvString("hello_spec"),
        }),
      ),
    });

    const res = await decodeEvent(event, { rpcUrl: "" });
    expect(res.eventName).toBe("transfer");
    expect(res.specSource).toBe("wasm");
    expect(res.data.kind).toBe("string");
  });

  it("skips non-matching specs", async () => {
    const specEvents = [
      {
        value: {
          name: () => Buffer.from("transfer"),
          topics: [{ type: "scSpecTypeSymbol" }, { type: "scSpecTypeI32" }],
          data: { type: "scSpecTypeString" },
        },
      },
    ];

    const spec = {
      events: () => specEvents,
    };

    (loadSpec as any).mockResolvedValue({ spec, source: "wasm", warnings: [] });

    const event = new xdr.ContractEvent({
      ext: xdr.ExtensionPoint.v0(),
      contractId: StrKey.decodeContract(contractId) as any,
      type: xdr.ContractEventType.contract,
      body: xdr.ContractEventBody.v0(
        new xdr.ContractEventV0({
          // First topic is U32 instead of Symbol, which will trigger match = false
          topics: [xdr.ScVal.scvU32(99), xdr.ScVal.scvU32(100)],
          data: xdr.ScVal.scvString("hello_spec"),
        }),
      ),
    });

    const res = await decodeEvent(event, { rpcUrl: "" });
    // Did not match type, so didn't parse from spec.
    // And since it didn't match, and the first topic is not a symbol, it has no eventName!
    expect(res.eventName).toBeNull();
  });
});
