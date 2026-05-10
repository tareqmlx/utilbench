import type { ToolDefinition } from "../types";

export const tool: ToolDefinition = {
  name: "Lorem Ipsum",
  slug: "lorem-ipsum",
  description: "Generate placeholder text for your designs and mockups.",
  seoDescription:
    "Free Lorem Ipsum generator. Generate customizable placeholder text by paragraphs, sentences, or words — perfect for mockups, prototypes, and design projects.",
  category: "text",
  tags: ["lorem", "ipsum", "placeholder", "text", "dummy-text", "mockup", "design", "prototype"],
  featured: false,
  icon: "NotepadText",
  route: () => import("./Route"),
  features: [
    {
      icon: "Zap",
      title: "Instant Generation",
      description: "Generate placeholder text on demand with no delays.",
    },
    {
      icon: "SlidersHorizontal",
      title: "Flexible Options",
      description: "Choose between paragraphs, words, or bytes with customizable amounts.",
    },
    {
      icon: "Code",
      title: "HTML Support",
      description: "Optionally wrap output in paragraph tags for direct use in markup.",
    },
  ],
};
