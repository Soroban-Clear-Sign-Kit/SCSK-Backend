import { xdr, Address, scValToNative, contract } from "@stellar/stellar-sdk";
import { DisplayValue } from "./types.js";
import { WarningCode } from "./errors.js";
import { MAX_SCVAL_DEPTH, MAX_DISPLAY_STRING } from "./limits.js";

export function decodeScVal(
  scVal: any,
  spec: contract.Spec | null = null,
  typeDef: any = null,
  depth = 0,
): { value: DisplayValue; warnings: { code: WarningCode; message: string }[] } {
  const warnings: { code: WarningCode; message: string }[] = [];

  const scValType =
    typeof scVal.switch === "function" ? scVal.switch().name : scVal.type;

  if (depth > MAX_SCVAL_DEPTH) {
    warnings.push({
      code: "VALUE_TOO_DEEP",
      message: "Maximum recursion depth exceeded",
    });
    return {
      value: { kind: "raw", scvalType: scValType, xdr: scVal.toXDR("base64") },
      warnings,
    };
  }

  const typeDefType = typeDef ? typeDef.type : null;

  // Resolve UDTs
  if (typeDefType === "scSpecTypeUdt") {
    const udtName = typeDef.value.name().toString("utf8");
    const entry = spec?.findEntry(udtName) as any;

    if (entry) {
      const entryType = entry.type;
      if (entryType.includes("Struct")) {
        const fields = entry.value.fields();
        if (scValType === "scvVec") {
          // Tuple struct
          const vec = scVal.value || [];
          const structFields: { name: string; value: DisplayValue }[] = [];
          for (let i = 0; i < fields.length; i++) {
            const f = fields[i];
            const name =
              typeof f.name === "function" ? f.name().toString("utf8") : f.name;
            const fType = typeof f.type === "function" ? f.type() : f.type;
            const val = vec[i];
            if (val) {
              const res = decodeScVal(val, spec, fType, depth + 1);
              warnings.push(...res.warnings);
              structFields.push({ name, value: res.value });
            } else {
              structFields.push({ name, value: { kind: "void" } });
            }
          }
          return {
            value: { kind: "struct", name: udtName, fields: structFields },
            warnings,
          };
        } else if (scValType === "scvMap") {
          // Named struct
          const map = scVal.value || [];
          const structFields: { name: string; value: DisplayValue }[] = [];
          for (const f of fields) {
            const name =
              typeof f.name === "function"
                ? f.name().toString("utf8")
                : f.name
                  ? f.name.toString("utf8")
                  : "";
            const fType = typeof f.type === "function" ? f.type() : f.type;
            const mapEntry = map.find((e: any) => {
              const k = typeof e.key === "function" ? e.key() : e.key;
              const sym = typeof k.sym === "function" ? k.sym() : k.value;
              return sym.toString("utf8") === name;
            });
            if (mapEntry) {
              const v =
                typeof mapEntry.val === "function"
                  ? mapEntry.val()
                  : mapEntry.val;
              const res = decodeScVal(v, spec, fType, depth + 1);
              warnings.push(...res.warnings);
              structFields.push({ name, value: res.value });
            } else {
              structFields.push({ name, value: { kind: "void" } });
            }
          }
          return {
            value: { kind: "struct", name: udtName, fields: structFields },
            warnings,
          };
        }
      } else if (entryType.includes("Enum")) {
        const cases = entry.value.cases();
        if (scValType === "scvVec") {
          const vec = scVal.value || [];
          const variantSymbol = vec[0]?.value?.toString("utf8") || "";
          const c = cases.find(
            (c: any) =>
              (typeof c.name === "function"
                ? c.name().toString("utf8")
                : c.name.toString("utf8")) === variantSymbol,
          );
          if (c && (c.type || typeof c.type === "function")) {
            const fType = typeof c.type === "function" ? c.type() : c.type;
            const res = decodeScVal(vec[1], spec, fType, depth + 1);
            warnings.push(...res.warnings);
            return {
              value: {
                kind: "enum",
                name: udtName,
                variant: variantSymbol,
                values: [res.value],
              },
              warnings,
            };
          }
        } else if (scValType === "scvSymbol") {
          const variantSymbol = scVal.value.toString("utf8");
          return {
            value: {
              kind: "enum",
              name: udtName,
              variant: variantSymbol,
              values: [],
            },
            warnings,
          };
        } else if (scValType === "scvI32") {
          const val = scVal.value;
          const c = cases.find(
            (c: any) =>
              (typeof c.value === "function" ? c.value() : c.value) === val,
          );
          const variantSymbol = c
            ? typeof c.name === "function"
              ? c.name().toString("utf8")
              : c.name.toString("utf8")
            : val.toString();
          return {
            value: {
              kind: "enum",
              name: udtName,
              variant: variantSymbol,
              values: [],
            },
            warnings,
          };
        }
      }
    }
  }

  // Handle Option
  if (typeDefType === "scSpecTypeOption") {
    if (scValType === "scvVoid") {
      return { value: { kind: "option", value: null }, warnings };
    } else {
      const valType =
        typeof typeDef.value.valueType === "function"
          ? typeDef.value.valueType()
          : typeDef.value.valueType;
      const res = decodeScVal(scVal, spec, valType, depth + 1);
      warnings.push(...res.warnings);
      return { value: { kind: "option", value: res.value }, warnings };
    }
  }

  try {
    switch (scValType) {
      case "scvBool":
        return { value: { kind: "bool", value: scVal.value }, warnings };
      case "scvVoid":
        return { value: { kind: "void" }, warnings };
      case "scvU32":
        return {
          value: { kind: "int", type: "u32", value: scVal.value.toString() },
          warnings,
        };
      case "scvI32":
        return {
          value: { kind: "int", type: "i32", value: scVal.value.toString() },
          warnings,
        };
      case "scvU64":
      case "scvI64":
      case "scvU128":
      case "scvI128":
      case "scvU256":
      case "scvI256":
      case "scvTimepoint":
      case "scvDuration": {
        const native = scValToNative(scVal);
        let typeStr = scValType.replace("scv", "").toLowerCase();
        if (typeStr === "timepoint" || typeStr === "duration") {
          return {
            value: { kind: typeStr as any, value: native.toString() },
            warnings,
          };
        }
        return {
          value: {
            kind: "int",
            type: typeStr as any,
            value: native.toString(),
          },
          warnings,
        };
      }
      case "scvBytes": {
        const native = scValToNative(scVal);
        const buf = Buffer.isBuffer(native) ? native : Buffer.from(native);
        let hex = buf.toString("hex");
        let truncated = false;
        if (buf.length > 64) {
          truncated = true;
          hex = hex.slice(0, 128);
        }
        return {
          value: { kind: "bytes", hex, length: buf.length, truncated },
          warnings,
        };
      }
      case "scvString":
      case "scvSymbol": {
        const isStr = scValType === "scvString";
        const str = scValToNative(scVal).toString();
        let truncated = false;
        let finalStr = str;
        if (str.length > MAX_DISPLAY_STRING) {
          truncated = true;
          finalStr = str.slice(0, MAX_DISPLAY_STRING);
        }
        return {
          value: {
            kind: isStr ? "string" : "symbol",
            value: finalStr,
            truncated,
            sanitized: false,
          },
          warnings,
        };
      }
      case "scvAddress": {
        const addrStr = scValToNative(scVal).toString();
        let type: "account" | "contract" | "other" = "other";
        if (addrStr.startsWith("G")) type = "account";
        else if (addrStr.startsWith("C")) type = "contract";
        return {
          value: { kind: "address", value: addrStr, addressType: type as any },
          warnings,
        };
      }
      case "scvVec": {
        const items = scVal.value || [];
        const decodedItems: DisplayValue[] = [];
        const elemDef =
          typeDefType === "scSpecTypeVec"
            ? typeof typeDef.value.elementType === "function"
              ? typeDef.value.elementType()
              : typeDef.value.elementType
            : null;

        for (let i = 0; i < items.length; i++) {
          let itemDef = elemDef;
          if (typeDefType === "scSpecTypeTuple") {
            const types =
              (typeof typeDef.value.valueTypes === "function"
                ? typeDef.value.valueTypes()
                : typeDef.value.valueTypes) || [];
            itemDef = types[i] || null;
          }
          const { value, warnings: w } = decodeScVal(
            items[i],
            spec,
            itemDef,
            depth + 1,
          );
          warnings.push(...w);
          decodedItems.push(value);
        }
        return { value: { kind: "vec", items: decodedItems }, warnings };
      }
      case "scvMap": {
        const entries = scVal.value || [];
        const decodedEntries: { key: DisplayValue; value: DisplayValue }[] = [];
        const keyDef =
          typeDefType === "scSpecTypeMap"
            ? typeof typeDef.value.keyType === "function"
              ? typeDef.value.keyType()
              : typeDef.value.keyType
            : null;
        const valDef =
          typeDefType === "scSpecTypeMap"
            ? typeof typeDef.value.valueType === "function"
              ? typeDef.value.valueType()
              : typeDef.value.valueType
            : null;

        for (const e of entries) {
          const k = typeof e.key === "function" ? e.key() : e.key;
          const v = typeof e.val === "function" ? e.val() : e.val;
          const kRes = decodeScVal(k, spec, keyDef, depth + 1);
          const vRes = decodeScVal(v, spec, valDef, depth + 1);
          warnings.push(...kRes.warnings, ...vRes.warnings);
          decodedEntries.push({ key: kRes.value, value: vRes.value });
        }
        return { value: { kind: "map", entries: decodedEntries }, warnings };
      }
      default:
        warnings.push({
          code: "UNSUPPORTED_SCVAL",
          message: `ScVal type ${scValType} is not fully supported`,
        });
        return {
          value: {
            kind: "raw",
            scvalType: scValType,
            xdr: scVal.toXDR("base64"),
          },
          warnings,
        };
    }
  } catch (e: any) {
    warnings.push({
      code: "INTERNAL_ERROR",
      message: `Failed to decode ScVal: ${e.message}`,
    });
    return {
      value: { kind: "raw", scvalType: scValType, xdr: scVal.toXDR("base64") },
      warnings,
    };
  }
}
