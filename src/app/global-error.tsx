"use client";

import React from "react";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="antialiased h-full" style={{ background: "var(--background, #0a0a0a)", color: "var(--foreground, #fafafa)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "0 1.5rem" }}>
            <p style={{ fontSize: "4.5rem", fontWeight: 700 }}>500</p>
            <p style={{ fontSize: "0.875rem", opacity: 0.6, marginTop: "0.75rem" }}>
              Something went wrong. Please try again.
            </p>
            <button
              onClick={reset}
              style={{
                marginTop: "1.5rem",
                padding: "0.5rem 1rem",
                fontSize: "0.875rem",
                borderRadius: "0.5rem",
                border: "1px solid rgba(255,255,255,0.15)",
                background: "transparent",
                color: "inherit",
                cursor: "pointer",
              }}
            >
              Try Again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
