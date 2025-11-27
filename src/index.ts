import path, { resolve, join, relative } from "path";
import fs from "fs";
import { log, parseURL, getHash, parseAssetId } from "./utils.ts";
import { createFilter, dataToEsm } from "@rollup/pluginutils";
import { R2StorageAdapter, StorageAdapter } from "./storage.ts";
import type { Plugin, ResolvedConfig } from "vite";
import type { VitePluginOptions } from "./types.ts";

const storageCache = new Map<string, boolean>();

export function videotools(
  userOptions: Partial<VitePluginOptions> = {},
): Plugin[] {
  const defaultOptions: Partial<VitePluginOptions> = {
    include: /^[^?]+\.(mp4|mov|webm|avi)(\?.*)?$/,
    exclude: "static/**/*",
    metadataPath: ".videotools/metadata.json",
    cacheDir: "node_modules/.cache/vite-videotools",
  };

  let config: ResolvedConfig;
  const userConfig: VitePluginOptions = { ...defaultOptions, ...userOptions };
  const CACHE_DIR = userConfig.cacheDir!;
  let PUBLIC_PATH: string | undefined = undefined;

  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR);
  }

  const filter = createFilter(userConfig.include, userConfig.exclude);

  let storageAdapter: StorageAdapter | null = null;

  return [
    {
      name: "vite-videotools:serve",
      enforce: "pre",
      apply: "serve",

      async configResolved(resolvedConfig) {
        config = resolvedConfig;
        const ENV = config.env;
        const PUBLIC_DIR = config.publicDir;
        const CWD_ROOT = config.root;
        PUBLIC_PATH = ENV["VITE_VIDEOTOOLS_R2_PUBLIC_URL"];

        storageAdapter = new R2StorageAdapter({
          accessKeyId: ENV["VITE_VIDEOTOOLS_R2_ACCESS_KEY_ID"],
          secretAccessKey: ENV["VITE_VIDEOTOOLS_R2_SECRET_ACCESS_KEY"],
          endpoint: ENV["VITE_VIDEOTOOLS_R2_ENDPOINT"],
          bucket: ENV["VITE_VIDEOTOOLS_R2_BUCKET"],
        });
      },

      async load(id: string): Promise<string | null> {
        if (!filter(id)) return null;

        const srcURL = parseURL(id);
        const pathname = decodeURIComponent(srcURL.pathname);
        const relativePath = relative(process.cwd(), pathname);

        const { ASSET_URL, ASSET_HASH, ASSET_MIME_TYPE, ASSET_DIRECTIVES } =
          parseAssetId(id);
        log.debug("Loading video asset:", ASSET_URL, ASSET_HASH);

        const cachedFileName = `${ASSET_HASH}.${ASSET_MIME_TYPE}`;
        const cached_file = resolve(join(CACHE_DIR, cachedFileName));

        if (!fs.existsSync(cached_file)) {
          log.info("Transforming video asset: ", cachedFileName);
          const { VideoTransformer } = await import("./transformer.ts");

          const transformer = new VideoTransformer({
            CACHE_DIR,
            srcFile: pathname,
            outDir: resolve(CACHE_DIR),
            ASSET_HASH,
            directives: ASSET_DIRECTIVES,
          });
        }

        const storageFileName = `@videotools/${cachedFileName}`;
        if (!storageCache.get(storageFileName)) {
          if (!(await storageAdapter?.hasFile(storageFileName))) {
            log.info("Uploading video asset to S3: ", cachedFileName);
            await storageAdapter?.uploadFile(cached_file, storageFileName);
            storageCache.set(storageFileName, true);
          }
        }

        return dataToEsm(cached_file.toString(), {
          namedExports: true,
          compact: true,
          preferConst: true,
        });
      },
    },
    {
      name: "vite-videotools:build",
      enforce: "pre",
      apply: "build",

      async configResolved(resolvedConfig) {
        config = resolvedConfig;
        const ENV = config.env;

        const PUBLIC_DIR = config.publicDir;
        const CWD_ROOT = config.root;
        console.warn("env: ", ENV);
      },

      async load(id: string): Promise<string | null> {
        if (!filter(id)) return null;

        const srcURL = parseURL(id);
        const pathname = decodeURIComponent(srcURL.pathname);
        const relativePath = path.relative(process.cwd(), pathname);

        const { ASSET_URL, ASSET_HASH, ASSET_MIME_TYPE } = parseAssetId(id);
        log.debug("Loading video asset:", ASSET_URL, ASSET_HASH);

        const assetFileName = `${ASSET_HASH}.${ASSET_MIME_TYPE}`;
        const assetPath = `${PUBLIC_PATH}/@videotools/${assetFileName}`;

        return dataToEsm(assetPath, {
          namedExports: true,
          compact: true,
          preferConst: true,
        });
      },
    },
  ];
}

