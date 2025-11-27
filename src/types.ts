export type Include = Array<string | RegExp> | string | RegExp;
export type Exclude = Array<string | RegExp> | string | RegExp;

export interface VitePluginOptions {
  /**
   * Enable video transformation and R2 upload.
   * When false, only reads from metadata files.
   * @default process.env.VIDEOTOOLS_ENABLED === 'true'
   */
  enabled?: boolean;

  /**
   * Path to the metadata JSON file (committable to git)
   * @default '.videotools/metadata.json'
   */
  metadataPath?: string;

  /**
   * Directory for temporary cache files
   * @default 'node_modules/.cache/vite-videotools'
   */
  cacheDir?: string;

  //  r2?: R2Config;

  /**
   * Which paths to include when processing videos.
   * @default '**\/*.\{mov,mp4,webm\}?*'
   */
  include?: Include;
  /**
   * What paths to exclude when processing videos.
   * This defaults to the public dir to mirror vites behavior.
   * @default 'public\/**\/*'
   */
  exclude?: Exclude;
}

export enum VideoFormat {
  WEBM = "webm",
  MP4 = "mp4",
}

export interface FFMPEGConfig {
  codec?: string;
  bitRate?: number;
  width?: number;
  height?: number;
  frameRate?: number;
  pixelFormat?: string;
}

export interface VideoMetadata {
  width: number;
  height: number;
  codec: string;
  bitRate: number;
  frameRate: number;
  pixelFormat: string;
  duration: number;
}

export interface TransformDirectives {
  format: VideoFormat;

  w: number;
  h: number;

  fps: number;
  bitRate: number;
}
