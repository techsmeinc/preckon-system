/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  // pdf-parse is a CommonJS lib with an optional debug harness; keep it external
  // so Next doesn't try to bundle its test fixtures.
  serverExternalPackages: ["mysql2", "pdf-parse"],
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
