import type { ToolDefinition } from "../types";

export const tool: ToolDefinition = {
  name: "Image Compressor",
  slug: "image-compress",
  description:
    "Shrink images with real codecs — JPEG, WebP, AVIF, PNG — without changing dimensions.",
  seoDescription:
    "Free online image compressor. Reduce JPEG, PNG, WebP & AVIF file size with MozJPEG, libwebp, libavif and OxiPNG — quality slider, live size preview, visual diff. Runs 100% in your browser; images are never uploaded.",
  category: "media",
  tags: [
    "image",
    "compress",
    "optimize",
    "jpeg",
    "png",
    "webp",
    "avif",
    "mozjpeg",
    "shrink",
    "size",
    "privacy",
  ],
  featured: false,
  icon: "Minimize2",
  route: () => import("./Route"),
  features: [
    {
      icon: "Gauge",
      title: "Real Codec Compression",
      description:
        "MozJPEG, libwebp, libavif and OxiPNG — far smaller than a plain browser re-save.",
    },
    {
      icon: "SlidersHorizontal",
      title: "Live Size & Visual Diff",
      description: "See the actual compressed size and a before/after preview as you tune quality.",
    },
    {
      icon: "ShieldCheck",
      title: "100% Private",
      description: "Compression runs entirely in your browser. Your images are never uploaded.",
    },
  ],
};
