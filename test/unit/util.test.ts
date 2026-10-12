import { describe, it, expect } from "vitest";
import { stripUndefined } from "../../src/util";

describe("stripUndefined", () => {
  it("removes keys whose value is undefined", () => {
    const res = stripUndefined({ a: 1, b: undefined, c: "x" });
    expect(res).toEqual({ a: 1, c: "x" });
    expect("b" in res).toBe(false);
  });

  it("keeps falsy values that are not undefined", () => {
    const res = stripUndefined({
      zero: 0,
      empty: "",
      no: false,
      nothing: null,
    });
    expect(res).toEqual({ zero: 0, empty: "", no: false, nothing: null });
  });

  it("does not mutate its input", () => {
    const input = { a: undefined as number | undefined, b: 2 };
    stripUndefined(input);
    expect(Object.keys(input)).toEqual(["a", "b"]);
  });

  it("returns an empty object for an empty object", () => {
    expect(stripUndefined({})).toEqual({});
  });
});
