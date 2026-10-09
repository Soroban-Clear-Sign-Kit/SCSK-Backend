import { xdr, StrKey, contract } from "@stellar/stellar-sdk";
import { SpecLoaderOptions, loadSpec } from "./spec.js";
import { decodeScVal } from "./scval.js";
import { WarningCode } from "./errors.js";
import { DisplayValue } from "./types.js";

export interface DecodedEvent {
  contractId: string | null;
  type: "system" | "contract" | "diagnostic" | "unknown";
  topics: DisplayValue[];
  data: DisplayValue;
  eventName: string | null;
  specSource: "wasm" | "injected" | "sac-builtin" | "none";
  warnings: { code: WarningCode; message: string }[];
}

export async function decodeEvent(
  event: xdr.ContractEvent,
  opts: SpecLoaderOptions,
): Promise<DecodedEvent> {
  const warnings: { code: WarningCode; message: string }[] = [];

  let contractId: string | null = null;
  if (event.contractId) {
    contractId = StrKey.encodeContract(new Uint8Array(event.contractId as any));
  }

  let type: "system" | "contract" | "diagnostic" | "unknown" = "unknown";
  const typeStr =
    typeof event.type === "string" ? event.type : (event.type as any).name;
  if (typeStr === "contractEventTypeSystem" || typeStr === "system")
    type = "system";
  else if (typeStr === "contractEventTypeContract" || typeStr === "contract")
    type = "contract";
  else if (
    typeStr === "contractEventTypeDiagnostic" ||
    typeStr === "diagnostic"
  )
    type = "diagnostic";

  const body = event.body.value;
  const topicsScVal = body.topics || [];
  const dataScVal = body.data;

  let specSource: "wasm" | "injected" | "sac-builtin" | "none" = "none";
  let eventName: string | null = null;
  let topicTypes: any[] = [];
  let dataType: any = null;
  let spec: contract.Spec | null = null;

  if (contractId) {
    const specResult = await loadSpec(contractId, opts);
    warnings.push(...specResult.warnings);
    specSource = specResult.source;
    spec = specResult.spec;

    if (spec) {
      // Find matching event in spec
      const events = spec.events();
      for (const e of events) {
        const entry = (e as any).value || e; // scSpecEntryEventV0
        const topicsDefs = entry.topics;
        const dataDef = entry.data;

        // Try to match topics
        // Event Name is usually the first topic, which is a Symbol
        if (topicsDefs.length === topicsScVal.length) {
          let match = true;
          for (let i = 0; i < topicsDefs.length; i++) {
            const defType = topicsDefs[i].type;
            const valType = topicsScVal[i]?.type;
            // A basic check: if def says it's a symbol and it is a symbol, it's a potential match.
            // A perfect match would decode the first topic and compare it to the event name?
            // Actually, Soroban events don't strictly require the first topic to be the name, but usually it is.
            // Spec `parseEvent` matches strictly. We can do a loose match or just take the first that matches types.
            const defName = defType.replace("scSpecType", "").toLowerCase();
            const valName = valType?.replace("scv", "").toLowerCase();
            if (defName === "symbol" && valName !== "symbol") {
              match = false;
              break;
            }
          }
          if (match) {
            eventName =
              typeof entry.name === "function"
                ? entry.name().toString("utf8")
                : entry.name.toString("utf8");
            topicTypes = topicsDefs;
            dataType = dataDef;
            break;
          }
        }
      }
    }
  }

  const topics: DisplayValue[] = topicsScVal.map((t: any, i: number) => {
    const res = decodeScVal(t, spec, topicTypes[i] || null);
    warnings.push(...res.warnings);
    return res.value;
  });

  if (!eventName && topics.length > 0 && topics[0]?.kind === "symbol") {
    eventName = (topics[0] as any).value;
  }

  const dataRes = decodeScVal(dataScVal, spec, dataType);
  warnings.push(...dataRes.warnings);

  return {
    contractId,
    type,
    topics,
    data: dataRes.value,
    eventName,
    specSource,
    warnings,
  };
}
