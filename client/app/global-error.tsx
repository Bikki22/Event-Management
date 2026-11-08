"use client";

// Replaces the root layout when it crashes, so it ships its own <html>/<body> and inline styles.
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#f5f3ee",
          color: "#161614",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <title>Something went wrong · Book Event</title>
        <div style={{ maxWidth: 440, padding: 24 }}>
          <h1 style={{ fontSize: 32, letterSpacing: "-0.03em", margin: 0 }}>Something went wrong.</h1>
          <p style={{ color: "#6f6d66", lineHeight: 1.6 }}>Book Event couldn&apos;t load. Please try again.</p>
          <button
            onClick={() => retry()}
            style={{
              marginTop: 16,
              height: 44,
              padding: "0 20px",
              borderRadius: 8,
              border: 0,
              background: "#161614",
              color: "#f5f3ee",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
