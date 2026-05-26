import type { ToolDefinition } from "../types";

export const tool: ToolDefinition = {
  name: "JSON Schema Generator",
  slug: "json-schema-generator",
  description: "Generate JSON Schema from sample JSON data.",
  seoDescription:
    "Free JSON Schema generator. Automatically create JSON Schema definitions from sample JSON data. Supports Draft-07 with type inference and nested object detection.",
  category: "data",
  tags: [
    "json",
    "schema",
    "generate",
    "validate",
    "draft-07",
    "type-inference",
    "api",
    "definition",
  ],
  featured: false,
  icon: "FileJson",
  route: () => import("./Route"),
  features: [
    {
      icon: "Zap",
      title: "Real-time Generation",
      description: "Schema updates instantly as you type or paste JSON input.",
    },
    {
      icon: "SlidersHorizontal",
      title: "Configurable Output",
      description: "Toggle required fields, titles, and string format inference.",
    },
    {
      icon: "Code",
      title: "Draft 7 Compliant",
      description:
        "Outputs valid JSON Schema with proper type detection and nested object support.",
    },
  ],
};
