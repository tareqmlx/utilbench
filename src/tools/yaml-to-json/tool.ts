import type { ToolDefinition } from "../types";

export const tool: ToolDefinition = {
  name: "YAML to JSON",
  slug: "yaml-to-json",
  description: "Convert YAML data to JSON format.",
  seoDescription:
    "Free YAML to JSON converter. Transform YAML configuration files into JSON format with validation and error highlighting. Essential for DevOps and configuration management.",
  category: "data",
  tags: [
    "yaml",
    "json",
    "convert",
    "transform",
    "config",
    "devops",
    "kubernetes",
    "docker-compose",
  ],
  featured: false,
  icon: "ArrowLeftRight",
  route: () => import("./Route"),
  features: [
    {
      icon: "Zap",
      title: "Instant Conversion",
      description:
        "High-performance parser handles complex YAML structures in milliseconds right in your browser tab.",
    },
    {
      icon: "FileText",
      title: "YAML 1.2 Compliant",
      description: "Full spec support for anchors, aliases, and complex nested structures.",
    },
    {
      icon: "Code",
      title: "Developer Friendly",
      description:
        "Supports YAML 1.2 specifications and outputs clean, formatted JSON compliant with modern standards.",
    },
  ],
};
