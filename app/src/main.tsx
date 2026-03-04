import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Provider } from "react-redux";
import { store } from "./store";
import App from "./App.tsx";
import { DOMErrorBoundary } from "./components/DOMErrorBoundary";
import "./index.css";

// Some privacy/ad-block extensions block Stripe telemetry calls (r.stripe.com/b), which can
// spam console with ERR_BLOCKED_BY_CLIENT and rejected promises. Intercept only that endpoint.
if (typeof window !== "undefined") {
  const w = window as Window & { __stripeTelemetryPatched?: boolean };
  const isStripeTelemetryUrl = (url: string) => /^https:\/\/r\.stripe\.com\/b(?:[/?#]|$)/.test(url);

  if (!w.__stripeTelemetryPatched) {
    if (typeof window.fetch === "function") {
      const originalFetch = window.fetch.bind(window);
      window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input instanceof Request
                ? input.url
                : String(input);
        if (isStripeTelemetryUrl(url)) {
          return Promise.resolve(new Response("", { status: 204, statusText: "No Content" }));
        }
        return originalFetch(input as RequestInfo, init);
      }) as typeof window.fetch;
    }

    if (typeof navigator.sendBeacon === "function") {
      const originalSendBeacon = navigator.sendBeacon.bind(navigator);
      navigator.sendBeacon = ((url: string | URL, data?: BodyInit | null) => {
        const normalizedUrl = typeof url === "string" ? url : url.toString();
        if (isStripeTelemetryUrl(normalizedUrl)) {
          return true;
        }
        return originalSendBeacon(url, data);
      }) as typeof navigator.sendBeacon;
    }

    if (typeof XMLHttpRequest !== "undefined") {
      const originalOpen = XMLHttpRequest.prototype.open;
      const originalSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function (
        method: string,
        url: string | URL,
        async?: boolean,
        username?: string | null,
        password?: string | null
      ) {
        const normalizedUrl = typeof url === "string" ? url : url.toString();
        (this as XMLHttpRequest & { __stripeTelemetryBlocked?: boolean }).__stripeTelemetryBlocked =
          isStripeTelemetryUrl(normalizedUrl);
        return originalOpen.call(this, method, url as string, async ?? true, username ?? null, password ?? null);
      };
      XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
        if ((this as XMLHttpRequest & { __stripeTelemetryBlocked?: boolean }).__stripeTelemetryBlocked) {
          queueMicrotask(() => {
            this.dispatchEvent(new Event("load"));
            this.dispatchEvent(new Event("loadend"));
          });
          return;
        }
        return originalSend.call(this, body ?? null);
      };
    }

    window.addEventListener("unhandledrejection", (event) => {
      const reason = event.reason as { message?: string } | string | undefined;
      const message = typeof reason === "string" ? reason : reason?.message ?? "";
      const normalized = `${message} ${String(reason ?? "")}`;
      if (normalized.includes("r.stripe.com/b") && normalized.includes("Failed to fetch")) {
        event.preventDefault();
      }
    });

    w.__stripeTelemetryPatched = true;
  }
}

// Use a single div root instead of Fragment to avoid removeChild errors when browser
// extensions modify the DOM on production (see https://github.com/facebook/react/issues/17256).
createRoot(document.getElementById("root")!).render(
  <DOMErrorBoundary>
    <div id="react-root" style={{ minHeight: "100%", display: "flex", flexDirection: "column" }}>
      <Provider store={store}>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <App />
        </BrowserRouter>
      </Provider>
    </div>
  </DOMErrorBoundary>
);
