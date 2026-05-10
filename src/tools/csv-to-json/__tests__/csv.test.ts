import { describe, expect, it } from "vitest";
import { buildJsonFromRows, parseCsvRows, parseCsvToJson } from "../csv";

describe("parseCsvRows", () => {
  it("parses simple comma-delimited rows", () => {
    expect(parseCsvRows("a,b,c\n1,2,3", ",")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles quoted fields with embedded delimiters", () => {
    expect(parseCsvRows('"a,b",c', ",")).toEqual([["a,b", "c"]]);
  });

  it("handles quoted fields with embedded newlines", () => {
    expect(parseCsvRows('"line1\nline2",b', ",")).toEqual([["line1\nline2", "b"]]);
  });

  it("handles escaped quotes (doubled)", () => {
    expect(parseCsvRows('"say ""hello""",b', ",")).toEqual([['say "hello"', "b"]]);
  });

  it("handles \\r\\n line endings", () => {
    expect(parseCsvRows("a,b\r\n1,2", ",")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("ignores trailing newline", () => {
    expect(parseCsvRows("a,b\n1,2\n", ",")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("returns empty array for empty input", () => {
    expect(parseCsvRows("", ",")).toEqual([]);
  });

  it("parses with semicolon delimiter", () => {
    expect(parseCsvRows("a;b;c", ";")).toEqual([["a", "b", "c"]]);
  });

  it("parses with tab delimiter", () => {
    expect(parseCsvRows("a\tb\tc", "\t")).toEqual([["a", "b", "c"]]);
  });

  it("parses with pipe delimiter", () => {
    expect(parseCsvRows("a|b|c", "|")).toEqual([["a", "b", "c"]]);
  });

  it("handles single field row", () => {
    expect(parseCsvRows("hello", ",")).toEqual([["hello"]]);
  });

  it("handles empty fields", () => {
    expect(parseCsvRows(",,,", ",")).toEqual([["", "", "", ""]]);
  });

  it("handles quoted field at end of input without trailing newline", () => {
    expect(parseCsvRows('a,"b"', ",")).toEqual([["a", "b"]]);
  });

  it("preserves whitespace in unquoted fields", () => {
    expect(parseCsvRows("a , b , c", ",")).toEqual([["a ", " b ", " c"]]);
  });

  it("handles unclosed quote at end of input", () => {
    const rows = parseCsvRows('"unclosed', ",");
    expect(rows).toEqual([["unclosed"]]);
  });
});

describe("buildJsonFromRows", () => {
  it("uses first row as headers when hasHeader is true", () => {
    const rows = [
      ["name", "age"],
      ["Alice", "30"],
    ];
    expect(buildJsonFromRows(rows, { hasHeader: true, delimiter: "," })).toEqual([
      { name: "Alice", age: "30" },
    ]);
  });

  it("uses numeric keys when hasHeader is false", () => {
    const rows = [
      ["Alice", "30"],
      ["Bob", "25"],
    ];
    expect(buildJsonFromRows(rows, { hasHeader: false, delimiter: "," })).toEqual([
      { "0": "Alice", "1": "30" },
      { "0": "Bob", "1": "25" },
    ]);
  });

  it("suffixes duplicate headers", () => {
    const rows = [
      ["x", "x", "x"],
      ["1", "2", "3"],
    ];
    expect(buildJsonFromRows(rows, { hasHeader: true, delimiter: "," })).toEqual([
      { x: "1", x_2: "2", x_3: "3" },
    ]);
  });

  it("uses column index for empty headers", () => {
    const rows = [
      ["name", "", "age"],
      ["Alice", "?", "30"],
    ];
    expect(buildJsonFromRows(rows, { hasHeader: true, delimiter: "," })).toEqual([
      { name: "Alice", "1": "?", age: "30" },
    ]);
  });

  it("fills missing fields with empty string for short rows", () => {
    const rows = [["a", "b", "c"], ["1"]];
    expect(buildJsonFromRows(rows, { hasHeader: true, delimiter: "," })).toEqual([
      { a: "1", b: "", c: "" },
    ]);
  });

  it("ignores extra fields beyond header length for long rows", () => {
    const rows = [
      ["a", "b"],
      ["1", "2", "3", "4"],
    ];
    expect(buildJsonFromRows(rows, { hasHeader: true, delimiter: "," })).toEqual([
      { a: "1", b: "2" },
    ]);
  });

  it("clamps rows to header length without column shift", () => {
    const rows = [
      ["a", "b", "c"],
      ["1", "2"],
      ["3", "4", "5", "6"],
    ];
    expect(buildJsonFromRows(rows, { hasHeader: true, delimiter: "," })).toEqual([
      { a: "1", b: "2", c: "" },
      { a: "3", b: "4", c: "5" },
    ]);
  });

  it("returns empty array for empty rows", () => {
    expect(buildJsonFromRows([], { hasHeader: true, delimiter: "," })).toEqual([]);
  });

  it("returns empty array for header-only CSV with hasHeader", () => {
    const rows = [["name", "age"]];
    expect(buildJsonFromRows(rows, { hasHeader: true, delimiter: "," })).toEqual([]);
  });

  it("handles single data row with hasHeader", () => {
    const rows = [
      ["key", "value"],
      ["a", "1"],
    ];
    expect(buildJsonFromRows(rows, { hasHeader: true, delimiter: "," })).toEqual([
      { key: "a", value: "1" },
    ]);
  });
});

describe("parseCsvToJson", () => {
  it("returns empty result for empty input", () => {
    expect(parseCsvToJson("", { hasHeader: true, delimiter: "," })).toEqual({
      result: "",
      error: null,
    });
  });

  it("returns empty result for whitespace-only input", () => {
    expect(parseCsvToJson("   \n  ", { hasHeader: true, delimiter: "," })).toEqual({
      result: "",
      error: null,
    });
  });

  it("converts simple CSV with headers", () => {
    const csv = "name,age\nAlice,30\nBob,25";
    const { result, error } = parseCsvToJson(csv, { hasHeader: true, delimiter: "," });
    expect(error).toBeNull();
    expect(JSON.parse(result)).toEqual([
      { name: "Alice", age: "30" },
      { name: "Bob", age: "25" },
    ]);
  });

  it("converts CSV without headers", () => {
    const csv = "Alice,30\nBob,25";
    const { result, error } = parseCsvToJson(csv, { hasHeader: false, delimiter: "," });
    expect(error).toBeNull();
    expect(JSON.parse(result)).toEqual([
      { "0": "Alice", "1": "30" },
      { "0": "Bob", "1": "25" },
    ]);
  });

  it("handles different delimiters", () => {
    const csv = "a;b;c\n1;2;3";
    const { result, error } = parseCsvToJson(csv, { hasHeader: true, delimiter: ";" });
    expect(error).toBeNull();
    expect(JSON.parse(result)).toEqual([{ a: "1", b: "2", c: "3" }]);
  });

  it("returns pretty-printed JSON with 2-space indent", () => {
    const csv = "a\n1";
    const { result } = parseCsvToJson(csv, { hasHeader: true, delimiter: "," });
    expect(result).toBe('[\n  {\n    "a": "1"\n  }\n]');
  });

  it("returns empty array JSON for header-only CSV with trailing newline", () => {
    const { result, error } = parseCsvToJson("name,age\n", { hasHeader: true, delimiter: "," });
    expect(error).toBeNull();
    expect(JSON.parse(result)).toEqual([]);
  });
});
