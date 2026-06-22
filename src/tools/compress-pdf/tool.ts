import type { ToolDefinition } from "../types";

export const tool: ToolDefinition = {
  name: "Compress PDF",
  slug: "compress-pdf",
  description: "Shrink a PDF's file size — lossless restructure or strong image compression.",
  seoDescription:
    "Free online PDF compressor. Reduce PDF file size with a lossless pass or strong image compression. Runs 100% in your browser — your file is never uploaded.",
  category: "data",
  tags: ["pdf", "compress", "shrink", "reduce", "size", "smaller", "downsize", "privacy"],
  featured: false,
  icon: "Minimize2",
  route: () => import("./Route"),
  features: [
    {
      icon: "FileDown",
      title: "Real Size Reduction",
      description: "Lossless restructure for any PDF, or strong image compression for scans.",
    },
    {
      icon: "SlidersHorizontal",
      title: "You Control Quality",
      description:
        "Pick a target image quality and resolution — see the actual result after you compress.",
    },
    {
      icon: "ShieldCheck",
      title: "100% Private",
      description: "Compression happens entirely in your browser. Your PDF is never uploaded.",
    },
  ],
};
