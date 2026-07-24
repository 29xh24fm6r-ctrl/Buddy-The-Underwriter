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
  // headers() mostly removed in Phase 6b in favor of Vercel Project Routes
  // (HTML no-cache, global security). To edit those: `vercel routes list` /
  // `vercel routes add` / `vercel routes edit`.
  //
  // Microphone Permissions-Policy reinstated here on 2026-07-20: the
  // Project Routes version only allowlisted /deals and /credit-memo,
  // silently blocking "Talk with Buddy" everywhere else (e.g. /start —
  // the borrower's own onboarding flow) with no user-visible permission
  // prompt at all, just a browser-level policy violation. Voice access to
  // Buddy is a system-wide feature (borrowers, bankers, everyone), so this
  // is intentionally unscoped rather than another hardcoded path list.
  // NOTE: if the old Project Routes rule for /deals and /credit-memo is
  // still active, remove it (`vercel routes list` -> `vercel routes rm`)
  // so there's a single source of truth instead of two competing headers.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [{ key: "Permissions-Policy", value: "microphone=(self)" }],
      },
    ];
  },
  // CRITICAL: stitch_exports must be in the Vercel serverless bundle.
  // loadRawStitchHtml uses dynamic fs.readFile which Next.js cannot auto-trace.
  // Every route that renders StitchSurface needs the HTML files at runtime.
  outputFileTracingIncludes: (() => {
    const stitchExports = ["stitch_exports/**/code.html"];
    // Every page route that uses StitchSurface needs stitch_exports in its bundle
    const stitchPageRoutes = [
      // Existing surfaces
      "/portfolio", "/intake", "/borrower/portal",
      "/deals/[dealId]/command", "/deals/[dealId]/underwrite", "/deals/[dealId]/committee",
      // Class 1: Direct page restoration
      "/analytics", "/servicing",
      "/workout", "/workout/case-file", "/workout/committee-packet",
      "/workout/legal", "/workout/reo", "/workout/chargeoff",
      "/compliance/audit-ledger", "/templates/vault", "/exceptions",
      "/ocr/review", "/admin/roles", "/admin/merge-fields",
      "/borrowers/control-record", "/credit/committee",
      // Class 2: Deal-scoped restoration
      "/deals/[dealId]/underwriter", "/deals/[dealId]/portal-inbox",
      "/deals/[dealId]/borrower-inbox", "/deals/[dealId]/borrower",
      "/deals/[dealId]/pricing-memo", "/deals/[dealId]/memo-template",
      "/deals/[dealId]/memos/new",
      // Class 3: Recovery routes
      "/stitch-recovery/deals", "/stitch-recovery/deals-new", "/stitch-login",
    ];
    const entries = stitchPageRoutes.map((route) => [route, stitchExports]);
    // Audit route also needs the registry + page files for verification
    entries.push(["/api/builder/stitch/audit", [
      ...stitchExports,
      "src/stitch/stitchSurfaceRegistry.ts",
    ]]);
    return Object.fromEntries(entries);
  })(),
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
