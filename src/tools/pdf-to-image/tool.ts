import type { ToolDefinition } from "../types";

export const tool: ToolDefinition = {
  name: "PDF to Image",
  slug: "pdf-to-image",
  description:
    "Convert each page of a PDF into a PNG or JPEG image — choose DPI, format, and pages.",
  seoDescription:
    "Free online PDF to image converter. Turn every page of a PDF into PNG or JPEG at 72–300 DPI, pick a page range, download as a ZIP. Runs 100% in your browser. Files are never uploaded.",
  category: "media",
  tags: ["pdf", "image", "png", "jpg", "jpeg", "convert", "render", "dpi", "rasterize", "privacy"],
  featured: false,
  icon: "FileImage",
  route: () => import("./Route"),
  features: [
    {
      icon: "Gauge",
      title: "Choose Your DPI",
      description: "Render from 72 DPI for web previews up to 300 DPI for print-quality images.",
    },
    {
      icon: "ImageIcon",
      title: "PNG or JPEG",
      description:
        "Export lossless PNG or smaller JPEG, with a quality control and per-page range.",
    },
    {
      icon: "ShieldCheck",
      title: "100% Private",
      description: "Rendering happens entirely in your browser. Your PDF is never uploaded.",
    },
  ],
};
