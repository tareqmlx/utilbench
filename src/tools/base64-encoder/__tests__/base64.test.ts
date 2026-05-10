import { describe, expect, it } from "vitest";
import { convert, decodeBase64, encodeBase64 } from "../base64";

describe("encodeBase64 / decodeBase64", () => {
  it("roundtrips ASCII text", () => {
    const text = "Hello, World!";
    expect(decodeBase64(encodeBase64(text))).toBe(text);
  });

  it("roundtrips Unicode (emoji, CJK, accented chars)", () => {
    const text = "Hej! Sch\u00f6n \u4f60\u597d \ud83d\ude80";
    expect(decodeBase64(encodeBase64(text))).toBe(text);
  });

  it("encodes known ASCII value correctly", () => {
    expect(encodeBase64("Hello")).toBe("SGVsbG8=");
  });

  it("decodes known Base64 value correctly", () => {
    expect(decodeBase64("SGVsbG8=")).toBe("Hello");
  });

  it("handles empty string", () => {
    expect(encodeBase64("")).toBe("");
    expect(decodeBase64("")).toBe("");
  });
});

describe("convert", () => {
  it("returns empty result for empty input", () => {
    expect(convert("", "encode")).toEqual({ result: "", error: null });
    expect(convert("", "decode")).toEqual({ result: "", error: null });
  });

  it("encodes in encode mode", () => {
    const { result, error } = convert("Hello", "encode");
    expect(result).toBe("SGVsbG8=");
    expect(error).toBeNull();
  });

  it("decodes in decode mode", () => {
    const { result, error } = convert("SGVsbG8=", "decode");
    expect(result).toBe("Hello");
    expect(error).toBeNull();
  });

  it("returns error for invalid Base64 in decode mode", () => {
    const { result, error } = convert("not-valid-base64!!!", "decode");
    expect(result).toBe("");
    expect(error).toMatch(/Invalid Base64/);
  });
});
