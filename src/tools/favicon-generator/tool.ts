import type { ToolDefinition } from "../types";

export const tool: ToolDefinition = {
  name: "Favicon Generator",
  slug: "favicon-generator",
  description: "Generate favicons in all required sizes from a single image.",
  seoDescription:
    "Free favicon generator that creates all required sizes from a single image. Generate ICO, PNG, and SVG favicons for your website — processed entirely in your toolbox.",
  category: "media",
  tags: ["favicon", "icon", "generate", "image", "ico", "web-design", "branding", "website"],
  featured: false,
  icon: "Sparkles",
  route: () => import("./Route"),
  features: [
    {
      icon: "Monitor",
      title: "All Platforms",
      description: "Generate optimized icons for browsers, iOS, and Android in one pack.",
    },
    {
      icon: "SlidersHorizontal",
      title: "Customizable",
      description: "Background color, corner rounding, and multiple export format options.",
    },
    {
      icon: "Eye",
      title: "Live Preview",
      description: "See real-time browser tab, iOS, and Android icon previews as you customize.",
    },
  ],
};
