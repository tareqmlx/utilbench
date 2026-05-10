export type Delimiter = "," | ";" | "\t" | "|";

export interface CsvToJsonOptions {
  hasHeader: boolean;
  delimiter: Delimiter;
}

export interface CsvToJsonResult {
  result: string;
  error: string | null;
}

enum State {
  FIELD_START = 0,
  UNQUOTED = 1,
  QUOTED = 2,
  QUOTE_IN_QUOTED = 3,
}

export function parseCsvRows(csv: string, delimiter: Delimiter): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let state: State = State.FIELD_START;

  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i] as string;

    switch (state) {
      case State.FIELD_START:
        if (ch === '"') {
          state = State.QUOTED;
        } else if (ch === delimiter) {
          row.push(field);
          field = "";
        } else if (ch === "\r") {
          if (csv[i + 1] === "\n") i++;
          row.push(field);
          rows.push(row);
          row = [];
          field = "";
        } else if (ch === "\n") {
          row.push(field);
          rows.push(row);
          row = [];
          field = "";
        } else {
          field += ch;
          state = State.UNQUOTED;
        }
        break;

      case State.UNQUOTED:
        if (ch === delimiter) {
          row.push(field);
          field = "";
          state = State.FIELD_START;
        } else if (ch === "\r") {
          if (csv[i + 1] === "\n") i++;
          row.push(field);
          rows.push(row);
          row = [];
          field = "";
          state = State.FIELD_START;
        } else if (ch === "\n") {
          row.push(field);
          rows.push(row);
          row = [];
          field = "";
          state = State.FIELD_START;
        } else {
          field += ch;
        }
        break;

      case State.QUOTED:
        if (ch === '"') {
          state = State.QUOTE_IN_QUOTED;
        } else {
          field += ch;
        }
        break;

      case State.QUOTE_IN_QUOTED:
        if (ch === '"') {
          field += '"';
          state = State.QUOTED;
        } else if (ch === delimiter) {
          row.push(field);
          field = "";
          state = State.FIELD_START;
        } else if (ch === "\r") {
          if (csv[i + 1] === "\n") i++;
          row.push(field);
          rows.push(row);
          row = [];
          field = "";
          state = State.FIELD_START;
        } else if (ch === "\n") {
          row.push(field);
          rows.push(row);
          row = [];
          field = "";
          state = State.FIELD_START;
        } else {
          field += ch;
          state = State.UNQUOTED;
        }
        break;
    }
  }

  if (state !== State.FIELD_START || field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

export function buildJsonFromRows(
  rows: string[][],
  options: CsvToJsonOptions,
): Record<string, string | null>[] {
  if (rows.length === 0) return [];

  if (options.hasHeader) {
    const headerRow = rows[0] as string[];
    const seen = new Map<string, number>();
    const keys = headerRow.map((h, idx) => {
      const base = h === "" ? String(idx) : h;
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      return count === 0 ? base : `${base}_${count + 1}`;
    });

    return rows.slice(1).map((row) => {
      const obj: Record<string, string | null> = {};
      for (let i = 0; i < keys.length; i++) {
        obj[keys[i] as string] = i < row.length ? (row[i] ?? "") : "";
      }
      // Extra columns beyond header length are ignored to avoid phantom keys.
      return obj;
    });
  }

  return rows.map((row) => {
    const obj: Record<string, string | null> = {};
    for (let i = 0; i < row.length; i++) {
      obj[String(i)] = row[i] ?? null;
    }
    return obj;
  });
}

export function parseCsvToJson(csv: string, options: CsvToJsonOptions): CsvToJsonResult {
  if (csv.trim() === "") return { result: "", error: null };

  try {
    const rows = parseCsvRows(csv, options.delimiter);
    const data = buildJsonFromRows(rows, options);
    return { result: JSON.stringify(data, null, 2), error: null };
  } catch {
    return { result: "", error: "Failed to parse CSV — check your input format" };
  }
}
