import type { ToolDefinition } from "../types";

export const tool: ToolDefinition = {
  name: "Image Resizer",
  slug: "image-resizer",
  description: "Resize and crop images directly in your browser.",
  seoDescription:
    "Free online image resizer and cropper. Resize, scale, and crop photos with custom dimensions and aspect ratios. Processes locally with no quality loss or data collection.",
  category: "media",
  tags: ["image", "resize", "crop", "photo", "scale", "dimensions", "aspect-ratio", "bulk"],
  featured: false,
  icon: "ImageUp",
  route: () => import("./Route"),
  features: [
    {
      icon: "Zap",
      title: "Instant Resize",
      description: "Resize images with real-time preview and estimated file size.",
    },
    {
      icon: "SlidersHorizontal",
      title: "Full Control",
      description: "Custom dimensions, format selection, quality slider, and aspect ratio lock.",
    },
    {
      icon: "ImageIcon",
      title: "Batch Processing",
      description: "Process multiple images at once and download as a ZIP archive.",
    },
  ],
};
