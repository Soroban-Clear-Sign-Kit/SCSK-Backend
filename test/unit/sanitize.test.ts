import { describe, it, expect } from "vitest";
import { sanitizeString, sanitizeRecursive } from "../../src/sanitize.js";
import { MAX_DISPLAY_STRING } from "../../src/limits.js";

describe("sanitization", () => {
  it("replaces C0 and C1 control characters with ?", () => {
    const res = sanitizeString("Hello\u0000World\u001F\u007F!");
    expect(res.value).toBe("Hello?World??!");
    expect(res.sanitized).toBe(true);
  });

  it("removes bidirectional override and isolate characters", () => {
    const res = sanitizeString("Hello\u202AWorld\u202E");
    expect(res.value).toBe("HelloWorld");
    expect(res.sanitized).toBe(true);
  });

  it("truncates strings longer than MAX_DISPLAY_STRING", () => {
    const longString = "a".repeat(600);
    const res = sanitizeString(longString);
    expect(res.value).toBe("a".repeat(512));
    expect(res.truncated).toBe(true);
  });

  it("sanitizes objects recursively", () => {
    const obj = {
      nested: {
        text: "Hello\u0000World",
      },
      arr: ["a\u202A"],
    };
    const res = sanitizeRecursive(obj);
    expect(res.nested.text).toBe("Hello?World");
    expect(res.arr[0]).toBe("a");
  });

  it("leaves hex fields alone", () => {
    const obj = { hex: "00\u0000FF" };
    const res = sanitizeRecursive(obj);
    expect(res.hex).toBe("00\u0000FF");
  });

  it("leaves xdr fields alone and does not truncate them", () => {
    const longString = "a".repeat(600);
    const obj = { xdr: longString };
    const res = sanitizeRecursive(obj);
    expect(res.xdr).toBe(longString);
  });
});

describe("sanitizeString flags", () => {
  it("reports no changes for clean input", () => {
    expect(sanitizeString("hello")).toEqual({
      value: "hello",
      sanitized: false,
      truncated: false,
    });
  });

  it("handles the empty string", () => {
    expect(sanitizeString("")).toEqual({
      value: "",
      sanitized: false,
      truncated: false,
    });
  });

  it("strips zero-width characters and marks the result sanitized", () => {
    const res = sanitizeString("a\u200Bb\uFEFFc");
    expect(res.value).toBe("abc");
    expect(res.sanitized).toBe(true);
  });

  it("can be both sanitized and truncated", () => {
    const res = sanitizeString("\u202E" + "x".repeat(MAX_DISPLAY_STRING + 10));
    expect(res.sanitized).toBe(true);
    expect(res.truncated).toBe(true);
    expect(res.value.length).toBe(MAX_DISPLAY_STRING);
  });

  it("does not truncate a string of exactly the maximum length", () => {
    const res = sanitizeString("x".repeat(MAX_DISPLAY_STRING));
    expect(res.truncated).toBe(false);
  });
});

describe("sanitizeRecursive passthrough", () => {
  it("returns primitives other than strings unchanged", () => {
    expect(sanitizeRecursive(5)).toBe(5);
    expect(sanitizeRecursive(true)).toBe(true);
    expect(sanitizeRecursive(null)).toBeNull();
    expect(sanitizeRecursive(undefined)).toBeUndefined();
  });

  it("sanitizes strings inside nested arrays", () => {
    expect(sanitizeRecursive({ a: [["x\u0007y"]] })).toEqual({ a: [["x?y"]] });
  });
});
