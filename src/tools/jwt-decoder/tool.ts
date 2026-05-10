import type { ToolDefinition } from "../types";

export const tool: ToolDefinition = {
  name: "JWT Decoder",
  slug: "jwt-decoder",
  description: "Decode and inspect JWT tokens without sending data to a server.",
  seoDescription:
    "Free JWT decoder and inspector. Decode JSON Web Tokens to view header, payload, and expiration — fully private, your tokens never leave your device.",
  category: "data",
  tags: [
    "jwt",
    "token",
    "decode",
    "auth",
    "authentication",
    "oauth",
    "bearer",
    "claims",
    "security",
  ],
  featured: true,
  icon: "Key",
  route: () => import("./Route"),
  features: [
    {
      icon: "Zap",
      title: "Instant Decoding",
      description: "Parse and inspect JWT tokens in real-time as you paste.",
    },
    {
      icon: "Clock",
      title: "Time Awareness",
      description: "Automatic detection of expiration, issued-at, and not-before timestamps.",
    },
    {
      icon: "Code",
      title: "Full Inspection",
      description: "View color-coded header, payload, and signature with algorithm details.",
    },
  ],
};
