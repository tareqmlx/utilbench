import type { ToolDefinition } from "../types";

export const tool: ToolDefinition = {
  name: "Images to PDF",
  slug: "images-to-pdf",
  description:
    "Convert JPG, PNG, and WebP images into a single PDF — reorder, set page size and fit.",
  seoDescription:
    "Free online image to PDF converter. Combine JPG, PNG, and WebP images into one PDF, drag to reorder, choose page size, orientation, margin, and fit. Runs 100% in your browser. Files are never uploaded.",
  category: "data",
  tags: [
    "pdf",
    "image",
    "images",
    "jpg",
    "jpeg",
    "png",
    "webp",
    "convert",
    "photo",
    "scan",
    "privacy",
  ],
  featured: false,
  icon: "Images",
  route: () => import("./Route"),
  features: [
    {
      icon: "ArrowDownUp",
      title: "Drag to Reorder",
      description:
        "Arrange images in any order with drag-and-drop or move buttons before converting.",
    },
    {
      icon: "Settings2",
      title: "Page Controls",
      description: "Choose page size, orientation, margin, and how each image fits the page.",
    },
    {
      icon: "ShieldCheck",
      title: "100% Private",
      description: "Conversion happens entirely in your browser. Your images are never uploaded.",
    },
  ],
};
