import path from "path";
import { createFilter, dataToEsm } from "@rollup/pluginutils";
import type { TransformDirectives, VitePluginOptions } from "./types";
import { VideoTransformer } from "./transformer";
import { getViteUrlImportType, parseURL } from "./utils";
import debug from "debug";

const log = {
  debug: debug("vite-videotools:debug"),
  info: debug("vite-videotools:info"),
  warn: debug("vite-videotools:warn"),
  error: debug("vite-videotools:error"),
};

import ffmpeg from "@mmomtchev/ffmpeg";
import {
  Muxer,
  Demuxer,
  VideoDecoder,
  VideoEncoder,
  Discarder,
  VideoTransform,
  type VideoStreamDefinition,
} from "@mmomtchev/ffmpeg/stream";

const defaultOptions: VitePluginOptions = {
  include: /^[^?]+\.(mp4|mov|webm|avi)(\?.*)?$/,
  exclude: "public/**/*",
};

export function videotools(userOptions: Partial<VitePluginOptions> = {}) {
  const pluginOptions: VitePluginOptions = { ...defaultOptions, ...userOptions };

  const virtualModuleId = "virtual:videotools";
  const resolvedVirtualModuleId = "\0" + virtualModuleId;

  const filter = createFilter(pluginOptions.include, pluginOptions.exclude);

  //let viteConfig: ResolvedConfig
  //let basePath: string

  return {
    name: "videotools",
    enforce: "pre",

    //configResolved(cfg: any) {
    //  viteConfig = cfg
    //  basePath = createBasePath(viteConfig.base)
    //},

    //resolveId(id: string) {
    //  if (id === virtualModuleId) {
    //    return resolvedVirtualModuleId;
    //  }
    //  const srcURL = parseURL(id);
    //  const pathname = decodeURIComponent(srcURL.pathname);

    //  if (pathname.e) console.warn("SrcUrl", srcURL);
    //  console.warn("pathname", pathname);
    //},

    async load(id: string) {
      if (!filter(id)) return null;
      log.info("videotools loading id", id);

      const srcURL = parseURL(id);
      const pathname = decodeURIComponent(srcURL.pathname);
      const IMPORT_TYPE = getViteUrlImportType(srcURL);
      const srcFile = path.parse(pathname);

      log.debug(`Processing video resource @ ${srcURL.href} | type: ${IMPORT_TYPE}`);
      log.debug(srcURL);

      //const defaultDirectives =
      //  typeof pluginOptions.defaultDirectives === 'function'
      //    ? await pluginOptions.defaultDirectives(srcURL, lazyLoadMetadata)
      //    : pluginOptions.defaultDirectives || new URLSearchParams()
      const defaultDirectives = new URLSearchParams();
      const directives = new URLSearchParams({
        ...Object.fromEntries(defaultDirectives),
        ...Object.fromEntries(srcURL.searchParams),
      });

      const transformer = new VideoTransformer({
        srcFile,
        directives,
      });

      //const outputFile = `/Users/max/Developer/mvh-homepage/static/@videotools/${transformer.outFileName}`;
      //const relOutputFile = `/@videotools/${transformer.outFileName}`;

      //const transformPromise = transformer.ffmpeg({
      //  inputFile: transformer.srcFilePath,
      //  outputFile: `/Users/max/Developer/mvh-homepage/static/@videotools/${transformer.outFileName}`,

      //  //ffmpeg.AV_CODEC_H264,
      //  codec: ffmpeg.AV_CODEC_VP8,
      //  bitRate: 2.5e6,
      //  //width: 320,
      //  //height: 200,
      //  frameRate: new ffmpeg.Rational(30, 1),
      //  pixelFormat: new ffmpeg.PixelFormat(ffmpeg.AV_PIX_FMT_YUV420P),
      //  //pixelFormat: new ffmpeg.PixelFormat(ffmpeg.AV_PIX_FMT_YUV422P),
      //});

      //const transformPromise = new Promise<string>((res, rej) => {
      //  // Wait for the Demuxer to read the file headers and to
      //  // identify the various streams
      //  input.on("ready", () => {
      //    // Once the input Demuxer is ready,
      //    // it will contain two arrays of Readable:
      //    // input.video[]
      //    // input.audio[]

      //    // We will be discarding the audio stream
      //    // (unless you discard these will keep piling in memory
      //    // until you destroy the demuxer object)
      //    const audioDiscard = new Discarder();
      //    // A VideoDecoder is a Transform that reads compressed video data
      //    // and sends raw video frames (this is the decoding codec)
      //    const videoInput = new VideoDecoder(input.video[0]!);
      //    // A VideoDefinition is an object with all the properties of the stream
      //    const videoInputDefinition = videoInput.definition();

      //    // such as codec, bitrate, framerate, frame size, pixel format
      //    const videoOutputDefinition = {
      //      type: "Video",
      //      //ffmpeg.AV_CODEC_H264,
      //      codec: ffmpeg.AV_CODEC_VP8,
      //      bitRate: 2.5e6,
      //      width: 320,
      //      height: 200,
      //      frameRate: new ffmpeg.Rational(30, 1),
      //      pixelFormat: new ffmpeg.PixelFormat(ffmpeg.AV_PIX_FMT_YUV420P),
      //      //pixelFormat: new ffmpeg.PixelFormat(ffmpeg.AV_PIX_FMT_YUV422P),
      //    } as VideoStreamDefinition;

      //    // A video encoder is a Transform that reads raw video frames
      //    // and sends compressed video data (this is the encoding codec)
      //    const videoOutput = new VideoEncoder(videoOutputDefinition);

      //    // A VideoTransform is a Transform that reads raw video frames
      //    // and sends raw video frames - with different frame size or pixel format
      //    const videoRescaler = new VideoTransform({
      //      input: videoInputDefinition,
      //      output: videoOutputDefinition,
      //      interpolation: ffmpeg.SWS_BILINEAR,
      //    });

      //    // A Muxer is an object that contains multiple Writable
      //    // It multiplexes those streams, handling interleaving by buffering,
      //    // and writes the to the output format
      //    const output = new Muxer({
      //      outputFile,
      //      outputFormat: "webm",
      //      streams: [videoOutput],
      //    });

      //    // The transcoding operation is completely asynchronous, it is finished
      //    // when all output streams are finished
      //    output.on("finish", () => {
      //      log.info("Transform done!", pathname);
      //      res(relOutputPath);
      //    });

      //    // These are the error handlers (w/o them the process will stop on error)
      //    input.video[0]!.on("error", (err) => {
      //      log.error(err);
      //    });
      //    input.audio[0]?.on("error", (err) => log.error(err));
      //    output.video[0]!.on("error", (err) => log.error(err));

      //    // This launches the transcoding
      //    // Demuxer -> Decoder -> Rescaler -> Encoder -> Muxer
      //    input.video[0]!.pipe(videoInput).pipe(videoRescaler).pipe(videoOutput).pipe(output.video[0]!);
      //    input.audio[0]?.pipe(audioDiscard);
      //  });
      //});

      return new Promise((res, rej) => {
        transformer
          .transformIntoURL({ directives: srcURL.searchParams })
          .then((url) => {
            res(
              dataToEsm(url, {
                namedExports: true, //pluginOptions.namedExports ?? viteConfig.json?.namedExports ?? true,
                compact: true, //!!viteConfig.build.minify,
                preferConst: true,
              }),
            );
          })
          .catch((e) => rej(e));
      });
    },
  };
}
