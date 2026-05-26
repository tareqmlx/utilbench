import type { ToolDefinition } from "../types";

export const tool: ToolDefinition = {
  name: "Image Metadata Remover",
  slug: "image-metadata-removal",
  description: "Remove EXIF, GPS, and camera metadata from images locally.",
  seoDescription:
    "Free image metadata remover. Strip EXIF, GPS location, camera info, and personal data from photos. Protects your privacy with 100% local processing, no uploads.",
  category: "media",
  tags: ["image", "metadata", "exif", "privacy", "gps", "strip", "photo", "location", "security"],
  featured: false,
  icon: "ShieldCheck",
  route: () => import("./Route"),
  features: [
    {
      icon: "MapPinOff",
      title: "GPS Stripping",
      description:
        "Automatically removes precise coordinates and location history from your photos.",
    },
    {
      icon: "Monitor",
      title: "Device Info Removal",
      description: "Clears camera model, serial numbers, and software used to edit the image.",
    },
    {
      icon: "History",
      title: "Original Preserved",
      description:
        "We never modify your original files. A clean copy is generated for your download.",
    },
  ],
};
