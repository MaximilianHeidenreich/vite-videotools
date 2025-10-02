import { ViteImportType } from "./types";

export function parseURL(rawURL: string) {
  return new URL(rawURL.replace(/#/g, "%23"), "file://");
}

export function getViteUrlImportType(url: URL): ViteImportType {
  if (url.searchParams.has("url")) return ViteImportType.URL;
  else if (url.searchParams.has("video")) return ViteImportType.Video;
  else if (url.searchParams.has("srcset")) return ViteImportType.SrcSet;
  else if (url.searchParams.has("metadata")) return ViteImportType.Metadata;
  else return ViteImportType.URL;
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
