import type { ToolDefinition } from "../types";

export const tool: ToolDefinition = {
  name: "Image Upscaler",
  slug: "image-upscaler",
  description:
    "Upscale images 2× or 4× with a local AI super-resolution model — sharper detail, 100% in your browser.",
  seoDescription:
    "Free online AI image upscaler. Enlarge photos 2× or 4× with neural super-resolution (ESRGAN) — no upload, no account, no watermark. Runs 100% in your browser; your images never leave your device, and the AI model downloads once from this site.",
  category: "media", // source line 245
  tags: [
    "image",
    "upscale",
    "upscaler",
    "super resolution",
    "enlarge",
    "2x",
    "4x",
    "ai",
    "esrgan",
    "privacy",
  ],
  featured: false, // 4 tools are ALREADY featured; ship false to avoid crowding the curated grid.
  icon: "Maximize", // added to icons.ts. NOT "Sparkles" (favicon-generator's tool icon); NOT "ImageUp" (image-resizer).
  route: () => import("./Route"),
  features: [
    {
      icon: "Sparkles",
      title: "2× / 4× Super-Resolution",
      description: "A neural model synthesizes detail as it enlarges — far beyond a plain resize.",
    },
    {
      icon: "ImageIcon",
      title: "Sharper, Not Just Bigger",
      description: "ESRGAN reconstructs edges and texture — no server, no API, no watermark.",
    },
    {
      icon: "ShieldCheck",
      title: "100% Private",
      description:
        "Your images never leave your browser. The AI model downloads once from this site, then runs locally.",
    },
  ],
};
