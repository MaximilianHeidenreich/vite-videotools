import { calculateOutputDimensions, log } from "./utils.ts";
import path, { type ParsedPath } from "path";
import fs from "fs/promises";
import { constants as fsConstants } from "fs";

import ffmpeg from "@mmomtchev/ffmpeg";
import {
  Demuxer,
  Discarder,
  Muxer,
  VideoDecoder,
  VideoEncoder,
  VideoTransform,
  type VideoStreamDefinition,
} from "@mmomtchev/ffmpeg/stream";
import type { FFMPEGConfig } from "./types.ts";

function pipeAll<T>(source: T, stages: any[]) {
  return stages.reduce((prev, stage) => prev.pipe(stage), source);
}

export interface VideoTransformerConfig {
  srcFile: string;
  outDir: string;
  directives: Record<string, string>;
  ASSET_HASH: string;
  CACHE_DIR: string;
}
export class VideoTransformer {
  readonly srcFile: ParsedPath;
  readonly outDir: string;
  readonly ASSET_HASH: string;
  readonly CACHE_DIR: string;

  demuxer?: Demuxer;
  videoDecoder?: VideoDecoder;
  metadata?: VideoStreamDefinition;

  get absoluteSrcFilePath(): string {
    return path.resolve(path.format(this.srcFile));
  }

  constructor({
    srcFile,
    outDir,
    directives,
    CACHE_DIR,
    ASSET_HASH,
  }: VideoTransformerConfig) {
    this.srcFile = path.parse(srcFile);
    this.outDir = outDir;
    this.CACHE_DIR = CACHE_DIR;
    this.ASSET_HASH = ASSET_HASH;

    console.warn("directived", directives);
  }

  async openVideo(): Promise<void> {
    if (this.demuxer) return;
    return new Promise((res, rej) => {
      this.demuxer = new Demuxer({
        inputFile: this.absoluteSrcFilePath,
      });

      this.demuxer.once("ready", () => {
        if (this.demuxer!.video[0] == undefined) {
          log.error(`No video[0] found in file ${this.absoluteSrcFilePath}`);
          return rej(`No video[0] found in file ${this.absoluteSrcFilePath}`);
        }

        this.videoDecoder = new VideoDecoder(this.demuxer!.video[0]!);
        this.metadata = this.videoDecoder.definition();

        return res();
      });
      this.demuxer.on("error", (e) => {
        log.error(`Could not open video file ${this.absoluteSrcFilePath}`);
        return rej(e);
      });
    });
  }

  async transformIntoURL({
    directives,
  }: {
    directives: URLSearchParams;
  }): Promise<string> {
    if (!directives.has("format")) {
      log.error(`Missing format for file  ${this.absoluteSrcFilePath}`);
      throw new Error("No format");
    }

    const format = directives.get("format")!;
    const width = directives.has("w") ? Number(directives.get("w")) : undefined;
    const height = directives.has("h")
      ? Number(directives.get("h"))
      : undefined;
    const fps = directives.has("fps")
      ? new ffmpeg.Rational(Number(directives.get("fps")), 1)
      : undefined;
    const bitRate = directives.has("bitRate")
      ? Number(directives.get("bitRate"))
      : undefined;

    const cachedFileName = `${this.ASSET_HASH}.${format}`;
    const outFile = path.join(this.CACHE_DIR, cachedFileName);

    const out = this.ffmpeg({
      //inputFile: this.srcFilePath,
      outputFile: outFile,
      outputFormat: format,

      codec: ffmpeg.AV_CODEC_VP8,
      pixelFormat: new ffmpeg.PixelFormat(ffmpeg.AV_PIX_FMT_YUV420P),

      width,
      height,
      frameRate: fps,
      bitRate,
    });

    return out;
  }

  /**
   * Calls ffmpeg lib with config to create output file
   * @returns output file path
   */
  ffmpeg({
    inputFile,
    demuxer,
    outputFile,
    outputFormat,
    codec,
    bitRate,
    width,
    height,
    frameRate,
    pixelFormat,
  }: {
    /** The input file, to use, falls back to internal demuxer if not specified. */
    inputFile?: string;

    /** Override with custom Demuxer */
    demuxer?: Demuxer;
    outputFile: string;
    outputFormat: string;
  } & FFMPEGConfig): Promise<string> {
    log.debug("Starting FFMPEG for %O", { inputFile, outputFile });
    return new Promise((res, rej) => {
      try {
        if (!demuxer && !inputFile && !demuxer && !this.demuxer) {
          log.error("Cannt use ffmpeg without inputFile or demuxer!");
          return rej("Cannt use ffmpeg without inputFile or demuxer!");
        }
        let useExistingDemuxer = true;
        if (!demuxer && inputFile) {
          demuxer = new Demuxer({ inputFile });
          useExistingDemuxer = true;
        } else if (!demuxer && this.demuxer) {
          demuxer = this.demuxer;
        }

        const process = () => {
          const input = demuxer!;

          if (input.video[0] == undefined) {
            log.error(`No video[0] found in file ${inputFile}`);
            return rej(`No video[0] found in file ${inputFile}`);
          }
          if (input.audio[0] == undefined) {
            log.debug(`No audio[0] found in file ${inputFile}`);
          }

          // TODO: Add support for audio transforms / keeping audio
          const audioDiscard = new Discarder();
          let videoInput: VideoDecoder;
          let videoInputDefinition: VideoStreamDefinition;
          if (this.videoDecoder && this.metadata) {
            videoInput = this.videoDecoder;
            videoInputDefinition = this.metadata;
          } else {
            videoInput = new VideoDecoder(input.video[0]!);
            videoInputDefinition = videoInput.definition();
          }

          const { width: outWidth, height: outHeight } =
            calculateOutputDimensions(
              videoInputDefinition.width,
              videoInputDefinition.height,
              width,
              height,
            );

          const videoOutputDefinition = {
            type: "Video",
            codec: codec ?? videoInputDefinition.codec,
            bitRate: bitRate ?? videoInputDefinition.bitRate,
            width: outWidth,
            height: outHeight,
            frameRate: frameRate ?? videoInputDefinition.frameRate,
            pixelFormat: pixelFormat ?? videoInputDefinition.pixelFormat,
          } as VideoStreamDefinition;

          const videoOutput = new VideoEncoder(videoOutputDefinition);

          let videoRescaler: VideoTransform | undefined;
          if (
            videoInputDefinition.width !== videoOutputDefinition.width ||
            videoInputDefinition.height !== videoOutputDefinition.height ||
            videoInputDefinition.pixelFormat !==
            videoOutputDefinition.pixelFormat
          ) {
            videoRescaler = new VideoTransform({
              input: videoInputDefinition,
              output: videoOutputDefinition,
              interpolation: ffmpeg.SWS_BILINEAR,
            });
          }

          const output = new Muxer({
            outputFile,
            outputFormat,
            streams: [videoOutput],
          });

          output.on("finish", () => {
            log.info(`Transform done! ${outputFile}`);
            res(outputFile);
          });

          input.video[0]!.on("error", (err: any) => {
            log.error(err);
            rej();
          });
          input.audio[0]?.on("error", (err: any) => {
            log.error(err);
            rej();
          });
          output.video[0]!.on("error", (err: any) => {
            log.error(err);
            rej();
          });

          const videoPipeline = pipeAll(input.video[0]!, [
            videoInput,
            ...(videoRescaler ? [videoRescaler] : []),
            videoOutput,
            output.video[0]!,
          ]);

          input.audio[0]?.pipe(audioDiscard);
        };

        if (useExistingDemuxer) return process();
        else {
          demuxer!.once("ready", process);
        }
      } catch (err) {
        log.error(err);
        rej(err);
      }
    });
  }
}
