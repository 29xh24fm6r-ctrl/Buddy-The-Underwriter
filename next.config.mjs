import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Force dynamic rendering to skip static page generation during build
  // NOTE: `output: 'standalone'` is for self-hosting. On Vercel it can break
  // serverless function bundling/behavior, so we disable it there.
  output: process.env.VERCEL ? undefined : 'standalone',
  
  // Source maps: required for readable stack traces.
  // Sentry will hide them from the public bundle via `hideSourceMaps`.
  productionBrowserSourceMaps: process.env.ENABLE_SENTRY === "1" ? true : false,
  
  // Skip TypeScript checks during build (errors handled in CI)
  typescript: {
    ignoreBuildErrors: true,
  },  
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
  outputFileTracingIncludes: {
    "/api/builder/stitch/audit": [
      "src/stitch/stitchSurfaceRegistry.ts",
      "src/stitch/StitchSurface.tsx",
      "src/app/(app)/deals/*/command/StitchPanel.tsx",
      "src/app/(app)/underwrite/page.tsx",
      "src/app/(app)/deals/*/committee/CommitteeView.tsx",
      "src/app/(app)/borrower/portal/page.tsx",
      "src/app/(app)/portfolio/page.tsx",
      "src/app/(app)/intake/page.tsx",
    ],
  },
  experimental: {
    cpus: process.env.CODESPACES ? 1 : undefined,
    workerThreads: process.env.CODESPACES ? false : undefined,
    serverActions: {
      allowedOrigins: [
        "localhost:3000",
        "localhost:3001",
        "*.app.github.dev",
      ],
    },
  },
  // Only reduce parallelism in Codespaces (keep production optimization enabled)
  webpack: (config, { isServer }) => {
    if (process.env.CODESPACES) {
      config.cache = false;
      config.parallelism = 1;
    }
    return config;
  },
};

// Only enable the Sentry Next.js plugin when we can actually upload source maps.
// This reduces build/runtime surface area on Vercel previews and avoids
// rare cases where the plugin integration can impact serverless behavior.
const shouldEnableSentryPlugin =
  process.env.ENABLE_SENTRY === "1" &&
  Boolean(process.env.SENTRY_AUTH_TOKEN) &&
  !process.env.CODESPACES;

export default shouldEnableSentryPlugin
  ? withSentryConfig(
      nextConfig,
      {
        // Sentry build-time options
        silent: true,
      },
      {
        // Sentry Webpack Plugin options
        hideSourceMaps: true,
        dryRun: false,
      },
    )
  : nextConfig;
