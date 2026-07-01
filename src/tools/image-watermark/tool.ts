import type { ToolDefinition } from "../types";

export const tool: ToolDefinition = {
  name: "Image Watermark",
  slug: "image-watermark",
  description:
    "Add a text or logo watermark to images — position grid, opacity, tiling, rotation — right in your browser.",
  seoDescription:
    "Free online image watermark tool. Stamp custom text or a logo onto JPEG, PNG & WebP images with a 9-position grid, adjustable opacity, tiling, rotation, and scale. Batch multiple images at once. Runs 100% in your browser; images are never uploaded.",
  category: "media",
  tags: [
    "image",
    "watermark",
    "stamp",
    "logo",
    "text",
    "overlay",
    "branding",
    "copyright",
    "privacy",
  ],
  featured: false,
  icon: "Stamp",
  route: () => import("./Route"),
  features: [
    {
      icon: "Type",
      title: "Text or Logo",
      description: "Stamp custom text or upload a PNG/JPG logo as your watermark.",
    },
    {
      icon: "SlidersHorizontal",
      title: "Full Control",
      description: "Tune position, opacity, rotation, scale, and tiling — live preview as you go.",
    },
    {
      icon: "ShieldCheck",
      title: "100% Private",
      description: "Watermarking runs entirely in your browser. Your images are never uploaded.",
    },
  ],
};
