import { CircleAlert, Home, RotateCcw } from "lucide-react";
import { Link, createBrowserRouter, isRouteErrorResponse, useRouteError } from "react-router-dom";
import { Layout } from "./components/Layout";
import { ToolErrorBoundary } from "./components/ToolErrorBoundary";
import { Alert, AlertDescription } from "./components/ui/alert";
import { Button } from "./components/ui/button";

function HydrateFallback() {
  return (
    <output
      className="flex min-h-screen items-center justify-center bg-background"
      aria-label="Loading"
    >
      <div className="size-10 animate-spin rounded-full border-2 border-muted border-t-foreground" />
    </output>
  );
}

function RouteErrorFallback() {
  const error = useRouteError();
  const isResponse = isRouteErrorResponse(error);

  const title = isResponse ? `${error.status} — ${error.statusText}` : "Something went wrong";
  const detail =
    isResponse && error.data ? String(error.data) : error instanceof Error ? error.message : null;

  const handleRetry = () => {
    window.location.reload();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-center">
      <div className="max-w-lg">
        <CircleAlert className="mx-auto mb-4 size-12 text-destructive" />
        <h1 className="text-2xl font-bold">{title}</h1>
        {import.meta.env.DEV && detail && (
          <Alert variant="destructive" className="mx-auto mt-4 max-w-md text-left">
            <AlertDescription>
              <pre className="overflow-auto text-sm">{detail}</pre>
            </AlertDescription>
          </Alert>
        )}
        <div className="mt-8 flex items-center justify-center gap-3">
          <Button asChild>
            <Link to="/">
              <Home className="size-4" />
              Go Home
            </Link>
          </Button>
          <Button variant="outline" onClick={handleRetry}>
            <RotateCcw className="size-4" />
            Retry
          </Button>
        </div>
      </div>
    </div>
  );
}

export const router = createBrowserRouter([
  {
    element: <Layout />,
    errorElement: <RouteErrorFallback />,
    HydrateFallback,
    children: [
      {
        path: "/",
        lazy: () => import("./pages/Home"),
        handle: { title: "Utilbench" },
      },
      {
        path: "/tools",
        lazy: () => import("./pages/Tools"),
        handle: { title: "All Tools | Utilbench" },
      },
      {
        path: "/tools/:toolSlug",
        lazy: async () => {
          const { Component } = await import("./pages/ToolPage");
          return {
            Component: () => (
              <ToolErrorBoundary>
                <Component />
              </ToolErrorBoundary>
            ),
          };
        },
        // title set dynamically in the component
      },
      {
        path: "/privacy",
        lazy: () => import("./pages/Privacy"),
        handle: { title: "Privacy | Utilbench" },
      },
      {
        path: "*",
        lazy: () => import("./pages/NotFound"),
        handle: { title: "Page Not Found | Utilbench" },
      },
    ],
  },
]);
