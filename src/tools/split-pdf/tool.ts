import type { ToolDefinition } from "../types";

export const tool: ToolDefinition = {
  name: "Split PDF",
  slug: "split-pdf",
  description: "Split a PDF into multiple files by page range, every N pages, or one per page.",
  seoDescription:
    "Free online PDF splitter. Split a PDF by page ranges, every N pages, or into single pages — download as a ZIP. Runs 100% in your browser. Files are never uploaded.",
  category: "data",
  tags: ["pdf", "split", "separate", "extract", "pages", "range", "divide", "documents", "privacy"],
  featured: false,
  icon: "Scissors",
  route: () => import("./Route"),
  features: [
    {
      icon: "Scissors",
      title: "Flexible Splitting",
      description: "Cut by custom page ranges, every N pages, or burst into one file per page.",
    },
    {
      icon: "Layers",
      title: "Batch Download",
      description: "Get every output PDF in a single ZIP, named by the pages it contains.",
    },
    {
      icon: "ShieldCheck",
      title: "100% Private",
      description: "Splitting happens entirely in your browser. Your PDF is never uploaded.",
    },
  ],
};
