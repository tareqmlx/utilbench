import type { ToolDefinition } from "../types";

export const tool: ToolDefinition = {
  name: "Watermark PDF",
  slug: "watermark-pdf",
  description:
    "Add a text or image watermark to a PDF — opacity, rotation, tiling, page targeting.",
  seoDescription:
    "Free online PDF watermark tool. Add a text or image watermark with adjustable opacity, rotation, size, and tiling to any or all pages. Runs 100% in your browser. Files are never uploaded.",
  category: "data",
  tags: [
    "pdf",
    "watermark",
    "stamp",
    "text",
    "image",
    "logo",
    "overlay",
    "draft",
    "confidential",
    "privacy",
  ],
  featured: false,
  icon: "Stamp",
  route: () => import("./Route"),
  features: [
    {
      icon: "Type",
      title: "Text or Image",
      description: "Stamp custom text or upload a PNG/JPG logo as your watermark.",
    },
    {
      icon: "SlidersHorizontal",
      title: "Full Control",
      description:
        "Tune opacity, rotation, size, color, position, and tiling — on any or all pages.",
    },
    {
      icon: "ShieldCheck",
      title: "100% Private",
      description: "Watermarking happens entirely in your browser. Your PDF is never uploaded.",
    },
  ],
};
