/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  // Next.js 16 blocks cross-origin requests to dev resources by default;
  // localhost:3000 is where the dev server runs, and 127.0.0.1:3000 is what
  // curl + Playwright + the capture script use. Both must be allow-listed.
  allowedDevOrigins: ["localhost", "localhost:3000", "127.0.0.1", "127.0.0.1:3000"],
  experimental: {
    serverActions: { allowedOrigins: ["localhost:3000", "127.0.0.1:3000"] },
  },
};

module.exports = nextConfig;
