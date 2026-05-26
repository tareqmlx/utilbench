import type { ToolDefinition } from "../types";

export const tool: ToolDefinition = {
  name: "Markdown Preview",
  slug: "markdown-preview",
  description: "Preview Markdown with live rendering and syntax highlighting.",
  seoDescription:
    "Free Markdown previewer with live rendering and syntax highlighting. Write and preview Markdown in real-time with GitHub-flavored Markdown support. Great for README editing.",
  category: "text",
  tags: ["markdown", "preview", "render", "document", "readme", "gfm", "editor"],
  featured: false,
  icon: "Eye",
  route: () => import("./Route"),
  features: [
    {
      icon: "Zap",
      title: "Real-time Preview",
      description: "See rendered output update live as you type with debounced rendering.",
    },
    {
      icon: "Code",
      title: "GFM Support",
      description:
        "Tables, task lists, strikethrough, code blocks, and full GitHub Flavored Markdown.",
    },
    {
      icon: "Download",
      title: "Import & Export",
      description: "Import .md files and copy rendered HTML to clipboard.",
    },
  ],
};
