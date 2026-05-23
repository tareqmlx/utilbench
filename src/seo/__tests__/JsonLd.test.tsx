import { cleanup, render } from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { afterEach, describe, expect, it } from "vitest";
import { JsonLd } from "../JsonLd";

describe("JsonLd", () => {
  afterEach(cleanup);

  it("renders an application/ld+json script tag with serialized data", () => {
    const data = { "@context": "https://schema.org", "@type": "Thing", name: "x" };
    const { container } = render(
      <HelmetProvider>
        <JsonLd data={data} />
      </HelmetProvider>,
    );
    const tag = container.querySelector('script[type="application/ld+json"]');
    expect(tag).not.toBeNull();
    expect(JSON.parse(tag?.textContent ?? "{}")).toEqual(data);
  });

  it("accepts arbitrary nested data shape without throwing", () => {
    expect(() =>
      render(
        <HelmetProvider>
          <JsonLd data={{ foo: "bar", nested: { a: 1, b: [1, 2, 3] } }} />
        </HelmetProvider>,
      ),
    ).not.toThrow();
  });

  it("serializes data argument with JSON.stringify (smoke check)", () => {
    // Verify stringification happens for round-trip safety; the component
    // uses JSON.stringify directly so any unserializable value would throw.
    expect(() =>
      render(
        <HelmetProvider>
          <JsonLd data={{ when: new Date(0).toISOString() }} />
        </HelmetProvider>,
      ),
    ).not.toThrow();
  });
});
