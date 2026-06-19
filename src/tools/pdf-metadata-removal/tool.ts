import type { ToolDefinition } from "../types";

export const tool: ToolDefinition = {
  name: "PDF Metadata Remover",
  slug: "pdf-metadata-removal",
  description:
    "Strip document metadata — title, author, dates, XMP, and producer fingerprints — from a PDF.",
  seoDescription:
    "Free PDF metadata remover. Strip the title, author, subject, keywords, creator/producer, dates, XMP stream, and document ID from any PDF. Runs 100% in your browser — files are never uploaded. (Removes document-level metadata; metadata inside embedded images isn't altered.)",
  category: "data",
  tags: [
    "pdf",
    "metadata",
    "privacy",
    "strip",
    "remove",
    "xmp",
    "author",
    "producer",
    "fingerprint",
    "security",
  ],
  featured: false,
  icon: "ShieldCheck",
  route: () => import("./Route"),
  features: [
    {
      icon: "Eraser",
      title: "Document Metadata Strip",
      description:
        "Removes title, author, subject, keywords, creator, producer, and dates in one pass.",
    },
    {
      icon: "Fingerprint",
      title: "XMP & ID Fingerprints",
      description:
        "Deletes the XMP stream (DocumentID, edit history) and the unique document ID — not just the visible fields.",
    },
    {
      icon: "ShieldCheck",
      title: "100% Private",
      description: "Stripping happens entirely in your browser. Your PDF is never uploaded.",
    },
  ],
};
