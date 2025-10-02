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

import debug from "debug";
import type { FFMPEGConfig, VideoMetadata } from "./types";
import { calculateOutputDimensions, getFileHash } from "./utils";

function pipeAll<T>(source: T, stages: any[]) {
  return stages.reduce((prev, stage) => prev.pipe(stage), source);
}

export interface VideoTransformerProps {
  srcFile: ParsedPath;
  directives: URLSearchParams;
}

export class VideoTransformer {
  readonly srcFile: ParsedPath;
  readonly rawDirectives: URLSearchParams;
  readonly basePath: string;

  demuxer?: Demuxer;
  videoDecoder?: VideoDecoder;
  metadata?: VideoMetadata;

  get srcFilePath(): string {
    return path.format(this.srcFile);
  }

  get outFileName() {
    return `${this.srcFile.base}?${this.rawDirectives.toString()}`;
  }

  private readonly log: Console;

  constructor({ srcFile, directives }: VideoTransformerProps) {
    this.srcFile = srcFile;
    this.rawDirectives = directives;
    this.basePath = "";

    // @ts-ignore
    this.log = {
      debug: debug(`vite-videotools:debug ${this.srcFile.base}`),
      info: debug(`vite-videotools:info ${this.srcFile.base}`),
      warn: debug(`vite-videotools:warn ${this.srcFile.base}`),
      error: debug(`vite-videotools:error ${this.srcFile.base}`),
    } as Console;
  }

  static async getFileHashName({ file, directives }: { file: ParsedPath; directives: URLSearchParams }) {
    const hash = await getFileHash(path.format(file));
    return `${file.base}++${directives.toString()}++${hash}`;
  }

  async openVideo(): Promise<void> {
    if (this.demuxer) return;
    return new Promise((res, rej) => {
      this.demuxer = new Demuxer({ inputFile: this.srcFilePath });

      this.demuxer.once("ready", () => {
        if (this.demuxer!.video[0] == undefined) {
          this.log.error(`No video[0] found in file ${this.srcFilePath}`);
          return rej(`No video[0] found in file ${this.srcFilePath}`);
        }

        this.videoDecoder = new VideoDecoder(this.demuxer!.video[0]!);
        this.metadata = this.videoDecoder.definition();

        return res();
      });
      this.demuxer.on("error", (e) => {
        this.log.error(`Could not open video file ${this.srcFilePath}`);
        return rej(e);
      });
    });
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
    this.log.debug("Starting FFMPEG for %O", { inputFile, outputFile });
    return new Promise((res, rej) => {
      try {
        if (!demuxer && !inputFile && !demuxer && !this.demuxer) {
          this.log.error("Cannt use ffmpeg without inputFile or demuxer!");
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
            this.log.error(`No video[0] found in file ${inputFile}`);
            return rej(`No video[0] found in file ${inputFile}`);
          }
          if (input.audio[0] == undefined) {
            this.log.debug(`No audio[0] found in file ${inputFile}`);
          }

          // TODO: Add support for audio transforms / keeping audio
          const audioDiscard = new Discarder();
          let videoInput: VideoDecoder;
          let videoInputDefinition: VideoMetadata;
          if (this.videoDecoder && this.metadata) {
            videoInput = this.videoDecoder;
            videoInputDefinition = this.metadata;
          } else {
            videoInput = new VideoDecoder(input.video[0]!);
            videoInputDefinition = videoInput.definition();
          }

          const { width: outWidth, height: outHeight } = calculateOutputDimensions(
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
            videoInputDefinition.pixelFormat !== videoOutputDefinition.pixelFormat
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
            this.log.info(`Transform done! ${outputFile}`);
            res(outputFile);
          });

          input.video[0]!.on("error", (err) => {
            this.log.error(err);
            rej();
          });
          input.audio[0]?.on("error", (err) => {
            this.log.error(err);
            rej();
          });
          output.video[0]!.on("error", (err) => {
            this.log.error(err);
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
        this.log.error(err);
        rej(err);
      }
    });
  }

  async transformIntoURL({ directives }: { directives: URLSearchParams }): Promise<string> {
    if (!directives.has("format")) {
      this.log.error(`Missing format for file  ${this.srcFilePath}`);
      throw new Error("No format");
    }

    const format = directives.get("format")!;
    const width = directives.has("w") ? Number(directives.get("w")) : undefined;
    const height = directives.has("h") ? Number(directives.get("h")) : undefined;
    const fps = directives.has("fps") ? new ffmpeg.Rational(Number(directives.get("fps")), 1) : undefined;
    const bitRate = directives.has("bitRate") ? Number(directives.get("bitRate")) : undefined;

    const relOutFile = `/@videotools/${await VideoTransformer.getFileHashName({ file: this.srcFile, directives })}.${format}`;
    const outputFile = `/Users/max/Developer/mvh-homepage/static${relOutFile}`;

    let exists = false;
    try {
      await fs.access(outputFile, fsConstants.F_OK);
      exists = true;
    } catch {
      exists = false;
    }
    if (exists) {
      this.log.debug(`Using cached version of file ${this.srcFilePath}`);
      return Promise.resolve(relOutFile);
    }

    const out = this.ffmpeg({
      //inputFile: this.srcFilePath,
      outputFile,
      outputFormat: format,

      codec: ffmpeg.AV_CODEC_VP8,
      pixelFormat: new ffmpeg.PixelFormat(ffmpeg.AV_PIX_FMT_YUV420P),

      width,
      height,
      frameRate: fps,
      bitRate,
    });

    return out.then((_) => relOutFile);
  }

  transform({ directives }: { directives: URLSearchParams }) {
    // TODO: Check if file import has multiple formats -> error
  }
  transformSrcSetImport() { }
}
