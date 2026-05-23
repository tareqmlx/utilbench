import { describe, expect, it } from "vitest";
import { getAllTools, getFeaturedTools, getToolBySlug, getToolsByCategory } from "../registry";

describe("tools/registry", () => {
  it("getAllTools returns a non-empty array of ToolDefinitions", () => {
    const tools = getAllTools();
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);
    for (const t of tools) {
      expect(typeof t.slug).toBe("string");
      expect(typeof t.name).toBe("string");
      expect(typeof t.description).toBe("string");
      expect(typeof t.route).toBe("function");
    }
  });

  it("getToolBySlug returns the tool for a known slug", () => {
    const all = getAllTools();
    const first = all[0];
    expect(first).toBeDefined();
    if (!first) return;
    expect(getToolBySlug(first.slug)).toEqual(first);
  });

  it("getToolBySlug returns undefined for unknown slug", () => {
    expect(getToolBySlug("__nonexistent_slug__")).toBeUndefined();
  });

  it("getFeaturedTools returns only featured tools", () => {
    const featured = getFeaturedTools();
    expect(featured.length).toBeGreaterThan(0);
    for (const t of featured) {
      expect(t.featured).toBe(true);
    }
    // Subset of all tools
    const all = getAllTools();
    expect(featured.length).toBeLessThanOrEqual(all.length);
  });

  it("getToolsByCategory filters by category", () => {
    for (const cat of ["media", "data", "text"] as const) {
      const list = getToolsByCategory(cat);
      for (const t of list) {
        expect(t.category).toBe(cat);
      }
    }
    // Sum over categories equals total
    const total =
      getToolsByCategory("media").length +
      getToolsByCategory("data").length +
      getToolsByCategory("text").length;
    expect(total).toBe(getAllTools().length);
  });

  it("all slugs are unique", () => {
    const slugs = getAllTools().map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("every tool exposes a route() function that resolves to a module with default export", async () => {
    // lottie-web crashes when imported in jsdom (top-level DOM access); skip it.
    const skipSlugs = new Set(["lottie-previewer"]);
    for (const t of getAllTools()) {
      if (skipSlugs.has(t.slug)) {
        expect(typeof t.route).toBe("function");
        continue;
      }
      const mod = await t.route();
      expect(mod.default).toBeDefined();
    }
  }, 30_000);
});
