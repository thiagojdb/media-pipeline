import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "marcus", "marcus.tail65d8aa.ts.net"],
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  reactStrictMode: true,
};

export default nextConfig;
