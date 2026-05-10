import type { ToolDefinition } from "../types";

export const tool: ToolDefinition = {
  name: "CSV to JSON",
  slug: "csv-to-json",
  description: "Convert CSV files to JSON format with customizable options.",
  seoDescription:
    "Free CSV to JSON converter with customizable delimiters and options. Transform spreadsheet and tabular data into structured JSON format — processes locally, no uploads required.",
  category: "data",
  tags: ["csv", "json", "convert", "table", "spreadsheet", "data-transform", "import", "export"],
  featured: false,
  icon: "Table",
  route: () => import("./Route"),
  features: [
    {
      icon: "Zap",
      title: "Instant Conversion",
      description: "Real-time CSV to JSON transformation as you type with live output preview.",
    },
    {
      icon: "SlidersHorizontal",
      title: "Configurable Parsing",
      description: "Custom delimiters, header row detection, and drag-and-drop file support.",
    },
    {
      icon: "Download",
      title: "Export Ready",
      description: "Copy JSON to clipboard or download as a file with one click.",
    },
  ],
};
