import type { ToolDefinition } from "../types";

export const tool: ToolDefinition = {
  name: "Background Remover",
  slug: "background-remover",
  description:
    "Remove image backgrounds with a local AI model — transparent PNG cutouts, 100% in your browser.",
  seoDescription:
    "Free online background remover. Erase image backgrounds to a transparent PNG using a local AI model — no upload, no account, no watermark. Runs 100% in your browser; your photos never leave your device, and the AI model downloads once from this site.",
  category: "media", // source line 245
  tags: [
    "image",
    "background",
    "remove",
    "remover",
    "cutout",
    "transparent",
    "png",
    "ai",
    "matting",
    "privacy",
  ],
  featured: false, // 4 tools are ALREADY featured (qr-generator, merge-pdf, json-formatter, cron-parser). Despite the source's 9/10, ship false to avoid crowding the curated grid; flip only on the owner's call.
  icon: "Scissors", // already imported in icons.ts (verify); alt "Eraser"/"Wand2"
  route: () => import("./Route"),
  features: [
    {
      icon: "Sparkles",
      title: "Local AI Cutouts",
      description:
        "A segmentation model isolates your subject and erases the background — no server, no API.",
    },
    {
      icon: "ImageIcon",
      title: "Transparent or Recolored",
      description:
        "Export a transparent PNG, drop in a solid background color, or grab the mask alone.",
    },
    {
      icon: "ShieldCheck",
      title: "100% Private",
      description:
        "Your images never leave your browser. The AI model downloads once from this site, then runs locally.",
    },
  ],
};
