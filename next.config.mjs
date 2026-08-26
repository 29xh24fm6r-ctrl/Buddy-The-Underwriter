import { execSync } from "node:child_process";
import { withSentryConfig } from "@sentry/nextjs";
import { withWorkflow } from "workflow/next";

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
  //
  // SPEC-SEC-HEADERS-IN-REPO-1 (2026-08-26): the security headers moved back
  // here from Vercel Project Routes. Headers configured in the Vercel
  // dashboard are invisible to code review, to CI, and to anyone reading this
  // repository — an auditor cannot confirm the app sets HSTS or a CSP, and
  // neither can the next engineer. The mic incident above is the same failure
  // mode: a dashboard-only rule diverged from the code and nobody could see
  // it. Version control is the single source of truth.
  //
  // ACTION REQUIRED on deploy: remove the duplicate global security rule from
  // Project Routes (`vercel routes list` -> `vercel routes rm`), or two
  // competing header sets will race exactly as the mic rule did.
  //
  // Content-Security-Policy ships as Report-Only deliberately. This app loads
  // Clerk, Sentry, PostHog, Vercel analytics and Google fonts, and an
  // enforcing policy written without traffic data would break the borrower
  // funnel on deploy. Report-Only collects violations against the real policy;
  // promote it to `Content-Security-Policy` once the reports are clean.
  async headers() {
    const csp = [
      "default-src 'self'",
      // 'unsafe-inline'/'unsafe-eval' are required by Next's inline bootstrap
      // and by Clerk. Tighten with nonces when the policy is enforced.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.clerk.accounts.dev https://*.clerk.com https://*.vercel-scripts.com https://*.posthog.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "img-src 'self' data: blob: https:",
      "connect-src 'self' https://*.supabase.co https://*.clerk.accounts.dev https://*.clerk.com https://*.sentry.io https://*.ingest.sentry.io https://*.posthog.com https://vitals.vercel-insights.com",
      "frame-src 'self' https://*.clerk.accounts.dev https://*.clerk.com",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; ");

    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Permissions-Policy", value: "microphone=(self)" },
          // Buddy handles borrower NPI; never serve it over plain HTTP.
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Referrer must not leak deal or portal tokens that appear in paths.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // SAMEORIGIN rather than DENY: the app renders its own surfaces in
          // frames (stitch previews). frame-ancestors above is the modern
          // equivalent; both are sent for older browsers.
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
          { key: "Content-Security-Policy-Report-Only", value: csp },
        ],
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

const workflowConfig = withWorkflow(nextConfig);

export default shouldEnableSentryPlugin
  ? withSentryConfig(
      workflowConfig,
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
  : workflowConfig;
