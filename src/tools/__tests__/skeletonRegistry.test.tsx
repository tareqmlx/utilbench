import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { getAllTools } from "../registry";
import { getSkeletonForSlug } from "../skeletonRegistry";

describe("skeletonRegistry", () => {
  const allTools = getAllTools();

  afterEach(cleanup);

  it("has a skeleton for every registered tool", () => {
    for (const tool of allTools) {
      const Skeleton = getSkeletonForSlug(tool.slug);
      expect(Skeleton, `Missing skeleton for "${tool.slug}"`).not.toBeNull();
    }
  });

  it("returns null for unknown slugs", () => {
    expect(getSkeletonForSlug("nonexistent-tool")).toBeNull();
  });

  it.each(allTools.map((t) => [t.slug, t]))(
    "renders skeleton for %s without crashing",
    (_slug, tool) => {
      const Skeleton = getSkeletonForSlug(tool.slug);
      expect(Skeleton).not.toBeNull();
      if (Skeleton) {
        const { container } = render(<Skeleton tool={tool} />);
        expect(container.firstChild).toBeTruthy();
      }
    },
  );
});
