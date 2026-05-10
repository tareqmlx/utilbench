import type { ToolDefinition } from "../types";

export const tool: ToolDefinition = {
  name: "JSON Formatter",
  slug: "json-formatter",
  description: "Format, validate, and beautify JSON with syntax highlighting.",
  seoDescription:
    "Free JSON formatter, validator, and beautifier with syntax highlighting. Paste or upload JSON to format, minify, and validate — an essential Utilbench toolbox utility.",
  category: "data",
  tags: ["json", "format", "validate", "beautify", "minify", "syntax", "pretty-print", "lint"],
  featured: true,
  icon: "Braces",
  route: () => import("./Route"),
  features: [
    {
      icon: "Minimize2",
      title: "Format & Minify",
      description: "Beautify JSON for readability or compress for production in one click.",
    },
    {
      icon: "Zap",
      title: "Instant Validation",
      description: "Identify syntax errors and broken structures instantly as you paste your code.",
    },
    {
      icon: "LayoutGrid",
      title: "Smart Formatting",
      description:
        "Intelligent indentation and spacing following industry-standard JSON best practices.",
    },
  ],
};
