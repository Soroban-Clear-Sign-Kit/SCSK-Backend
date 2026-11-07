import { describe, it, expect, vi } from "vitest";
import { extractTokenEffects } from "../../src/effects.js";
import { xdr, StrKey } from "@stellar/stellar-sdk";

describe("extractTokenEffects", () => {
  const fromStr = "GB7D4G6B7D4G6B7D4G6B7D4G6B7D4G6B7D4G6B7D4G6B7D4G6B7D4G6B";
  const contractId = Buffer.alloc(32, 1);
  const from = Buffer.alloc(32, 2);
  const to = Buffer.alloc(32, 3);

  it("returns empty on undefined", () => {
    expect(extractTokenEffects(undefined).effects).toEqual([]);
  });

  it("ignores non-successful contract calls", () => {
    const events = [
      new xdr.DiagnosticEvent({
        inSuccessfulContractCall: false,
        event: new xdr.ContractEvent({
          ext: xdr.ExtensionPoint.v0(),
          contractId: null,
          type: xdr.ContractEventType.system,
          body: xdr.ContractEventBody.v0(
            new xdr.ContractEventV0({
              topics: [],
              data: xdr.ScVal.scvVoid(),
            }),
          ),
        }),
      }),
    ];
    const res = extractTokenEffects(events);
    expect(res.effects).toEqual([]);
  });

  it("extracts transfer events", () => {
    const topics = [
      xdr.ScVal.scvSymbol("transfer"),
      xdr.ScVal.scvAddress(
        xdr.ScAddress.scAddressTypeAccount(
          xdr.PublicKey.publicKeyTypeEd25519(from),
        ),
      ),
      xdr.ScVal.scvAddress(
        xdr.ScAddress.scAddressTypeAccount(
          xdr.PublicKey.publicKeyTypeEd25519(to),
        ),
      ),
    ];

    const data = xdr.ScVal.scvI128(new xdr.Int128Parts({ hi: 0n, lo: 100n }));

    const events = [
      new xdr.DiagnosticEvent({
        inSuccessfulContractCall: true,
        event: new xdr.ContractEvent({
          ext: xdr.ExtensionPoint.v0(),
          contractId: contractId as any,
          type: xdr.ContractEventType.contract,
          body: xdr.ContractEventBody.v0(
            new xdr.ContractEventV0({
              topics: topics,
              data: data,
            }),
          ),
        }),
      }),
    ];

    const res = extractTokenEffects(events);
    expect(res.effects.length).toBe(2);
    expect(res.effects[0]?.delta).toBe("-100");
    expect(res.effects[1]?.delta).toBe("100");
  });

  it("extracts mint events", () => {
    const topics = [
      xdr.ScVal.scvSymbol("mint"),
      xdr.ScVal.scvAddress(
        xdr.ScAddress.scAddressTypeAccount(
          xdr.PublicKey.publicKeyTypeEd25519(to),
        ),
      ),
    ];
    const data = xdr.ScVal.scvI128(new xdr.Int128Parts({ hi: 0n, lo: 50n }));
    const events = [
      new xdr.DiagnosticEvent({
        inSuccessfulContractCall: true,
        event: new xdr.ContractEvent({
          ext: xdr.ExtensionPoint.v0(),
          contractId: contractId as any,
          type: xdr.ContractEventType.contract,
          body: xdr.ContractEventBody.v0(
            new xdr.ContractEventV0({ topics, data }),
          ),
        }),
      }),
    ];
    const res = extractTokenEffects(events);
    expect(res.effects.length).toBe(1);
    expect(res.effects[0]?.delta).toBe("50");
  });

  it("extracts burn events", () => {
    const topics = [
      xdr.ScVal.scvSymbol("burn"),
      xdr.ScVal.scvAddress(
        xdr.ScAddress.scAddressTypeAccount(
          xdr.PublicKey.publicKeyTypeEd25519(from),
        ),
      ),
    ];
    const data = xdr.ScVal.scvI128(new xdr.Int128Parts({ hi: 0n, lo: 20n }));
    const events = [
      new xdr.DiagnosticEvent({
        inSuccessfulContractCall: true,
        event: new xdr.ContractEvent({
          ext: xdr.ExtensionPoint.v0(),
          contractId: contractId as any,
          type: xdr.ContractEventType.contract,
          body: xdr.ContractEventBody.v0(
            new xdr.ContractEventV0({ topics, data }),
          ),
        }),
      }),
    ];
    const res = extractTokenEffects(events);
    expect(res.effects.length).toBe(1);
    expect(res.effects[0]?.delta).toBe("-20");
  });

  it("extracts clawback events", () => {
    const topics = [
      xdr.ScVal.scvSymbol("clawback"),
      xdr.ScVal.scvAddress(
        xdr.ScAddress.scAddressTypeAccount(
          xdr.PublicKey.publicKeyTypeEd25519(from),
        ),
      ),
    ];
    const data = xdr.ScVal.scvI128(new xdr.Int128Parts({ hi: 0n, lo: 30n }));
    const events = [
      new xdr.DiagnosticEvent({
        inSuccessfulContractCall: true,
        event: new xdr.ContractEvent({
          ext: xdr.ExtensionPoint.v0(),
          contractId: contractId as any,
          type: xdr.ContractEventType.contract,
          body: xdr.ContractEventBody.v0(
            new xdr.ContractEventV0({ topics, data }),
          ),
        }),
      }),
    ];
    const res = extractTokenEffects(events);
    expect(res.effects.length).toBe(1);
    expect(res.effects[0]?.delta).toBe("-30");
  });

  it("handles map amount shape", () => {
    const topics = [
      xdr.ScVal.scvSymbol("mint"),
      xdr.ScVal.scvAddress(
        xdr.ScAddress.scAddressTypeAccount(
          xdr.PublicKey.publicKeyTypeEd25519(to),
        ),
      ),
    ];
    const data = xdr.ScVal.scvMap([
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("amount"),
        val: xdr.ScVal.scvI128(new xdr.Int128Parts({ hi: 0n, lo: 50n })),
      }),
    ]);
    const events = [
      new xdr.DiagnosticEvent({
        inSuccessfulContractCall: true,
        event: new xdr.ContractEvent({
          ext: xdr.ExtensionPoint.v0(),
          contractId: contractId as any,
          type: xdr.ContractEventType.contract,
          body: xdr.ContractEventBody.v0(
            new xdr.ContractEventV0({ topics, data }),
          ),
        }),
      }),
    ];
    const res = extractTokenEffects(events);
    expect(res.effects.length).toBe(1);
    expect(res.effects[0]?.delta).toBe("50");
  });

  it("warns on unknown amount shape", () => {
    const topics = [
      xdr.ScVal.scvSymbol("mint"),
      xdr.ScVal.scvAddress(
        xdr.ScAddress.scAddressTypeAccount(
          xdr.PublicKey.publicKeyTypeEd25519(to),
        ),
      ),
    ];
    const data = xdr.ScVal.scvVoid(); // bad shape
    const events = [
      new xdr.DiagnosticEvent({
        inSuccessfulContractCall: true,
        event: new xdr.ContractEvent({
          ext: xdr.ExtensionPoint.v0(),
          contractId: contractId as any,
          type: xdr.ContractEventType.contract,
          body: xdr.ContractEventBody.v0(
            new xdr.ContractEventV0({ topics, data }),
          ),
        }),
      }),
    ];
    const res = extractTokenEffects(events);
    expect(res.effects.length).toBe(0);
    expect(res.warnings).toContainEqual(
      expect.objectContaining({ code: "EVENT_SHAPE_UNKNOWN" }),
    );
  });

  it("returns null for non-address extractAddress", () => {
    const topics = [
      xdr.ScVal.scvSymbol("mint"),
      xdr.ScVal.scvVoid(), // not an address
    ];
    const data = xdr.ScVal.scvI128(new xdr.Int128Parts({ hi: 0n, lo: 50n }));
    const events = [
      new xdr.DiagnosticEvent({
        inSuccessfulContractCall: true,
        event: new xdr.ContractEvent({
          ext: xdr.ExtensionPoint.v0(),
          contractId: contractId as any,
          type: xdr.ContractEventType.contract,
          body: xdr.ContractEventBody.v0(
            new xdr.ContractEventV0({ topics, data }),
          ),
        }),
      }),
    ];
    const res = extractTokenEffects(events);
    expect(res.effects.length).toBe(0);
  });

  it("handles map amount shape without amount key", () => {
    const topics = [
      xdr.ScVal.scvSymbol("mint"),
      xdr.ScVal.scvAddress(
        xdr.ScAddress.scAddressTypeAccount(
          xdr.PublicKey.publicKeyTypeEd25519(to),
        ),
      ),
    ];
    const data = xdr.ScVal.scvMap([
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("other"),
        val: xdr.ScVal.scvI128(new xdr.Int128Parts({ hi: 0n, lo: 50n })),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvU32(1), // not a symbol
        val: xdr.ScVal.scvI128(new xdr.Int128Parts({ hi: 0n, lo: 50n })),
      }),
    ]);
    const events = [
      new xdr.DiagnosticEvent({
        inSuccessfulContractCall: true,
        event: new xdr.ContractEvent({
          ext: xdr.ExtensionPoint.v0(),
          contractId: contractId as any,
          type: xdr.ContractEventType.contract,
          body: xdr.ContractEventBody.v0(
            new xdr.ContractEventV0({ topics, data }),
          ),
        }),
      }),
    ];
    const res = extractTokenEffects(events);
    expect(res.effects.length).toBe(0);
    expect(res.warnings).toContainEqual(
      expect.objectContaining({ code: "EVENT_SHAPE_UNKNOWN" }),
    );
  });

  it("warns instead of logging when an event's contract ID is invalid", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const topics = [
      xdr.ScVal.scvSymbol("mint"),
      xdr.ScVal.scvAddress(
        xdr.ScAddress.scAddressTypeAccount(
          xdr.PublicKey.publicKeyTypeEd25519(to),
        ),
      ),
    ];
    const events = [
      new xdr.DiagnosticEvent({
        inSuccessfulContractCall: true,
        event: new xdr.ContractEvent({
          ext: xdr.ExtensionPoint.v0(),
          contractId: Buffer.alloc(5) as any,
          type: xdr.ContractEventType.contract,
          body: xdr.ContractEventBody.v0(
            new xdr.ContractEventV0({
              topics,
              data: xdr.ScVal.scvI128(
                new xdr.Int128Parts({
                  hi: xdr.Int64.fromString("0"),
                  lo: xdr.Uint64.fromString("5"),
                }),
              ),
            }),
          ),
        }),
      }),
    ];

    const res = extractTokenEffects(events);

    expect(res.effects).toEqual([]);
    expect(res.warnings).toContainEqual(
      expect.objectContaining({ code: "EVENT_SHAPE_UNKNOWN" }),
    );
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("extracts effects when contract ID is a StrKey C... string", () => {
    const cStr = StrKey.encodeContract(contractId);
    const topics = [
      xdr.ScVal.scvSymbol("mint"),
      xdr.ScVal.scvAddress(
        xdr.ScAddress.scAddressTypeAccount(
          xdr.PublicKey.publicKeyTypeEd25519(to),
        ),
      ),
    ];
    const data = xdr.ScVal.scvI128(new xdr.Int128Parts({ hi: 0n, lo: 15n }));
    const events = [
      {
        inSuccessfulContractCall: true,
        event: {
          type: "contract",
          contractId: cStr,
          body: {
            v0: { topics, data },
          },
        },
      } as any,
    ];
    const res = extractTokenEffects(events);
    expect(res.effects).toHaveLength(1);
    expect(res.effects[0]?.tokenContractId).toBe(cStr);
  });

  it("handles contract ID starting with C but invalid", () => {
    const topics = [
      xdr.ScVal.scvSymbol("mint"),
      xdr.ScVal.scvAddress(
        xdr.ScAddress.scAddressTypeAccount(
          xdr.PublicKey.publicKeyTypeEd25519(to),
        ),
      ),
    ];
    const events = [
      {
        inSuccessfulContractCall: true,
        event: {
          type: "contract",
          contractId: "CINVALID_STRKEY",
          body: {
            v0: {
              topics,
              data: xdr.ScVal.scvI128(new xdr.Int128Parts({ hi: 0n, lo: 1n })),
            },
          },
        },
      } as any,
    ];
    const res = extractTokenEffects(events);
    expect(res.effects).toEqual([]);
  });

  it("extracts effects when contract ID is 64-char hex", () => {
    const hexId = contractId.toString("hex");
    const topics = [
      xdr.ScVal.scvSymbol("mint"),
      xdr.ScVal.scvAddress(
        xdr.ScAddress.scAddressTypeAccount(
          xdr.PublicKey.publicKeyTypeEd25519(to),
        ),
      ),
    ];
    const data = xdr.ScVal.scvI128(new xdr.Int128Parts({ hi: 0n, lo: 25n }));
    const events = [
      {
        inSuccessfulContractCall: true,
        event: {
          type: "contract",
          contractId: hexId,
          body: {
            v0: { topics, data },
          },
        },
      } as any,
    ];
    const res = extractTokenEffects(events);
    expect(res.effects).toHaveLength(1);
    expect(res.effects[0]?.tokenContractId).toBe(
      StrKey.encodeContract(contractId),
    );
  });

  it("extracts effects when contract ID is Uint8Array", () => {
    const u8 = new Uint8Array(contractId);
    const topics = [
      xdr.ScVal.scvSymbol("mint"),
      xdr.ScVal.scvAddress(
        xdr.ScAddress.scAddressTypeAccount(
          xdr.PublicKey.publicKeyTypeEd25519(to),
        ),
      ),
    ];
    const data = xdr.ScVal.scvI128(new xdr.Int128Parts({ hi: 0n, lo: 5n }));
    const events = [
      {
        inSuccessfulContractCall: true,
        event: {
          type: "contract",
          contractId: u8,
          body: {
            v0: { topics, data },
          },
        },
      } as any,
    ];
    const res = extractTokenEffects(events);
    expect(res.effects).toHaveLength(1);
  });

  it("extracts effects when contract ID is wrapped in { value: Buffer } or { value: Uint8Array }", () => {
    const topics = [
      xdr.ScVal.scvSymbol("mint"),
      xdr.ScVal.scvAddress(
        xdr.ScAddress.scAddressTypeAccount(
          xdr.PublicKey.publicKeyTypeEd25519(to),
        ),
      ),
    ];
    const data = xdr.ScVal.scvI128(new xdr.Int128Parts({ hi: 0n, lo: 5n }));
    const events = [
      {
        inSuccessfulContractCall: true,
        event: {
          type: "contract",
          contractId: { value: contractId },
          body: {
            v0: { topics, data },
          },
        },
      } as any,
      {
        inSuccessfulContractCall: true,
        event: {
          type: "contract",
          contractId: { value: new Uint8Array(contractId) },
          body: {
            v0: { topics, data },
          },
        },
      } as any,
    ];
    const res = extractTokenEffects(events);
    expect(res.effects).toHaveLength(1);
  });

  it("extracts effects when contract ID has toString('hex') returning 64-char string", () => {
    const topics = [
      xdr.ScVal.scvSymbol("mint"),
      xdr.ScVal.scvAddress(
        xdr.ScAddress.scAddressTypeAccount(
          xdr.PublicKey.publicKeyTypeEd25519(to),
        ),
      ),
    ];
    const data = xdr.ScVal.scvI128(new xdr.Int128Parts({ hi: 0n, lo: 5n }));
    const events = [
      {
        inSuccessfulContractCall: true,
        event: {
          type: "contract",
          contractId: {
            toString: (enc?: string) =>
              enc === "hex" ? contractId.toString("hex") : "",
          },
          body: {
            v0: { topics, data },
          },
        },
      } as any,
    ];
    const res = extractTokenEffects(events);
    expect(res.effects).toHaveLength(1);
  });

  it("skips non-contract event types and numeric type !== 1", () => {
    const events = [
      {
        inSuccessfulContractCall: true,
        event: {
          type: 2, // not 1
          contractId,
          body: { v0: { topics: [], data: null } },
        },
      } as any,
      {
        inSuccessfulContractCall: true,
        event: {
          type: "diagnostic",
          contractId,
          body: { v0: { topics: [], data: null } },
        },
      } as any,
    ];
    const res = extractTokenEffects(events);
    expect(res.effects).toEqual([]);
  });

  it("handles numeric event type === 1 and contract_id alias", () => {
    const topics = [
      xdr.ScVal.scvSymbol("mint"),
      xdr.ScVal.scvAddress(
        xdr.ScAddress.scAddressTypeAccount(
          xdr.PublicKey.publicKeyTypeEd25519(to),
        ),
      ),
    ];
    const data = xdr.ScVal.scvI128(new xdr.Int128Parts({ hi: 0n, lo: 5n }));
    const events = [
      {
        in_successful_contract_call: true,
        event: {
          type: 1,
          contract_id: contractId,
          body: {
            topics,
            data,
          },
        },
      } as any,
    ];
    const res = extractTokenEffects(events);
    expect(res.effects).toHaveLength(1);
  });

  it("skips events with missing body, missing topics, or empty topics", () => {
    const events = [
      {
        inSuccessfulContractCall: true,
        event: { type: "contract", contractId, body: null },
      } as any,
      {
        inSuccessfulContractCall: true,
        event: {
          type: "contract",
          contractId,
          body: { v0: { topics: null, data: null } },
        },
      } as any,
      {
        inSuccessfulContractCall: true,
        event: {
          type: "contract",
          contractId,
          body: { v0: { topics: [], data: xdr.ScVal.scvVoid() } },
        },
      } as any,
      {
        inSuccessfulContractCall: true,
        event: {
          type: "contract",
          contractId,
          body: {
            v0: {
              topics: [xdr.ScVal.scvU32(1)], // topic0 not symbol
              data: xdr.ScVal.scvVoid(),
            },
          },
        },
      } as any,
    ];
    const res = extractTokenEffects(events);
    expect(res.effects).toEqual([]);
  });

  it("handles extractAddress returning null when Address.fromScAddress throws", () => {
    const topics = [
      xdr.ScVal.scvSymbol("mint"),
      {
        switch: () => ({ name: "scvAddress" }),
        address: () => ({ invalid: true }), // throws in Address.fromScAddress
      },
    ];
    const data = xdr.ScVal.scvI128(new xdr.Int128Parts({ hi: 0n, lo: 10n }));
    const events = [
      {
        inSuccessfulContractCall: true,
        event: {
          type: "contract",
          contractId,
          body: { v0: { topics, data } },
        },
      } as any,
    ];
    const res = extractTokenEffects(events);
    expect(res.effects).toEqual([]);
  });

  it("handles scvI128 with missing parts in extractAmount", () => {
    const topics = [
      xdr.ScVal.scvSymbol("mint"),
      xdr.ScVal.scvAddress(
        xdr.ScAddress.scAddressTypeAccount(
          xdr.PublicKey.publicKeyTypeEd25519(to),
        ),
      ),
    ];
    const data = {
      switch: () => ({ name: "scvI128" }),
      i128: null, // missing parts
    };
    const events = [
      {
        inSuccessfulContractCall: true,
        event: {
          type: "contract",
          contractId,
          body: { v0: { topics, data } },
        },
      } as any,
    ];
    const res = extractTokenEffects(events);
    expect(res.effects).toEqual([]);
    expect(res.warnings).toContainEqual(
      expect.objectContaining({ code: "EVENT_SHAPE_UNKNOWN" }),
    );
  });

  it("handles 128-bit amounts where lo has bit 63 set without sign-extension corruption", () => {
    const topics = [
      xdr.ScVal.scvSymbol("mint"),
      xdr.ScVal.scvAddress(
        xdr.ScAddress.scAddressTypeAccount(
          xdr.PublicKey.publicKeyTypeEd25519(to),
        ),
      ),
    ];
    const data = {
      switch: () => ({ name: "scvI128" }),
      i128: () => ({
        hi: () => "1",
        lo: () => "-1",
      }),
    };
    const events = [
      {
        inSuccessfulContractCall: true,
        event: {
          type: "contract",
          contractId,
          body: { v0: { topics, data } },
        },
      } as any,
    ];
    const res = extractTokenEffects(events);
    expect(res.effects).toHaveLength(1);
    expect(res.effects[0]?.delta).toBe(((1n << 64n) | ((1n << 64n) - 1n)).toString());
  });

  it("rejects negative token amounts in events with EVENT_SHAPE_UNKNOWN", () => {
    const topics = [
      xdr.ScVal.scvSymbol("mint"),
      xdr.ScVal.scvAddress(
        xdr.ScAddress.scAddressTypeAccount(
          xdr.PublicKey.publicKeyTypeEd25519(to),
        ),
      ),
    ];
    const data = xdr.ScVal.scvI128(new xdr.Int128Parts({ hi: -1n, lo: 1n }));
    const events = [
      {
        inSuccessfulContractCall: true,
        event: {
          type: "contract",
          contractId,
          body: { v0: { topics, data } },
        },
      } as any,
    ];
    const res = extractTokenEffects(events);
    expect(res.effects).toEqual([]);
    expect(res.warnings).toContainEqual(
      expect.objectContaining({ code: "EVENT_SHAPE_UNKNOWN" }),
    );
  });
});
