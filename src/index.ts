import path, { resolve, join, relative } from "path";
import fs from "fs";
import { log, parseURL, getHash, parseAssetId } from "./utils.ts";
import { createFilter, dataToEsm } from "@rollup/pluginutils";
import { R2StorageAdapter, StorageAdapter } from "./storage.ts";
import type { Plugin, ResolvedConfig } from "vite";
import type { VitePluginOptions } from "./types.ts";

const storageCache = new Map<string, boolean>();

// Track in-progress transformations to avoid duplicate work
const transformationQueue = new Map<string, Promise<string>>();

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
    fs.mkdirSync(CACHE_DIR, { recursive: true });
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

      configureServer(server) {
        // Middleware to serve transformed videos
        server.middlewares.use(async (req, res, next) => {
          if (!req.url?.startsWith("/@videotools/")) {
            return next();
          }

          const fileName = req.url.replace("/@videotools/", "");
          const filePath = resolve(join(CACHE_DIR, fileName));

          // Wait for transformation if in progress
          const pendingTransform = transformationQueue.get(fileName);
          if (pendingTransform) {
            try {
              await pendingTransform;
            } catch (err) {
              res.statusCode = 500;
              res.end("Video transformation failed");
              return;
            }
          }

          if (fs.existsSync(filePath)) {
            const stat = fs.statSync(filePath);
            const ext = path.extname(fileName).slice(1);
            const mimeType =
              ext === "webm"
                ? "video/webm"
                : ext === "mp4"
                  ? "video/mp4"
                  : "video/mp4";

            res.setHeader("Content-Type", mimeType);
            res.setHeader("Content-Length", stat.size);
            res.setHeader("Cache-Control", "max-age=31536000, immutable");

            const stream = fs.createReadStream(filePath);
            stream.pipe(res);
          } else {
            res.statusCode = 404;
            res.end(
              "Video not found - transformation may still be in progress",
            );
          }
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

        // If not cached and not already transforming, start transformation in background
        if (
          !fs.existsSync(cached_file) &&
          !transformationQueue.has(cachedFileName)
        ) {
          log.info("Transforming video asset: ", cachedFileName);

          const transformPromise = (async () => {
            const { VideoTransformer } = await import("./transformer.ts");

            const transformer = new VideoTransformer({
              CACHE_DIR,
              srcFile: pathname,
              outDir: resolve(CACHE_DIR),
              ASSET_HASH,
              directives: ASSET_DIRECTIVES,
            });

            const result = await transformer.transformIntoURL({
              directives: srcURL.searchParams,
            });

            // Upload to storage after transformation completes
            const storageFileName = `@videotools/${cachedFileName}`;
            if (!storageCache.get(storageFileName)) {
              if (!(await storageAdapter?.hasFile(storageFileName))) {
                log.info("Uploading video asset to S3: ", cachedFileName);
                await storageAdapter?.uploadFile(cached_file, storageFileName);
                storageCache.set(storageFileName, true);
              }
            }

            transformationQueue.delete(cachedFileName);
            return result;
          })();

          transformationQueue.set(cachedFileName, transformPromise);
          // Don't await here - middleware will wait for the transformation
        } else if (fs.existsSync(cached_file)) {
          const storageFileName = `@videotools/${cachedFileName}`;
          if (!storageCache.get(storageFileName)) {
            if (!(await storageAdapter?.hasFile(storageFileName))) {
              log.info("Uploading video asset to S3: ", cachedFileName);
              await storageAdapter?.uploadFile(cached_file, storageFileName);
              storageCache.set(storageFileName, true);
            }
          }
        }

        // Return URL that will be served by our middleware
        const videoUrl = `/@videotools/${cachedFileName}`;

        return dataToEsm(videoUrl, {
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
        PUBLIC_PATH = ENV["VITE_VIDEOTOOLS_R2_PUBLIC_URL"];
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
