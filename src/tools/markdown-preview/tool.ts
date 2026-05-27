import type { ToolDefinition } from "../types";

export const tool: ToolDefinition = {
  name: "Markdown Preview",
  slug: "markdown-preview",
  description: "Render Markdown to clean HTML, live, in your browser.",
  seoDescription:
    "Write GitHub-flavored Markdown and see the rendered HTML side by side. Tables, task lists, fenced code, strikethrough — all parsed locally, nothing uploaded. Handy for drafting READMEs and notes.",
  category: "text",
  tags: ["markdown", "preview", "render", "document", "readme", "gfm", "editor"],
  featured: false,
  icon: "Eye",
  route: () => import("./Route"),
  features: [
    {
      icon: "Zap",
      title: "Live preview",
      description:
        "Type on the left, see rendered HTML on the right. Debounced so long documents stay smooth.",
    },
    {
      icon: "Code",
      title: "GitHub-flavored",
      description:
        "Tables, task lists, strikethrough, fenced code, autolinks — full GFM, parsed locally.",
    },
    {
      icon: "Download",
      title: "Import or export",
      description: "Drop in a .md file, or copy the rendered HTML straight to your clipboard.",
    },
  ],
};
