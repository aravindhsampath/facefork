// Motion specs -> files. MP4 goes through WebCodecs + Mediabunny (portable H.264, faster than
// real time). GIF goes through gifenc. MediaRecorder is deliberately not used: it records WebM on
// Chrome and MP4 on Safari, so the file format would depend on who exported it.

import { Output, Mp4OutputFormat, BufferTarget, CanvasSource, QUALITY_HIGH, getFirstEncodableVideoCodec } from 'mediabunny';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { render } from './scene.js';

const sceneAt = (spec, time) => ({ w: spec.w, h: spec.h, bg: spec.bg, ops: spec.frame(time) });
const breathe = () => new Promise((r) => setTimeout(r, 0));

export const canEncodeVideo = () => typeof VideoEncoder !== 'undefined';

export async function encodeMp4(spec, { scale = 1, onProgress, signal } = {}) {
  if (!canEncodeVideo()) throw new Error('This browser has no WebCodecs support — export a GIF instead.');
  const w = Math.round(spec.w * scale) & ~1; // H.264 needs even dimensions
  const h = Math.round(spec.h * scale) & ~1;
  const codec = await getFirstEncodableVideoCodec(['avc', 'hevc', 'vp9', 'av1'], { width: w, height: h });
  if (!codec) throw new Error('No video codec available in this browser — export a GIF instead.');

  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const octx = out.getContext('2d');
  const frameCanvas = document.createElement('canvas');

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  // H.264 is pinned to Baseline 4.2: WebKit's VideoEncoder reports Main/High as supported but never
  // emits a chunk for them (flush hangs forever). Baseline encodes everywhere; the bitrate covers it.
  const source = new CanvasSource(out, { codec, quality: QUALITY_HIGH, ...(codec === 'avc' && { fullCodecString: 'avc1.42002A' }) });
  output.addVideoTrack(source, { frameRate: spec.fps });
  await output.start();

  const total = Math.max(1, Math.round(spec.duration * spec.fps));
  try {
    for (let i = 0; i < total; i++) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      const time = i / spec.fps;
      render(sceneAt(spec, time), scale, frameCanvas);
      octx.clearRect(0, 0, w, h);
      octx.drawImage(frameCanvas, 0, 0, w, h);
      await source.add(time, 1 / spec.fps);
      onProgress?.((i + 1) / total);
    }
    await output.finalize();
  } catch (e) {
    await output.cancel().catch(() => {});
    throw e;
  }
  return new Blob([output.target.buffer], { type: 'video/mp4' });
}

export async function encodeGif(spec, { width = 400, fps = 12, onProgress, signal } = {}) {
  const scale = width / spec.w;
  const w = Math.round(spec.w * scale), h = Math.round(spec.h * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const gif = GIFEncoder();
  const total = Math.max(1, Math.round(spec.duration * fps));
  for (let i = 0; i < total; i++) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    render(sceneAt(spec, i / fps), scale, canvas);
    const { data } = ctx.getImageData(0, 0, w, h);
    const palette = quantize(data, 256, { format: 'rgb565' });
    gif.writeFrame(applyPalette(data, palette, 'rgb565'), w, h, { palette, delay: Math.round(1000 / fps) });
    onProgress?.((i + 1) / total);
    if (i % 4 === 3) await breathe();
  }
  gif.finish();
  return new Blob([gif.bytes()], { type: 'image/gif' });
}
