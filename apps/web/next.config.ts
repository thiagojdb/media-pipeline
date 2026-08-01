import type { NextConfig } from "next";

const allowedDevOrigins = new Set([
  "127.0.0.1",
  "marcus",
  "marcus.tail65d8aa.ts.net",
]);
if (process.env.RELAY_DEV_HOSTNAME) {
  allowedDevOrigins.add(process.env.RELAY_DEV_HOSTNAME);
}

const nextConfig: NextConfig = {
  allowedDevOrigins: [...allowedDevOrigins],
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  reactStrictMode: true,
};

export default nextConfig;
