/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Emit a self-contained server bundle (.next/standalone) so the Docker runtime
  // image only carries Node + traced deps, not the whole node_modules.
  output: "standalone",
  // Hide the dev-only "Static/Dynamic route" indicator badge (bottom corner).
  devIndicators: { appIsrStatus: false, buildActivity: false },
  // Better Auth + mysql2 are server-only; keep them out of the client bundle.
  serverExternalPackages: ["mysql2", "better-auth"],
};

export default nextConfig;
