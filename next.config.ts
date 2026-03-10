import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: false,
  eslint: {
    ignoreDuringBuilds: true
  },
  typescript: {
    ignoreBuildErrors: true
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "8mb"
    }
  },
  turbopack: {},
  webpack: (config, { dev }) => {
    if (dev) {
      const ignored = [
        "**/.git/**",
        "**/.next/**",
        "**/node_modules/**",
        "**/.mock-state/**",
        "**/uploads/**",
        "**/imports/**",
        "**/*.xlsx",
        "**/*.xls",
        "**/*.csv",
        "**/*.pdf",
        "**/*.doc",
        "**/*.docx"
      ];

      config.watchOptions = {
        ...config.watchOptions,
        ignored
      };
    }

    return config;
  }
};

export default nextConfig;
