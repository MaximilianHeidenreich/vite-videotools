import path from "path";
import debug from "debug";
import crypto from "crypto";
import fs from "fs";

export const log = {
  debug: debug("vite-videotools:debug"),
  info: debug("vite-videotools:info"),
  warn: debug("vite-videotools:warn"),
  error: debug("vite-videotools:error"),
};

export function getHash(str: string): string {
  const hash = crypto.createHash("sha1");
  hash.update(str);
  return hash.digest("hex");
}
export const getFileHash = (path: string) =>
  new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha1");
    const rs = fs.createReadStream(path);
    rs.on("error", reject);
    rs.on("data", (chunk) => hash.update(chunk));
    rs.on("end", () => resolve(hash.digest("hex")));
  });

export function parseURL(rawURL: string) {
  return new URL(rawURL.replace(/#/g, "%23"), "file://");
}

export function parseAssetId(id: string) {
  const srcURL = parseURL(id);
  const pathname = decodeURIComponent(srcURL.pathname);
  const relativePath = path.relative(process.cwd(), pathname);

  const ASSET_URL = `${relativePath}?${srcURL.searchParams.toString()}`;
  const ASSET_HASH = getHash(ASSET_URL);
  const ASSET_MIME_TYPE = "webm";
  const ASSET_DIRECTIVES = Object.fromEntries(srcURL.searchParams.entries());
  return { ASSET_HASH, ASSET_URL, ASSET_MIME_TYPE, ASSET_DIRECTIVES };
}

export function calculateOutputDimensions(
  inputWidth: number,
  inputHeight: number,
  targetWidth?: number,
  targetHeight?: number,
): { width: number; height: number } {
  // If neither dimension specified, return original dimensions
  if (targetWidth === undefined && targetHeight === undefined) {
    return { width: inputWidth, height: inputHeight };
  }

  let outputWidth: number;
  let outputHeight: number;

  // Both dimensions specified - use them directly
  if (targetWidth !== undefined && targetHeight !== undefined) {
    outputWidth = targetWidth;
    outputHeight = targetHeight;
  }
  // Only width specified - calculate height maintaining aspect ratio
  else if (targetWidth !== undefined) {
    outputWidth = targetWidth;
    // Scale height by the same factor as width
    const scaleFactor = targetWidth / inputWidth;
    outputHeight = Math.round(inputHeight * scaleFactor);
  }
  // Only height specified - calculate width maintaining aspect ratio
  else {
    outputHeight = targetHeight!;
    // Scale width by the same factor as height
    const scaleFactor = targetHeight! / inputHeight;
    outputWidth = Math.round(inputWidth * scaleFactor);
  }

  // Ensure both dimensions are even (divisible by 2) for codec compatibility
  if (outputWidth % 2 !== 0) {
    outputWidth += 1;
  }
  if (outputHeight % 2 !== 0) {
    outputHeight += 1;
  }

  return { width: outputWidth, height: outputHeight };
}
