import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { NextConfig } from "next";

const shouldEmitBuildStats = process.env.NEXT_BUILD_STATS === "1";

class BuildStatsReportPlugin {
  apply(compiler: any) {
    compiler.hooks.done.tap("BuildStatsReportPlugin", (stats: any) => {
      const compilerName = stats.compilation?.name ?? compiler.name ?? compiler.options?.name ?? "webpack";
      const json = stats.toJson({
        all: false,
        assets: true,
        chunks: true,
        chunkModules: true,
        modules: true,
        reasons: true,
        ids: true
      });
      const normalizeModule = (module: any) => ({
        id: module.id ?? null,
        name: module.name ?? module.identifier ?? "unknown",
        size: Number(module.size ?? 0),
        chunks: Array.isArray(module.chunks) ? module.chunks : [],
        issuer: module.issuerName ?? null,
        reasons: Array.isArray(module.reasons)
          ? module.reasons
              .map((reason: any) => reason.userRequest ?? reason.moduleName ?? reason.resolvedModuleIdentifier ?? null)
              .filter(Boolean)
              .slice(0, 8)
          : []
      });
      const report = {
        generatedAt: new Date().toISOString(),
        compilerName,
        assets: (json.assets ?? [])
          .map((asset: any) => ({
            name: asset.name,
            size: Number(asset.size ?? 0),
            chunks: Array.isArray(asset.chunks) ? asset.chunks : []
          }))
          .sort((left: { size: number }, right: { size: number }) => right.size - left.size),
        chunks: (json.chunks ?? [])
          .map((chunk: any) => ({
            id: chunk.id ?? null,
            names: Array.isArray(chunk.names) ? chunk.names : [],
            files: Array.isArray(chunk.files) ? chunk.files : [],
            size: Number(chunk.size ?? 0),
            modules: Array.isArray(chunk.modules)
              ? chunk.modules
                  .map(normalizeModule)
                  .sort((left: { size: number }, right: { size: number }) => right.size - left.size)
                  .slice(0, 25)
              : []
          }))
          .sort((left: { size: number }, right: { size: number }) => right.size - left.size),
        modules: (json.modules ?? [])
          .map(normalizeModule)
          .sort((left: { size: number }, right: { size: number }) => right.size - left.size)
          .slice(0, 250)
      };

      const outDir = path.join(process.cwd(), ".next", "analyze");
      mkdirSync(outDir, { recursive: true });
      writeFileSync(path.join(outDir, `${compilerName}.json`), JSON.stringify(report, null, 2));
    });
  }
}

const nextConfig: NextConfig = {
  typedRoutes: false,
  experimental: {
    serverActions: {
      bodySizeLimit: "8mb"
    }
  },
  turbopack: {},
  webpack: (config, { dev }) => {
    if (shouldEmitBuildStats && !dev) {
      config.plugins = [...(config.plugins ?? []), new BuildStatsReportPlugin()];
    }

    if (dev) {
      const ignored = [
        "**/.git/**",
        "**/.next/**",
        "**/node_modules/**",
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
