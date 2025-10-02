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
import type { FFMPEGConfig } from "./types";
import { calculateOutputDimensions } from "./utils";

export interface VideoTransformerProps {
  srcFile: ParsedPath;
  directives: URLSearchParams;
}

export class VideoTransformer {
  readonly srcFile: ParsedPath;
  readonly rawDirectives: URLSearchParams;
  readonly basePath: string;

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

  //transform(): Promise<void> {
  //  return ;
  //}

  /**
   * Calls ffmpeg lib with config to create output file
   * @returns output file path
   */
  ffmpeg({
    inputFile,
    outputFile,
    outputFormat,
    codec,
    bitRate,
    width,
    height,
    frameRate,
    pixelFormat,
  }: { inputFile: string; outputFile: string; outputFormat: string } & FFMPEGConfig): Promise<string> {
    this.log.debug("Starting FFMPEG for %O", { inputFile, outputFile });
    return new Promise((res, rej) => {
      try {
        const input = new Demuxer({ inputFile });

        input.on("ready", () => {
          if (input.video[0] == undefined) {
            this.log.error(`No video[0] found in file ${inputFile}`);
            rej();
          }
          if (input.audio[0] == undefined) {
            this.log.debug(`No audio[0] found in file ${inputFile}`);
          }

          // TODO: Add support for audio transforms / keeping audio
          const audioDiscard = new Discarder();
          const videoInput = new VideoDecoder(input.video[0]!);
          const videoInputDefinition = videoInput.definition();

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

          // This launches the transcoding
          // Demuxer -> Decoder -> Rescaler -> Encoder -> Muxer
          let pipeline: any = input.video[0]!.pipe(videoInput);
          if (videoRescaler) pipeline = pipeline.pipe(videoRescaler);
          pipeline = pipeline.pipe(videoOutput).pipe(output.video[0]!);

          input.audio[0]?.pipe(audioDiscard);
        });
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

    const relOutFile = `/@videotools/${this.srcFile.base}_${directives.toString()}.${format}`;
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
      inputFile: this.srcFilePath,
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
