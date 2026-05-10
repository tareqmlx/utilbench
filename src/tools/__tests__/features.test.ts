import { describe, expect, it } from "vitest";
import { getIcon } from "../../lib/icons";
import { getAllTools } from "../registry";

describe("tool features", () => {
  const tools = getAllTools();

  it("every tool has features with exactly 3 entries", () => {
    for (const tool of tools) {
      expect(tool.features, `${tool.slug} is missing features`).toBeDefined();
      expect(tool.features, `${tool.slug} should have exactly 3 features`).toHaveLength(3);
    }
  });

  it("every feature icon resolves via getIcon without fallback", () => {
    const fallback = getIcon("__nonexistent__");
    for (const tool of tools) {
      for (const feature of tool.features ?? []) {
        const icon = getIcon(feature.icon);
        expect(
          icon,
          `${tool.slug} feature "${feature.title}" uses unknown icon "${feature.icon}"`,
        ).not.toBe(fallback);
      }
    }
  });

  it("every feature has a non-empty title and description", () => {
    for (const tool of tools) {
      for (const feature of tool.features ?? []) {
        expect(feature.title.length, `${tool.slug} has empty feature title`).toBeGreaterThan(0);
        expect(
          feature.description.length,
          `${tool.slug} has empty feature description`,
        ).toBeGreaterThan(0);
      }
    }
  });
});
