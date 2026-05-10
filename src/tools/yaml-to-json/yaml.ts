import jsYaml from "js-yaml";

export interface YamlToJsonResult {
  result: string;
  error: string | null;
}

export function convertYamlToJson(input: string, prettyPrint: boolean): YamlToJsonResult {
  if (input.trim() === "") {
    return { result: "", error: null };
  }

  try {
    const docs: unknown[] = [];
    jsYaml.loadAll(input, (doc) => docs.push(doc));

    const data = docs.length === 1 ? docs[0] : docs;
    const json = JSON.stringify(data, null, prettyPrint ? 2 : undefined);
    return { result: json, error: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to parse YAML";
    return { result: "", error: message };
  }
}

export const SAMPLE_YAML = `# Project configuration
name: my-project
version: 2.1.0
description: A sample YAML document

# Server settings
server:
  host: localhost
  port: 8080
  ssl: true

# Features list
features:
  - name: authentication
    enabled: true
  - name: caching
    enabled: false

# Environment
environment: production
debug: null
max_connections: 100
`;
