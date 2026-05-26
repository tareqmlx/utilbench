import type { ToolDefinition } from "../types";

export const tool: ToolDefinition = {
  name: "Diff Checker",
  slug: "diff-checker",
  description: "Compare two texts and highlight the differences.",
  seoDescription:
    "Free online diff checker and text comparison tool. Compare two blocks of text side-by-side with highlighted differences. Ideal for reviewing changes and document comparison.",
  category: "text",
  tags: ["diff", "compare", "text", "merge", "review", "side-by-side", "changelog", "patch"],
  featured: false,
  icon: "GitCompare",
  route: () => import("./Route"),
  features: [
    {
      icon: "ArrowLeftRight",
      title: "Multiple Views",
      description: "Side-by-side, inline, and unified diff views for any comparison workflow.",
    },
    {
      icon: "Zap",
      title: "Instant Comparison",
      description:
        "Optimized diffing algorithm provides near-instant results even for large files and long blocks of text.",
    },
    {
      icon: "Code",
      title: "Developer Tools",
      description:
        "Clean output with support for line numbers, syntax highlighting, and multiple view modes for complex code reviews.",
    },
  ],
};
