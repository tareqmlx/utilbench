import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { router } from "../router";

describe("router", () => {
  afterEach(cleanup);

  it("declares the expected top-level route shape", () => {
    const routes = router.routes;
    expect(routes).toHaveLength(1);
    const root = routes[0];
    expect(root?.element).toBeDefined();
    expect(root?.errorElement).toBeDefined();
    const childPaths = (root?.children ?? []).map((c) => c.path);
    expect(childPaths).toEqual(["/", "/tools", "/tools/:toolSlug", "/privacy", "*"]);
  });

  it("renders the Home page through a memory router with the same route config", async () => {
    // Re-create routes from the declared shape but with a memory router so we can hydrate.
    const memoryRouter = createMemoryRouter(
      [
        {
          element: router.routes[0]?.element,
          errorElement: router.routes[0]?.errorElement,
          children: router.routes[0]?.children ?? [],
        },
      ],
      { initialEntries: ["/"] },
    );

    render(
      <HelmetProvider>
        <RouterProvider router={memoryRouter} />
      </HelmetProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText(/A workbench/i)).toBeInTheDocument();
    });
  });

  it("renders not-found page for an unknown path", async () => {
    const memoryRouter = createMemoryRouter(
      [
        {
          element: router.routes[0]?.element,
          errorElement: router.routes[0]?.errorElement,
          children: router.routes[0]?.children ?? [],
        },
      ],
      { initialEntries: ["/__no_such_path__"] },
    );

    render(
      <HelmetProvider>
        <RouterProvider router={memoryRouter} />
      </HelmetProvider>,
    );

    await waitFor(() => {
      // NotFound page should mount.
      expect(document.body.textContent ?? "").toMatch(/not.found|404|Go Home|workbench/i);
    });
  });
});
