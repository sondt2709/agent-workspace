// The renderer entry: the bundled fonts (docs/design.md 3), the Emotion cache with the CSP nonce,
// the MUI theme of shared/ui, the query client, the bridge events and the router.
import { createAppTheme } from "@aw/ui";
import createCache from "@emotion/cache";
import { CacheProvider } from "@emotion/react";
import "@fontsource-variable/geist-mono";
import "@fontsource-variable/inter";
import { CssBaseline, ThemeProvider } from "@mui/material";
import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { useBridgeEvents } from "./events.ts";
import "./fonts/fonts.css";
import { createQueryClient } from "./queries.ts";
import { createAppRouter } from "./routes.tsx";

/** The nonce of this page load, from the meta tag that main fills (null in a dev build). */
export function cspNonce(doc: Document): string | undefined {
  const value = doc.querySelector('meta[name="csp-nonce"]')?.getAttribute("content") ?? "";
  return /^[A-Za-z0-9+/=]{16,}$/.test(value) ? value : undefined;
}

function Events({ children }: { children: ReactNode }) {
  useBridgeEvents();
  return children;
}

const cache = createCache({ key: "aw", nonce: cspNonce(document), prepend: true });
const theme = createAppTheme();
const queryClient = createQueryClient();
const router = createAppRouter();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CacheProvider value={cache}>
      <ThemeProvider theme={theme}>
        <CssBaseline enableColorScheme />
        <QueryClientProvider client={queryClient}>
          <Events>
            <RouterProvider router={router} />
          </Events>
        </QueryClientProvider>
      </ThemeProvider>
    </CacheProvider>
  </StrictMode>,
);
