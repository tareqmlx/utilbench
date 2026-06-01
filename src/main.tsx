import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import App from "./App";
import { RootErrorBoundary } from "./components/RootErrorBoundary";
import { pushError } from "./lib/errorReport";
import "./index.css";

// Feed the in-memory report buffer from global error sources. These never send
// anything — they only populate the buffer the Report button reads on click.
window.addEventListener("error", (e) => {
  pushError(e.error ?? e.message, { source: "window.onerror" });
});
window.addEventListener("unhandledrejection", (e) => {
  pushError(e.reason, { source: "unhandledrejection" });
});

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing #root element");

createRoot(rootEl).render(
  <StrictMode>
    <RootErrorBoundary>
      <HelmetProvider>
        <App />
      </HelmetProvider>
    </RootErrorBoundary>
  </StrictMode>,
);
