import ffmpeg from "@mmomtchev/ffmpeg";

export enum ViteImportType {
  /**
   * Import will return single url string to output file or
   * array of url strings if multiple combinations of target files.
   */
  URL = "url",

  /** Import will return */
  Video = "video",
  SrcSet = "srcset",
  Metadata = "metadata",
}

export type Include = Array<string | RegExp> | string | RegExp;

export type Exclude = Array<string | RegExp> | string | RegExp;

export interface VitePluginOptions {
  /**
   * Which paths to include when processing videos.
   * @default '**\/*.\{mov,mp4,webm\}?*'
   */
  include: Include;
  /**
   * What paths to exclude when processing videos.
   * This defaults to the public dir to mirror vites behavior.
   * @default 'public\/**\/*'
   */
  exclude: Exclude;

  /**
   * This option allows you to specify directives that should be applied _by default_ to every image.
   * You can also provide a function, in which case the function gets passed the asset ID and should return an object of directives.
   * This can be used to define all sorts of shorthands or presets.
   *
   * @example
   * ```js
   * import { defineConfig } from 'vite'
   * import { imagetools } from 'vite-imagetools'
   *
   * export default defineConfig({
   *  plugins: [
   *    imagetools({
   *       defaultDirectives: (url) => {
   *        if (url.searchParams.has('spotify')) {
   *           return new URLSearchParams({
   *             tint: 'ffaa22'
   *           })
   *         }
   *         return new URLSearchParams()
   *       }
   *     })
   *    ]
   * })
   * ```
   */
  //defaultDirectives?: DefaultDirectives

  /**
   * You can use this option to extend the builtin list of import transforms.
   * This list will be merged with the builtin transforms before applying them to the input image.
   * @default []
   */
  //extendTransforms?: ExtendTransforms

  /**
   * You can use this option to extend the builtin list of output formats.
   * This list will be merged with the builtin output formats before determining the format to use.
   * @default []
   */
  //extendOutputFormats?: ExtendOutputFormats

  /**
   * You can use this option to override the resolution of configs based on the url parameters
   * @default undefined
   */
  //resolveConfigs?: ResolveConfigs

  /**
   * Whether to remove potentially private metadata from the image, such as exif tags etc.
   * @default true
   */
  //removeMetadata: boolean

  /**
   * Whether to generate named exports.
   * Takes precedence over Vite's `json.namedExports`
   * @default undefined
   */
  //namedExports?: boolean

  /**
   * Whether to cache transformed images and options for caching.
   */
  //cache?: CacheOptions
}

export enum VideoCodec {
  AV_CODEC_H264 = "AV_CODEC_H264",
  AV_CODEC_VP8 = "AV_CODEC_VP8",
}
export const VideoCodecNames: Record<VideoCodec, string> = {
  AV_CODEC_H264: "h264",
  AV_CODEC_VP8: "mp4",
};

export const VideoCodecFilenames: Record<VideoCodec, string> = {
  AV_CODEC_H264: "h264",
  AV_CODEC_VP8: "webm",
};

export enum VideoFormat {
  WEBM = "webm",
  MP4 = "mp4",
}

export interface FFMPEGConfig {
  codec?: number;
  bitRate?: number;
  width?: number;
  height?: number;
  frameRate?: ffmpeg.Rational;
  pixelFormat?: ffmpeg.PixelFormat;
}

export interface TransformDirectives {
  format: VideoFormat;

  w: number;
  h: number;

  fps: number;
  bitRate: number;
}
