import { execSync } from "node:child_process";
import { withSentryConfig } from "@sentry/nextjs";

function getGitSha() {
  // Vercel sets this automatically; fall back to git for local/CI builds
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA;
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

// Force clean build — cache-bust 2026-03-20
/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_GIT_SHA: getGitSha(),
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
    NEXT_PUBLIC_BUILD_ENV: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
  },
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
  // pdfkit reads AFM font files from disk at runtime using __dirname-relative
  // paths inside the package. When Next.js bundles it into a serverless
  // function the paths break and the route throws a 500. Marking it as an
  // external package tells Next.js to load it from node_modules at runtime
  // instead of inlining it, so the font file resolution works correctly.
  serverExternalPackages: ["pdfkit"],
  async headers() {
    return [
      {
        // Global security headers — microphone blocked by default
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      {
        // Credit memo pages — microphone allowed for Gemini Live banker interview
        source: "/credit-memo/(.*)",
        headers: [
          { key: "Permissions-Policy", value: "camera=(), microphone=self, geolocation=()" },
        ],
      },
      {
        // Deal cockpit pages — microphone allowed for Gemini Live banker interview
        source: "/deals/(.*)",
        headers: [
          { key: "Permissions-Policy", value: "camera=(), microphone=self, geolocation=()" },
        ],
      },
    ];
  },
  outputFileTracingIncludes: {
    "/api/builder/stitch/audit": [
      "src/stitch/stitchSurfaceRegistry.ts",
      "src/stitch/StitchSurface.tsx",
      // Existing surfaces
      "src/app/(app)/deals/*/command/StitchPanel.tsx",
      "src/app/(app)/deals/*/underwrite/page.tsx",
      "src/app/(app)/deals/*/committee/CommitteeView.tsx",
      "src/app/(app)/borrower/portal/page.tsx",
      "src/app/(app)/portfolio/page.tsx",
      "src/app/(app)/intake/page.tsx",
      // Class 1: Direct page restoration
      "src/app/(app)/analytics/page.tsx",
      "src/app/(app)/servicing/page.tsx",
      "src/app/(app)/workout/page.tsx",
      "src/app/(app)/workout/case-file/page.tsx",
      "src/app/(app)/workout/committee-packet/page.tsx",
      "src/app/(app)/workout/legal/page.tsx",
      "src/app/(app)/workout/reo/page.tsx",
      "src/app/(app)/workout/chargeoff/page.tsx",
      "src/app/(app)/compliance/audit-ledger/page.tsx",
      "src/app/(app)/templates/vault/page.tsx",
      "src/app/(app)/exceptions/page.tsx",
      "src/app/(app)/ocr/review/page.tsx",
      "src/app/(app)/admin/roles/page.tsx",
      "src/app/(app)/admin/merge-fields/page.tsx",
      "src/app/(app)/borrowers/control-record/page.tsx",
      "src/app/(app)/credit/committee/page.tsx",
      // Class 2: Deal-scoped restoration
      "src/app/(app)/deals/*/underwriter/page.tsx",
      "src/app/(app)/deals/*/portal-inbox/page.tsx",
      "src/app/(app)/deals/*/borrower-inbox/page.tsx",
      "src/app/(app)/deals/*/borrower/page.tsx",
      "src/app/(app)/deals/*/pricing-memo/page.tsx",
      "src/app/(app)/deals/*/memo-template/page.tsx",
      "src/app/(app)/deals/*/memos/new/page.tsx",
      // Class 3: Recovery routes
      "src/app/(app)/stitch-recovery/deals/page.tsx",
      "src/app/(app)/stitch-recovery/deals-new/page.tsx",
      "src/app/stitch-login/page.tsx",
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
  // Empty turbopack config to allow both webpack and turbopack configs
  turbopack: {},
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
