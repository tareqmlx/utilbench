import { describe, expect, it } from "vitest";
import type { ToolDefinition } from "../../tools/types";
import { SITE_URL } from "../constants";
import {
  buildBreadcrumbSchema,
  buildOrganizationSchema,
  buildSoftwareApplicationSchema,
  buildWebPageSchema,
  buildWebSiteSchema,
} from "../schemas";

const TOOL: ToolDefinition = {
  name: "Test Tool",
  slug: "test-tool",
  description: "tool desc",
  category: "data",
  tags: ["t"],
  featured: false,
  icon: "Braces",
  route: () => Promise.resolve({ default: () => null }),
};

describe("seo/schemas", () => {
  it("buildOrganizationSchema returns valid JSON-LD shape", () => {
    const s = buildOrganizationSchema();
    expect(s["@context"]).toBe("https://schema.org");
    expect(s["@type"]).toBe("Organization");
    expect(s.url).toBe(SITE_URL);
    expect(s.logo).toBe(`${SITE_URL}/favicon.svg`);
    expect(typeof s.name).toBe("string");
  });

  it("buildWebSiteSchema includes SearchAction", () => {
    const s = buildWebSiteSchema();
    expect(s["@type"]).toBe("WebSite");
    const action = s.potentialAction as Record<string, unknown>;
    expect(action["@type"]).toBe("SearchAction");
    expect((action.target as Record<string, string>).urlTemplate).toContain("?q={search_term}");
  });

  it("buildSoftwareApplicationSchema includes tool url and offer", () => {
    const s = buildSoftwareApplicationSchema(TOOL);
    expect(s["@type"]).toBe("SoftwareApplication");
    expect(s.url).toBe(`${SITE_URL}/tools/test-tool`);
    expect(s.applicationCategory).toBe("DeveloperApplication");
    const offer = s.offers as Record<string, string>;
    expect(offer.price).toBe("0");
    expect(offer.priceCurrency).toBe("USD");
  });

  it("buildSoftwareApplicationSchema uses seoDescription when provided", () => {
    const s = buildSoftwareApplicationSchema({ ...TOOL, seoDescription: "alt seo text" });
    expect(s.description).toBe("alt seo text");
  });

  it("buildSoftwareApplicationSchema falls back to description without seoDescription", () => {
    const s = buildSoftwareApplicationSchema(TOOL);
    expect(s.description).toBe("tool desc");
  });

  it("buildBreadcrumbSchema returns positioned items with absolute urls", () => {
    const s = buildBreadcrumbSchema([
      { name: "Home", url: "/" },
      { name: "Tools", url: "/tools" },
      { name: "Test Tool" }, // no url
    ]);
    expect(s["@type"]).toBe("BreadcrumbList");
    const items = s.itemListElement as Array<Record<string, unknown>>;
    expect(items).toHaveLength(3);
    expect(items[0]?.position).toBe(1);
    expect(items[0]?.item).toBe(`${SITE_URL}/`);
    expect(items[1]?.position).toBe(2);
    expect(items[1]?.item).toBe(`${SITE_URL}/tools`);
    expect(items[2]?.position).toBe(3);
    expect(items[2]?.item).toBeUndefined();
  });

  it("buildWebPageSchema returns full webpage shape", () => {
    const s = buildWebPageSchema("Page Title", "Page Desc", "/some-path");
    expect(s["@type"]).toBe("WebPage");
    expect(s.name).toBe("Page Title");
    expect(s.description).toBe("Page Desc");
    expect(s.url).toBe(`${SITE_URL}/some-path`);
    const isPartOf = s.isPartOf as Record<string, string>;
    expect(isPartOf["@type"]).toBe("WebSite");
    expect(isPartOf.url).toBe(SITE_URL);
  });
});
