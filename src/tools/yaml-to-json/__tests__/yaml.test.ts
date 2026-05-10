import { describe, expect, it } from "vitest";
import { convertYamlToJson } from "../yaml";

describe("convertYamlToJson", () => {
  it("returns empty result for empty string", () => {
    expect(convertYamlToJson("", true)).toEqual({ result: "", error: null });
  });

  it("returns empty result for whitespace-only input", () => {
    expect(convertYamlToJson("   \n  \t  ", true)).toEqual({ result: "", error: null });
  });

  it("converts simple key-value pairs", () => {
    const yaml = "name: hello\nversion: 1";
    const { result, error } = convertYamlToJson(yaml, true);
    expect(error).toBeNull();
    expect(JSON.parse(result)).toEqual({ name: "hello", version: 1 });
  });

  it("converts nested objects", () => {
    const yaml = "server:\n  host: localhost\n  port: 8080";
    const { result, error } = convertYamlToJson(yaml, true);
    expect(error).toBeNull();
    expect(JSON.parse(result)).toEqual({ server: { host: "localhost", port: 8080 } });
  });

  it("converts arrays (sequences)", () => {
    const yaml = "items:\n  - apple\n  - banana\n  - cherry";
    const { result, error } = convertYamlToJson(yaml, true);
    expect(error).toBeNull();
    expect(JSON.parse(result)).toEqual({ items: ["apple", "banana", "cherry"] });
  });

  it("pretty prints with 2-space indent", () => {
    const yaml = "a: 1";
    const { result } = convertYamlToJson(yaml, true);
    expect(result).toContain("\n");
    expect(result).toContain("  ");
  });

  it("outputs minified JSON when prettyPrint is false", () => {
    const yaml = "a: 1\nb: 2";
    const { result } = convertYamlToJson(yaml, false);
    expect(result).toBe('{"a":1,"b":2}');
  });

  it("returns error for malformed YAML", () => {
    const yaml = "key: [invalid: yaml: {{";
    const { result, error } = convertYamlToJson(yaml, true);
    expect(result).toBe("");
    expect(error).toBeTruthy();
  });

  it("handles multi-document YAML as array", () => {
    const yaml = "---\nname: first\n---\nname: second";
    const { result, error } = convertYamlToJson(yaml, true);
    expect(error).toBeNull();
    const parsed = JSON.parse(result);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({ name: "first" });
    expect(parsed[1]).toEqual({ name: "second" });
  });

  it("treats single doc with --- prefix as single object (not array)", () => {
    const yaml = "---\nname: only";
    const { result, error } = convertYamlToJson(yaml, true);
    expect(error).toBeNull();
    const parsed = JSON.parse(result);
    expect(Array.isArray(parsed)).toBe(false);
    expect(parsed).toEqual({ name: "only" });
  });

  it("preserves booleans, nulls, and numbers as types", () => {
    const yaml = "flag: true\ncount: 42\nnothing: null\nprice: 3.14";
    const { result, error } = convertYamlToJson(yaml, true);
    expect(error).toBeNull();
    const parsed = JSON.parse(result);
    expect(parsed.flag).toBe(true);
    expect(parsed.count).toBe(42);
    expect(parsed.nothing).toBeNull();
    expect(parsed.price).toBe(3.14);
  });

  it("strips comments", () => {
    const yaml = "# this is a comment\nkey: value # inline comment";
    const { result, error } = convertYamlToJson(yaml, true);
    expect(error).toBeNull();
    const parsed = JSON.parse(result);
    expect(parsed).toEqual({ key: "value" });
    expect(result).not.toContain("#");
  });

  it("returns null for comment-only input", () => {
    const yaml = "# just a comment\n# another comment";
    const { result, error } = convertYamlToJson(yaml, true);
    expect(error).toBeNull();
    expect(result).toBe("null");
  });
});
