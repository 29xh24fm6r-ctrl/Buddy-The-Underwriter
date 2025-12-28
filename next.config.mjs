/** @type {import('next').NextConfig} */
const nextConfig = {
  // Skip TypeScript and ESLint checks during build (errors handled in CI)
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  
  // Empty turbopack config to silence webpack/turbopack conflict warning
  turbopack: {},
  
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
  experimental: {
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
      config.parallelism = 1;
    }
    return config;
  },
};

export default nextConfig;
