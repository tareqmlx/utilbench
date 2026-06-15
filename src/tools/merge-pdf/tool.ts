import type { ToolDefinition } from "../types";

export const tool: ToolDefinition = {
  name: "Merge PDF",
  slug: "merge-pdf",
  description: "Combine multiple PDF files into one, in any order.",
  seoDescription:
    "Free online PDF merger. Combine multiple PDFs into a single file, drag to reorder, no quality loss. Runs 100% in your browser. Files are never uploaded.",
  category: "data",
  tags: ["pdf", "merge", "combine", "join", "concatenate", "documents", "organize", "privacy"],
  featured: true,
  icon: "Combine",
  route: () => import("./Route"),
  features: [
    {
      icon: "ArrowDownUp",
      title: "Drag to Reorder",
      description: "Arrange files in any order with drag-and-drop or move buttons before merging.",
    },
    {
      icon: "Layers",
      title: "Batch Merge",
      description: "Combine up to 50 PDFs into a single document in one pass.",
    },
    {
      icon: "ShieldCheck",
      title: "100% Private",
      description: "Merging happens entirely in your browser. Your PDFs are never uploaded.",
    },
  ],
};
