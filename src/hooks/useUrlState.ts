import { useCallback, useMemo, useRef } from "react";
import { useSearchParams } from "react-router";

type FieldType = "string" | "number" | "boolean";

interface FieldSchema<T extends FieldType> {
  type: T;
  defaultValue: T extends "string" ? string : T extends "number" ? number : boolean;
}

type SchemaMap = Record<string, FieldSchema<FieldType>>;

type InferState<S extends SchemaMap> = {
  [K in keyof S]: S[K] extends FieldSchema<"string">
    ? string
    : S[K] extends FieldSchema<"number">
      ? number
      : S[K] extends FieldSchema<"boolean">
        ? boolean
        : never;
};

const MAX_URL_VALUE_LENGTH = 1500;

function deserialize(
  raw: string | null,
  schema: FieldSchema<FieldType>,
): string | number | boolean {
  if (raw === null) return schema.defaultValue;

  switch (schema.type) {
    case "number": {
      const n = Number(raw);
      return Number.isFinite(n) ? n : schema.defaultValue;
    }
    case "boolean":
      return raw === "1";
    default:
      return raw;
  }
}

function serialize(value: string | number | boolean, schema: FieldSchema<FieldType>): string {
  switch (schema.type) {
    case "boolean":
      return value ? "1" : "0";
    default:
      return String(value);
  }
}

export function useUrlState<S extends SchemaMap>(
  schema: S,
): [InferState<S>, (patch: Partial<InferState<S>>) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const schemaRef = useRef(schema);

  const state = useMemo(() => {
    const s = schemaRef.current;
    const result: Record<string, string | number | boolean> = {};
    for (const key of Object.keys(s)) {
      const fieldSchema = s[key];
      if (fieldSchema) {
        result[key] = deserialize(searchParams.get(key), fieldSchema);
      }
    }
    return result as InferState<S>;
  }, [searchParams]);

  const setState = useCallback(
    (patch: Partial<InferState<S>>) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          const s = schemaRef.current;

          for (const [key, value] of Object.entries(patch)) {
            const fieldSchema = s[key];
            if (!fieldSchema) continue;

            const serialized = serialize(value as string | number | boolean, fieldSchema);

            // Omit default values for clean URLs
            if (serialized === serialize(fieldSchema.defaultValue, fieldSchema)) {
              next.delete(key);
            } else if (serialized.length > MAX_URL_VALUE_LENGTH) {
              // Safety valve: don't write overly long values
              next.delete(key);
            } else {
              next.set(key, serialized);
            }
          }

          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return [state, setState];
}
