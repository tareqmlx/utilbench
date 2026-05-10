import type { ToolDefinition } from "../types";

export const tool: ToolDefinition = {
  name: "SVG Optimizer",
  slug: "svg-optimizer",
  description: "Optimize and minify SVG files while preserving visual quality.",
  seoDescription:
    "Free SVG optimizer and minifier. Reduce SVG file size by removing unnecessary metadata, comments, and redundant attributes — powered by SVGO, runs locally in your toolbox.",
  category: "media",
  tags: ["svg", "optimize", "minify", "vector", "svgo", "compress", "clean", "web-performance"],
  featured: false,
  icon: "PenTool",
  route: () => import("./Route"),
  features: [
    {
      icon: "Zap",
      title: "Instant Optimization",
      description: "Files are processed automatically on upload with no extra steps.",
    },
    {
      icon: "Settings2",
      title: "Configurable",
      description: "Toggle cleanup options, attributes, and choose from built-in presets.",
    },
    {
      icon: "Download",
      title: "Batch Support",
      description: "Process multiple SVGs at once and download all as a ZIP archive.",
    },
  ],
};
