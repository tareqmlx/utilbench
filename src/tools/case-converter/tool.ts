import type { ToolDefinition } from "../types";

export const tool: ToolDefinition = {
  name: "Case Converter",
  slug: "case-converter",
  description: "Convert text between camelCase, snake_case, and more.",
  seoDescription:
    "Free text case converter tool. Transform between camelCase, snake_case, PascalCase, kebab-case, UPPER CASE, Title Case, and more — fast and works offline.",
  category: "text",
  tags: [
    "case",
    "convert",
    "text",
    "transform",
    "camelCase",
    "snake_case",
    "PascalCase",
    "kebab-case",
  ],
  featured: false,
  icon: "CaseSensitive",
  route: () => import("./Route"),
  features: [
    {
      icon: "Zap",
      title: "Instant Conversion",
      description:
        "No delays or loading screens. Everything happens in real-time as you select your options.",
    },
    {
      icon: "CaseSensitive",
      title: "9 Case Types",
      description:
        "camelCase, PascalCase, snake_case, kebab-case, CONSTANT_CASE, Title Case, UPPERCASE, and more.",
    },
    {
      icon: "Monitor",
      title: "Always Available",
      description:
        "Use Case Converter on any device. It's fully responsive and optimized for mobile, tablet, and desktop.",
    },
  ],
};
