import { calculateOutputDimensions, log } from "./utils.ts";
import path, { type ParsedPath } from "path";
import type { FFMPEGConfig, VideoMetadata } from "./types.ts";

export interface VideoTransformerConfig {
  srcFile: string;
  outDir: string;
  directives: Record<string, string>;
  ASSET_HASH: string;
  CACHE_DIR: string;
}

/** Parse ffmpeg time string (HH:MM:SS.ms) to seconds */
function parseTimeToSeconds(timeStr: string): number {
  const parts = timeStr.split(":");
  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts;
    return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
  }
  return 0;
}

export class VideoTransformer {
  readonly srcFile: ParsedPath;
  readonly outDir: string;
  readonly ASSET_HASH: string;
  readonly CACHE_DIR: string;

  metadata?: VideoMetadata;

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
    if (this.metadata) return;

    const inputFile = this.absoluteSrcFilePath;

    // Use ffprobe to get video metadata
    const result =
      await Bun.$`ffprobe -v quiet -print_format json -show_streams -show_format ${inputFile}`.json();

    const videoStream = result.streams?.find(
      (s: any) => s.codec_type === "video",
    );

    if (!videoStream) {
      log.error(`No video stream found in file ${inputFile}`);
      throw new Error(`No video stream found in file ${inputFile}`);
    }

    // Parse frame rate (can be "30/1" or "29.97" format)
    let frameRate = 30;
    if (videoStream.r_frame_rate) {
      const [num, den] = videoStream.r_frame_rate.split("/");
      frameRate = den ? Number(num) / Number(den) : Number(num);
    }

    this.metadata = {
      width: videoStream.width,
      height: videoStream.height,
      codec: videoStream.codec_name,
      bitRate: Number(videoStream.bit_rate || result.format?.bit_rate || 0),
      frameRate,
      pixelFormat: videoStream.pix_fmt,
      duration: Number(result.format?.duration || videoStream.duration || 0),
    };
  }

  async transformIntoURL({
    directives,
  }: {
    directives: URLSearchParams;
  }): Promise<string> {
    if (!directives.has("format")) {
      log.error(`Missing format for file ${this.absoluteSrcFilePath}`);
      throw new Error("No format");
    }

    const format = directives.get("format")!;
    const width = directives.has("w") ? Number(directives.get("w")) : undefined;
    const height = directives.has("h")
      ? Number(directives.get("h"))
      : undefined;
    const fps = directives.has("fps")
      ? Number(directives.get("fps"))
      : undefined;
    const bitRate = directives.has("bitRate")
      ? Number(directives.get("bitRate"))
      : undefined;

    const cachedFileName = `${this.ASSET_HASH}.${format}`;
    const outFile = path.join(this.CACHE_DIR, cachedFileName);

    const out = await this.ffmpeg({
      inputFile: this.absoluteSrcFilePath,
      outputFile: outFile,
      outputFormat: format,
      codec: format === "webm" ? "libvpx" : undefined,
      pixelFormat: "yuv420p",
      width,
      height,
      frameRate: fps,
      bitRate,
    });

    return out;
  }

  /**
   * Calls ffmpeg CLI with config to create output file
   * @returns output file path
   */
  async ffmpeg({
    inputFile,
    outputFile,
    outputFormat,
    codec,
    bitRate,
    width,
    height,
    frameRate,
    pixelFormat,
  }: {
    inputFile?: string;
    outputFile: string;
    outputFormat: string;
  } & FFMPEGConfig): Promise<string> {
    const input = inputFile ?? this.absoluteSrcFilePath;

    log.debug("Starting FFMPEG for %O", { inputFile: input, outputFile });

    // Make sure we have metadata
    if (!this.metadata) {
      await this.openVideo();
    }

    const { width: outWidth, height: outHeight } = calculateOutputDimensions(
      this.metadata!.width,
      this.metadata!.height,
      width,
      height,
    );

    // Build ffmpeg arguments
    const args: string[] = ["-y", "-i", input];

    // Video codec
    if (codec) {
      args.push("-c:v", codec);
    }

    // Pixel format
    if (pixelFormat) {
      args.push("-pix_fmt", pixelFormat);
    }

    // Bitrate
    if (bitRate) {
      args.push("-b:v", String(bitRate));
    }

    // Frame rate
    if (frameRate) {
      args.push("-r", String(frameRate));
    }

    // Scale filter for dimensions
    if (
      outWidth !== this.metadata!.width ||
      outHeight !== this.metadata!.height
    ) {
      args.push("-vf", `scale=${outWidth}:${outHeight}`);
    }

    // Output format
    args.push("-f", outputFormat);

    // No audio (matching original behavior)
    args.push("-an");

    // Output file
    args.push(outputFile);

    log.debug("FFMPEG args: %O", args);

    const fileName = path.basename(input);
    const totalDuration = this.metadata!.duration;
    log.debug("Total duration: %d seconds", totalDuration);

    try {
      const proc = Bun.spawn(["ffmpeg", ...args], {
        stdout: "ignore",
        stderr: "pipe",
      });

      // Parse stderr for progress
      const reader = proc.stderr.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let lastProgress = -1;

      const readProgress = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Parse progress lines - ffmpeg outputs: time=00:00:05.23 (variable decimal places)
          const timeMatch = buffer.match(/time=(\d{2}:\d{2}:\d{2}\.\d+)/g);
          if (timeMatch) {
            const lastTimeStr = timeMatch[timeMatch.length - 1].replace(
              "time=",
              "",
            );
            const currentTime = parseTimeToSeconds(lastTimeStr);

            if (totalDuration > 0) {
              const progress = Math.min(
                100,
                Math.round((currentTime / totalDuration) * 100),
              );

              // Only log when progress changes significantly (every 10%)
              if (progress >= lastProgress + 10) {
                lastProgress = progress;
                log.info(`${fileName}: ${progress}% encoded`);
              }
            } else {
              // No duration info - just show time processed
              log.debug(`${fileName}: processed ${lastTimeStr}`);
            }
          }

          // Keep buffer small - only keep last 1000 chars
          if (buffer.length > 1000) {
            buffer = buffer.slice(-1000);
          }
        }
      };

      // Wait for both stderr reading and process exit
      const [_, exitCode] = await Promise.all([readProgress(), proc.exited]);

      if (exitCode !== 0) {
        throw new Error(`ffmpeg exited with code ${exitCode}`);
      }

      log.info(`[videotools] ${fileName}: complete!`);
      log.info(`Transform done! ${outputFile}`);
      return outputFile;
    } catch (error) {
      log.error("FFMPEG error:", error);
      throw error;
    }
  }
}
