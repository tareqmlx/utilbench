import type { ToolDefinition } from "../types";

export const tool: ToolDefinition = {
  name: "Image Format Converter",
  slug: "image-converter",
  description:
    "Convert PNG, JPG, WebP, GIF, BMP, and AVIF images to PNG, JPG, or WebP in your browser.",
  seoDescription:
    "Free online image format converter. Convert PNG, JPG, WebP, GIF, BMP, and AVIF to PNG, JPG, or WebP — batch convert and download as a zip. Runs 100% in your browser. Files are never uploaded.",
  category: "media",
  tags: [
    "image",
    "convert",
    "converter",
    "format",
    "png",
    "jpg",
    "jpeg",
    "webp",
    "gif",
    "bmp",
    "avif",
    "transcode",
    "batch",
    "privacy",
  ],
  featured: false,
  icon: "ArrowLeftRight",
  route: () => import("./Route"),
  features: [
    {
      icon: "ArrowLeftRight",
      title: "Any-to-Web Formats",
      description: "Convert PNG, JPG, WebP, GIF, BMP, and AVIF into PNG, JPG, or WebP.",
    },
    {
      icon: "Images",
      title: "Batch Convert",
      description: "Drop many images, convert them all at once, and download a single zip.",
    },
    {
      icon: "ShieldCheck",
      title: "100% Private",
      description: "Conversion happens entirely in your browser. Your images are never uploaded.",
    },
  ],
};
