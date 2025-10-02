# vite-videotools

Easily import video assets in your vite project and use custom transforms to generate different sizes, formats and quality levels on the fly.

**Work In Progress**
This plugin is still under active development. in its current state, there is not much documentation 
and it is very much *not* configurable. I am using it on my sveltekit website so current config is 
outputting all optimized video assets into `/static/@videotools/` directory.

## Features

- [ ] Import Videos
  - [ ] Url
  - [ ] Metadata
  - [ ] srcset
  - [ ] Video

- [ ] Video Transforms
  - [ ] Format
    - [x] webp
    - [ ] mp4
  - [x] Width / Height
  - [ ] Codec 
  - [x] FrameRate
  - [x] BitRate

### Advanced

- [ ] Cloudflare R2 storage (https://www.cloudflare.com/developer-platform/products/r2/)
- [ ] Vercel blobs storage

## FAQ

<details>
<summary>Is it framework agnostic?</summary>
Yes. I am using it mainly with Svelte, but it is a generic vite plugin, so if you're using vite you 
can use it.
</details>

<details>
<summary>Where to store videos?</summary>
If you have larger videos, even with transformations, you should probably not store them in your git 
repo. TOOD: explain cofiguring custom out path and setting up external host / adapter.
</details>

## How to use

1. Install the package using your package manager of choice.
```bash
bun i vite-videotools
```

2. Update your vite config.
```typescript
/// vite.config.ts
import { videotools } from "vite-videotools";

export default defineConfig({
  plugins: [
    ...,
    videotools(), // <- Add this before other plugins like frameworks
    sveltekit(),
  ],
});
```

3. Import video files in your frameworks components / any TS files. (I am using Svelte just as an example)
```svelte
<script lang="ts">
</script>

<video src={video} muted autoplay />
```

4. Whener running `vite dev/build` or the dev server / build of you framework of choice, it will 
optimize the imported assets using ffmpeg and server them from disk later on.

## Building

```bash
bun install
bun run build
```


## License

MIT
