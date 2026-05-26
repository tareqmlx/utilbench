import type { ToolDefinition } from "../types";

export const tool: ToolDefinition = {
  name: "Base64 Encoder",
  slug: "base64-encoder",
  description: "Encode and decode Base64 strings.",
  seoDescription:
    "Free online Base64 encoder and decoder. Convert text to and from Base64 format instantly. Runs locally, no data sent to servers.",
  category: "data",
  tags: ["base64", "encode", "decode", "converter", "online-tool"],
  featured: false,
  icon: "Lock",
  route: () => import("./Route"),
  features: [
    {
      icon: "RefreshCw",
      title: "Bidirectional",
      description: "Encode and decode seamlessly with a single toggle switch.",
    },
    {
      icon: "Zap",
      title: "Fast & Free",
      description:
        "High-performance processing that handles even large text inputs instantly without any usage limits.",
    },
    {
      icon: "Terminal",
      title: "Developer Friendly",
      description:
        "Perfect for debugging APIs, webhooks, or preparing data for cross-platform transmission.",
    },
  ],
};
