import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { NextConfig } from "next";

const shouldEmitBuildStats = process.env.NEXT_BUILD_STATS === "1";
const useWebpackConfig = process.env.NEXT_USE_WEBPACK === "1";
const shouldDisableWebpackCache = process.env.NEXT_DISABLE_WEBPACK_CACHE === "1";

type SourceValue = string | { length: number } | Buffer;
type WebpackSourceLike = {
  source?: () => SourceValue | null | undefined;
};

type BuildStatsModule = {
  originalSource?: () => WebpackSourceLike | null | undefined;
  userRequest?: string | null;
  resource?: string | null;
  readableIdentifier?: (requestShortener: unknown) => string;
  identifier?: (() => string) | string;
  type?: string | null;
  layer?: string | null;
};

type BuildStatsCompilation = {
  name?: string;
  modules?: Iterable<BuildStatsModule>;
  requestShortener?: unknown;
  getStats: () => BuildStats;
};

type BuildStats = {
  compilation?: BuildStatsCompilation;
  toJson: (options: Record<string, unknown>) => StatsJsonLike;
};

type BuildStatsCompiler = {
  name?: string;
  options?: {
    name?: string;
  };
  hooks: {
    afterEmit: {
      tap: (name: string, callback: (compilation: BuildStatsCompilation) => void) => void;
    };
    done: {
      tap: (name: string, callback: (stats: BuildStats) => void) => void;
    };
  };
};

type StatsReasonLike = {
  userRequest?: string | null;
  moduleName?: string | null;
  resolvedModuleIdentifier?: string | null;
};

type StatsModuleLike = {
  id?: string | number | null;
  name?: string | null;
  identifier?: string | null;
  size?: number | null;
  chunks?: unknown;
  issuerName?: string | null;
  reasons?: StatsReasonLike[] | null;
};

type StatsAssetLike = {
  name?: string | null;
  size?: number | null;
  chunks?: unknown;
};

type StatsChunkLike = {
  id?: string | number | null;
  names?: unknown;
  files?: unknown;
  size?: number | null;
  modules?: StatsModuleLike[] | null;
};

type StatsJsonLike = {
  warnings?: unknown[];
  assets?: StatsAssetLike[];
  chunks?: StatsChunkLike[];
  modules?: StatsModuleLike[];
};

class BuildStatsReportPlugin {
  private collectEmittedServerFiles() {
    const serverDir = path.join(process.cwd(), ".next", "server");
    const walk = (dir: string, files: string[] = []) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath, files);
          continue;
        }
        files.push(fullPath);
      }
      return files;
    };

    try {
      return walk(serverDir)
        .filter((filePath) => filePath.endsWith(".js"))
        .map((filePath) => ({
          file: path.relative(process.cwd(), filePath).replaceAll("\\", "/"),
          size: statSync(filePath).size
        }))
        .sort((left, right) => right.size - left.size)
        .slice(0, 80);
    } catch {
      return [];
    }
  }

  private collectModuleSourceSizes(stats: BuildStats) {
    const compilation = stats.compilation;
    if (!compilation?.modules) {
      return [];
    }

    const requestShortener = compilation.requestShortener;

    return Array.from(compilation.modules)
      .map((module) => {
        let sourceSize = 0;
        try {
          const source = module.originalSource?.();
          const value = source?.source?.();
          if (typeof value === "string") {
            sourceSize = Buffer.byteLength(value);
          } else if (value && typeof value.length === "number") {
            sourceSize = Number(value.length);
          }
        } catch {
          sourceSize = 0;
        }

        const readableName =
          module.userRequest ??
          module.resource ??
          (typeof module.readableIdentifier === "function" ? module.readableIdentifier(requestShortener) : null) ??
          (typeof module.identifier === "function" ? module.identifier() : module.identifier) ??
          "unknown";

        return {
          name: String(readableName),
          type: module.type ?? null,
          layer: module.layer ?? null,
          sourceSize
        };
      })
      .filter((module) => module.sourceSize > 0)
      .sort((left, right) => right.sourceSize - left.sourceSize)
      .slice(0, 120);
  }

  private writeReport(stats: BuildStats, compiler: BuildStatsCompiler) {
    const compilerName = stats.compilation?.name ?? compiler.name ?? compiler.options?.name ?? "webpack";
    const json = stats.toJson({
      all: false,
      assets: true,
      chunks: true,
      chunkModules: true,
      modules: true,
      reasons: true,
      ids: true,
      warnings: true
    }) as StatsJsonLike;
    const normalizeModule = (module: StatsModuleLike) => ({
      id: module.id ?? null,
      name: module.name ?? module.identifier ?? "unknown",
      size: Number(module.size ?? 0),
      chunks: Array.isArray(module.chunks) ? module.chunks : [],
      issuer: module.issuerName ?? null,
      reasons: Array.isArray(module.reasons)
        ? module.reasons
            .map((reason) => reason.userRequest ?? reason.moduleName ?? reason.resolvedModuleIdentifier ?? null)
            .filter(Boolean)
            .slice(0, 8)
        : []
    });
    const emittedServerFiles = this.collectEmittedServerFiles();
    const moduleSources = this.collectModuleSourceSizes(stats);
    const report = {
      generatedAt: new Date().toISOString(),
      compilerName,
      warnings: Array.isArray(json.warnings) ? json.warnings.slice(0, 25) : [],
      assets: (json.assets ?? [])
        .map((asset) => ({
          name: asset.name,
          size: Number(asset.size ?? 0),
          chunks: Array.isArray(asset.chunks) ? asset.chunks : []
        }))
        .sort((left: { size: number }, right: { size: number }) => right.size - left.size),
      chunks: (json.chunks ?? [])
        .map((chunk) => ({
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
        .slice(0, 250),
      moduleSources,
      emittedServerFiles,
      actionBrowserFiles: emittedServerFiles.filter((file) => file.file.includes("_action-browser_")).slice(0, 40)
    };

    const outDir = path.join(process.cwd(), ".next", "analyze");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, `${compilerName}.json`), JSON.stringify(report, null, 2));
  }

  apply(compiler: BuildStatsCompiler) {
    compiler.hooks.afterEmit.tap("BuildStatsReportPlugin", (compilation: BuildStatsCompilation) => {
      this.writeReport(compilation.getStats(), compiler);
    });
    compiler.hooks.done.tap("BuildStatsReportPlugin", (stats: BuildStats) => {
      this.writeReport(stats, compiler);
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
  turbopack: {}
};

if (useWebpackConfig) {
  nextConfig.webpack = (config, { dev }) => {
    if (shouldEmitBuildStats && !dev) {
      config.plugins = [...(config.plugins ?? []), new BuildStatsReportPlugin()];
    }

    if (!dev && shouldDisableWebpackCache) {
      config.cache = false;
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
  };
}

export default nextConfig;
