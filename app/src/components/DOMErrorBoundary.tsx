import React, { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  isDOMError?: boolean;
}

/**
 * Catches render errors and the removeChild/DOM sync errors that can occur
 * when browser extensions modify the DOM in production (React #17256).
 */
export class DOMErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    const msg = error instanceof Error ? error.message : String(error);
    const isDOMError =
      msg.includes("removeChild") ||
      msg.includes("NotFoundError") ||
      (error instanceof Error && error.name === "NotFoundError");
    return { hasError: true, isDOMError };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("DOMErrorBoundary caught:", error, errorInfo);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          fontFamily: "system-ui, sans-serif",
          textAlign: "center",
          background: "#f9fafb",
        }}
      >
        <h1 style={{ fontSize: "1.25rem", color: "#111", marginBottom: 8 }}>
          Something went wrong
        </h1>
        <p style={{ color: "#6b7280", marginBottom: 16, maxWidth: 400 }}>
          {this.state.isDOMError
            ? "A browser extension may have interfered with the page. Try reloading or open in a private window."
            : "An unexpected error occurred. Try reloading the page."}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            padding: "10px 20px",
            fontSize: 14,
            fontWeight: 600,
            color: "#fff",
            background: "#2563eb",
            border: "none",
            borderRadius: 8,
            cursor: "pointer",
          }}
        >
          Reload page
        </button>
      </div>
    );
  }
}
