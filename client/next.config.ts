import type { NextConfig } from "next";

// Absolute API base, e.g. https://ems-api.vercel.app/api/v1. When set, the browser talks to the
// API through this app's own origin (/api/v1/*), keeping the refresh cookie first-party.
const apiInternalUrl = process.env.API_INTERNAL_URL?.replace(/\/$/, "");

const nextConfig: NextConfig = {
  async rewrites() {
    if (!apiInternalUrl) return [];
    return [{ source: "/api/v1/:path*", destination: `${apiInternalUrl}/:path*` }];
  },
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
