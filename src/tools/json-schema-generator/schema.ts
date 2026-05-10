export interface SchemaOptions {
  required: boolean;
  includeTitle: boolean;
  inferFormats: boolean;
}

export interface JsonSchema {
  $schema?: string;
  title?: string;
  description?: string;
  type?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  format?: string;
  anyOf?: JsonSchema[];
}

const FORMAT_PATTERNS: [string, RegExp][] = [
  ["uuid", /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i],
  ["ipv4", /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/],
  ["date-time", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/],
  ["date", /^\d{4}-\d{2}-\d{2}$/],
  ["email", /^[^\s@]+@[^\s@]+\.[^\s@]+$/],
  ["uri", /^https?:\/\//],
];

export function humanizeKey(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function detectFormat(value: string): string | undefined {
  for (const [format, pattern] of FORMAT_PATTERNS) {
    if (pattern.test(value)) return format;
  }
  return undefined;
}

function schemasEqual(a: JsonSchema, b: JsonSchema): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function mergeObjectSchemas(schemas: JsonSchema[], options: SchemaOptions): JsonSchema {
  const allKeys = new Set<string>();
  const keySchemas: Record<string, JsonSchema[]> = {};

  for (const schema of schemas) {
    if (schema.properties) {
      for (const key of Object.keys(schema.properties)) {
        allKeys.add(key);
        const arr = keySchemas[key] ?? [];
        const prop = schema.properties[key];
        if (prop) arr.push(prop);
        keySchemas[key] = arr;
      }
    }
  }

  const properties: Record<string, JsonSchema> = {};
  for (const key of allKeys) {
    const keyVals = keySchemas[key] ?? [];
    const unique = deduplicateSchemas(keyVals);
    properties[key] = unique.length === 1 ? (unique[0] ?? {}) : { anyOf: unique };
  }

  const requiredKeys = options.required
    ? [...allKeys].filter((key) => schemas.every((s) => s.properties?.[key] !== undefined))
    : undefined;

  const merged: JsonSchema = { type: "object", properties };
  if (requiredKeys && requiredKeys.length > 0) {
    merged.required = requiredKeys;
  }
  if (options.includeTitle) {
    for (const key of Object.keys(properties)) {
      const existing = properties[key] ?? {};
      properties[key] = { title: humanizeKey(key), ...existing };
    }
  }
  return merged;
}

function deduplicateSchemas(schemas: JsonSchema[]): JsonSchema[] {
  const unique: JsonSchema[] = [];
  for (const s of schemas) {
    if (!unique.some((u) => schemasEqual(u, s))) {
      unique.push(s);
    }
  }
  return unique;
}

function inferArrayItems(items: unknown[], options: SchemaOptions): JsonSchema {
  if (items.length === 0) return { type: "array" };

  const itemSchemas = items.map((item) => generateSchema(item, options));
  const objectSchemas = itemSchemas.filter((s) => s.type === "object");
  const nonObjectSchemas = itemSchemas.filter((s) => s.type !== "object");

  const mergedParts: JsonSchema[] = [];

  if (objectSchemas.length > 0) {
    mergedParts.push(mergeObjectSchemas(objectSchemas, options));
  }

  for (const s of nonObjectSchemas) {
    if (!mergedParts.some((m) => schemasEqual(m, s))) {
      mergedParts.push(s);
    }
  }

  const result: JsonSchema = { type: "array" };
  if (mergedParts.length === 1) {
    result.items = mergedParts[0] ?? {};
  } else {
    result.items = { anyOf: mergedParts };
  }
  return result;
}

export function generateSchema(value: unknown, options: SchemaOptions): JsonSchema {
  if (value === null) return { type: "null" };

  switch (typeof value) {
    case "boolean":
      return { type: "boolean" };
    case "number":
      return { type: Number.isInteger(value) ? "integer" : "number" };
    case "string": {
      const schema: JsonSchema = { type: "string" };
      if (options.inferFormats) {
        const format = detectFormat(value);
        if (format) schema.format = format;
      }
      return schema;
    }
    case "object": {
      if (Array.isArray(value)) {
        return inferArrayItems(value, options);
      }

      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj);
      const properties: Record<string, JsonSchema> = {};

      for (const key of keys) {
        const propSchema = generateSchema(obj[key], options);
        if (options.includeTitle) {
          properties[key] = { title: humanizeKey(key), ...propSchema };
        } else {
          properties[key] = propSchema;
        }
      }

      const schema: JsonSchema = { type: "object", properties };
      if (options.required && keys.length > 0) {
        schema.required = keys;
      }
      return schema;
    }
    default:
      return {};
  }
}

export function generateRootSchema(input: unknown, options: SchemaOptions): JsonSchema {
  const schema = generateSchema(input, options);
  const root: JsonSchema = {
    $schema: "http://json-schema.org/draft-07/schema#",
    ...schema,
  };
  if (options.includeTitle) {
    root.title = "GeneratedSchema";
    root.description = "Auto-generated JSON Schema";
  }
  return root;
}
