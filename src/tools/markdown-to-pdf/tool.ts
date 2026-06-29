import type { ToolDefinition } from "../types";

export const tool: ToolDefinition = {
  name: "Markdown to PDF",
  slug: "markdown-to-pdf",
  description:
    "Convert Markdown into a clean, print-ready PDF — choose page size, margins, and fonts.",
  seoDescription:
    "Free online Markdown to PDF converter. Write or paste Markdown, preview it live, and save a clean PDF with selectable text — A4 or Letter, custom margins. Runs 100% in your browser; nothing is uploaded.",
  category: "text",
  tags: ["markdown", "md", "pdf", "convert", "export", "print", "document", "gfm", "privacy"],
  featured: false,
  icon: "FileType",
  route: () => import("./Route"),
  features: [
    {
      icon: "FileText",
      title: "GitHub-Flavored Markdown",
      description:
        "Headings, tables, task lists, code blocks, and links render just like on GitHub.",
    },
    {
      icon: "Download",
      title: "Real, Selectable Text",
      description:
        "Output is true PDF text — selectable, searchable, and accessible, not a screenshot.",
    },
    {
      icon: "ShieldCheck",
      title: "100% Private",
      description: "Rendering happens entirely in your browser. Your document is never uploaded.",
    },
  ],
};
