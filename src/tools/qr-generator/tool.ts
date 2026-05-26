import type { ToolDefinition } from "../types";

export const tool: ToolDefinition = {
  name: "QR Generator",
  slug: "qr-generator",
  description: "Generate QR codes from text, URLs, or structured data.",
  seoDescription:
    "Free QR code generator. Create QR codes from text, URLs, WiFi credentials, or vCards. Download as PNG or SVG with customizable size and error correction levels.",
  category: "media",
  tags: [
    "qr",
    "qrcode",
    "qr code",
    "generate",
    "barcode",
    "encode",
    "url",
    "wifi",
    "vcard",
    "download",
    "png",
    "svg",
  ],
  featured: true,
  icon: "QrCode",
  route: () => import("./Route"),
  features: [
    {
      icon: "Zap",
      title: "Instant Generation",
      description: "Real-time QR code generation as you type with live preview.",
    },
    {
      icon: "SlidersHorizontal",
      title: "Fully Customizable",
      description: "Custom colors, sizes, error correction levels, and multiple data formats.",
    },
    {
      icon: "Download",
      title: "Multi-format Export",
      description: "Download as PNG or SVG, copy to clipboard, or share directly.",
    },
  ],
};
