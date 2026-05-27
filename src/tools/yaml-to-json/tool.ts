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
      icon: "FileText",
      title: "Anchors and aliases",
      description:
        "Multi-doc splits, complex nesting, comments. Whatever's in your kubernetes manifest, parsed against the YAML 1.2 spec.",
    },
    {
      icon: "Lock",
      title: "Nothing leaves the tab",
      description:
        "No upload, no round-trip, no log line. Paste a secret-laden config and close the tab; the bytes never see a server.",
    },
    {
      icon: "SlidersHorizontal",
      title: "Pretty or one-line",
      description:
        "Toggle two-space indent for reading or compact for shipping. Copy to clipboard, or save as output.json.",
    },
  ],
};
