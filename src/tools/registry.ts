import type { ToolCategory, ToolDefinition } from "./types";

const toolModules = import.meta.glob<{ tool: ToolDefinition }>("./*/tool.ts", { eager: true });

const tools: ToolDefinition[] = Object.values(toolModules).map((mod) => mod.tool);

export function getAllTools(): ToolDefinition[] {
  return tools;
}

export function getToolBySlug(slug: string): ToolDefinition | undefined {
  return tools.find((t) => t.slug === slug);
}

export function getFeaturedTools(): ToolDefinition[] {
  return tools.filter((t) => t.featured);
}

export function getToolsByCategory(category: ToolCategory): ToolDefinition[] {
  return tools.filter((t) => t.category === category);
}
