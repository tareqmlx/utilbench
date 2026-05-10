import { describe, expect, it } from "vitest";
import { type SchemaOptions, generateRootSchema, generateSchema, humanizeKey } from "../schema";

const defaults: SchemaOptions = { required: true, includeTitle: false, inferFormats: true };

describe("humanizeKey", () => {
  it("converts camelCase to Title Case", () => {
    expect(humanizeKey("firstName")).toBe("First Name");
  });

  it("converts snake_case to Title Case", () => {
    expect(humanizeKey("first_name")).toBe("First Name");
  });

  it("converts kebab-case to Title Case", () => {
    expect(humanizeKey("first-name")).toBe("First Name");
  });

  it("handles single word", () => {
    expect(humanizeKey("name")).toBe("Name");
  });
});

describe("generateSchema — primitives", () => {
  it("infers null", () => {
    expect(generateSchema(null, defaults)).toEqual({ type: "null" });
  });

  it("infers boolean", () => {
    expect(generateSchema(true, defaults)).toEqual({ type: "boolean" });
    expect(generateSchema(false, defaults)).toEqual({ type: "boolean" });
  });

  it("infers integer", () => {
    expect(generateSchema(42, defaults)).toEqual({ type: "integer" });
  });

  it("infers number (float)", () => {
    expect(generateSchema(3.14, defaults)).toEqual({ type: "number" });
  });

  it("infers string", () => {
    expect(generateSchema("hello", defaults)).toEqual({ type: "string" });
  });
});

describe("generateSchema — string formats", () => {
  it("detects email", () => {
    expect(generateSchema("user@example.com", defaults)).toEqual({
      type: "string",
      format: "email",
    });
  });

  it("detects date", () => {
    expect(generateSchema("2024-01-15", defaults)).toEqual({
      type: "string",
      format: "date",
    });
  });

  it("detects date-time", () => {
    expect(generateSchema("2024-01-15T10:30:00Z", defaults)).toEqual({
      type: "string",
      format: "date-time",
    });
  });

  it("detects uri", () => {
    expect(generateSchema("https://example.com/path", defaults)).toEqual({
      type: "string",
      format: "uri",
    });
  });

  it("detects uuid", () => {
    expect(generateSchema("550e8400-e29b-41d4-a716-446655440000", defaults)).toEqual({
      type: "string",
      format: "uuid",
    });
  });

  it("detects ipv4", () => {
    expect(generateSchema("192.168.1.1", defaults)).toEqual({
      type: "string",
      format: "ipv4",
    });
  });

  it("does not detect format for plain string", () => {
    expect(generateSchema("hello world", defaults)).toEqual({ type: "string" });
  });

  it("skips format detection when inferFormats is off", () => {
    expect(generateSchema("user@example.com", { ...defaults, inferFormats: false })).toEqual({
      type: "string",
    });
  });
});

describe("generateSchema — objects", () => {
  it("infers flat object", () => {
    const result = generateSchema({ name: "John", age: 30 }, defaults);
    expect(result).toEqual({
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "integer" },
      },
      required: ["name", "age"],
    });
  });

  it("infers nested object", () => {
    const result = generateSchema({ user: { name: "John" } }, defaults);
    expect(result).toEqual({
      type: "object",
      properties: {
        user: {
          type: "object",
          properties: {
            name: { type: "string" },
          },
          required: ["name"],
        },
      },
      required: ["user"],
    });
  });

  it("omits required when option is off", () => {
    const result = generateSchema({ name: "John" }, { ...defaults, required: false });
    expect(result.required).toBeUndefined();
  });

  it("adds title when includeTitle is on", () => {
    const result = generateSchema({ firstName: "John" }, { ...defaults, includeTitle: true });
    expect(result.properties?.firstName).toEqual({
      title: "First Name",
      type: "string",
    });
  });

  it("handles empty object", () => {
    const result = generateSchema({}, defaults);
    expect(result).toEqual({ type: "object", properties: {} });
  });
});

describe("generateSchema — arrays", () => {
  it("infers empty array", () => {
    expect(generateSchema([], defaults)).toEqual({ type: "array" });
  });

  it("infers uniform array", () => {
    expect(generateSchema([1, 2, 3], defaults)).toEqual({
      type: "array",
      items: { type: "integer" },
    });
  });

  it("infers mixed-type array with anyOf", () => {
    const result = generateSchema([1, "hello"], defaults);
    expect(result).toEqual({
      type: "array",
      items: { anyOf: [{ type: "integer" }, { type: "string" }] },
    });
  });

  it("merges array of objects", () => {
    const result = generateSchema(
      [
        { name: "Alice", age: 30 },
        { name: "Bob", age: 25 },
      ],
      defaults,
    );
    expect(result).toEqual({
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "integer" },
        },
        required: ["name", "age"],
      },
    });
  });

  it("computes required as intersection for objects with different keys", () => {
    const result = generateSchema(
      [
        { name: "Alice", age: 30 },
        { name: "Bob", email: "bob@test.com" },
      ],
      defaults,
    );
    expect(result.items?.required).toEqual(["name"]);
  });

  it("handles null in arrays", () => {
    const result = generateSchema([null, "hello"], defaults);
    expect(result).toEqual({
      type: "array",
      items: { anyOf: [{ type: "null" }, { type: "string" }] },
    });
  });
});

describe("generateRootSchema", () => {
  it("includes $schema header", () => {
    const result = generateRootSchema({ id: 1 }, defaults);
    expect(result.$schema).toBe("http://json-schema.org/draft-07/schema#");
  });

  it("includes root title when includeTitle is on", () => {
    const result = generateRootSchema({ id: 1 }, { ...defaults, includeTitle: true });
    expect(result.title).toBe("GeneratedSchema");
    expect(result.description).toBe("Auto-generated JSON Schema");
  });

  it("omits root title when includeTitle is off", () => {
    const result = generateRootSchema({ id: 1 }, defaults);
    expect(result.title).toBeUndefined();
  });

  it("handles top-level array", () => {
    const result = generateRootSchema([1, 2], defaults);
    expect(result.type).toBe("array");
    expect(result.$schema).toBe("http://json-schema.org/draft-07/schema#");
  });

  it("handles top-level primitive", () => {
    const result = generateRootSchema("hello", defaults);
    expect(result.type).toBe("string");
    expect(result.$schema).toBe("http://json-schema.org/draft-07/schema#");
  });

  it("handles deeply nested structure", () => {
    const result = generateRootSchema({ a: { b: { c: { d: 1 } } } }, defaults);
    expect(result.properties?.a?.properties?.b?.properties?.c?.properties?.d).toEqual({
      type: "integer",
    });
  });
});
