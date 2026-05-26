import { APP_DESCRIPTION, APP_NAME } from "../config";
import type { ToolDefinition } from "../tools/types";
import { SITE_URL } from "./constants";

export function buildOrganizationSchema(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: APP_NAME,
    url: SITE_URL,
    logo: `${SITE_URL}/favicon.svg`,
    description: APP_DESCRIPTION,
  };
}

export function buildWebSiteSchema(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: APP_NAME,
    url: SITE_URL,
    description: APP_DESCRIPTION,
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${SITE_URL}/tools?q={search_term}`,
      },
      "query-input": "required name=search_term",
    },
  };
}

export function buildSoftwareApplicationSchema(tool: ToolDefinition): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: `${tool.name}: ${APP_NAME}`,
    description: tool.seoDescription ?? tool.description,
    url: `${SITE_URL}/tools/${tool.slug}`,
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Any",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
  };
}

export function buildBreadcrumbSchema(
  items: Array<{ name: string; url?: string }>,
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      ...(item.url ? { item: `${SITE_URL}${item.url}` } : {}),
    })),
  };
}

export function buildWebPageSchema(
  title: string,
  description: string,
  path: string,
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: title,
    description,
    url: `${SITE_URL}${path}`,
    isPartOf: {
      "@type": "WebSite",
      name: APP_NAME,
      url: SITE_URL,
    },
  };
}
