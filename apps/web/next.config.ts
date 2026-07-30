import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "marcus", "marcus.tail65d8aa.ts.net"],
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  reactStrictMode: true,
  async rewrites() {
    const developmentApiOrigin = process.env.RELAY_DEVELOPMENT_API_ORIGIN;
    if (!developmentApiOrigin) return [];

    return {
      beforeFiles: [
        {
          source: "/api/projects/:path*",
          destination: `${developmentApiOrigin}/api/projects/:path*`,
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
