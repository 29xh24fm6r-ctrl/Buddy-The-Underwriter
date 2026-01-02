/** @type {import('next').NextConfig} */
const nextConfig = {
  // Force dynamic rendering to skip static page generation during build
  output: 'standalone',
  
  // Reduce memory during production builds (webpack)
  productionBrowserSourceMaps: false,
  
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
