export type ToolCategory = "media" | "data" | "text";

export interface ToolFeature {
  icon: string; // Lucide icon name
  title: string;
  description: string;
}

export interface ToolDefinition {
  name: string;
  slug: string;
  description: string;
  seoDescription?: string;
  category: ToolCategory;
  tags: string[];
  featured: boolean;
  icon: string; // Lucide icon name
  route: () => Promise<{ default: React.ComponentType }>;
  features?: ToolFeature[];
}
