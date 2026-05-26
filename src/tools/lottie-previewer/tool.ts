import type { ToolDefinition } from "../types";

export const tool: ToolDefinition = {
  name: "Lottie Previewer",
  slug: "lottie-previewer",
  description: "Preview and inspect Lottie animation files.",
  seoDescription:
    "Free Lottie animation previewer and inspector. Upload Lottie JSON files to preview animations, inspect layers, and control playback. Runs entirely in your toolbox.",
  category: "media",
  tags: [
    "lottie",
    "animation",
    "preview",
    "motion",
    "json",
    "after-effects",
    "bodymovin",
    "playback",
  ],
  featured: false,
  icon: "Play",
  route: () => import("./Route"),
  features: [
    {
      icon: "Zap",
      title: "Instant Preview",
      description: "Drag and drop Lottie files to see animations rendered immediately.",
    },
    {
      icon: "SlidersHorizontal",
      title: "Playback Controls",
      description: "Speed, loop, background, and timeline scrubbing for precise testing.",
    },
    {
      icon: "Download",
      title: "Multi-format Export",
      description: "Export as .dotLottie, animated GIF, or get HTML embed code.",
    },
  ],
};
