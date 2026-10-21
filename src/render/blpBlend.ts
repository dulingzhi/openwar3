import { BlpImage } from "mdx-m3-viewer/dist/cjs/parsers/blp/image";
import { encodeBlp } from "../assets/blpEncode";

// `EXBlendButtonIcon`'s pixel operation, lifted out of mapViewer so it can be tested without a
// scene. The formula is the original's, line for line (yd_jass_api/DisableButtonBlp.cpp:101-109):
//
//   R = ((255 - A.alpha) * B.R + A.alpha * A.R) / 255      (same for G, B)
//   alpha = 255 - (255 - A.alpha) * (255 - B.alpha) / 255
//
// which is A OVER B, with the two icon rows required to be 64x64 (kBlpSize) as there.

export const BLEND_SIZE = 64;

export function blendButtonBlp(inputA: Uint8Array, inputB: Uint8Array): Uint8Array | null {
  let a: ImageData, b: ImageData;
  try {
    const pa = new BlpImage(); pa.load(inputA.slice()); a = pa.getMipmap(0);
    const pb = new BlpImage(); pb.load(inputB.slice()); b = pb.getMipmap(0);
  } catch {
    return null;
  }
  if (a.width !== BLEND_SIZE || a.height !== BLEND_SIZE || b.width !== BLEND_SIZE || b.height !== BLEND_SIZE) {
    return null;
  }
  const data = new Uint8Array(BLEND_SIZE * BLEND_SIZE * 4);
  for (let i = 0; i < BLEND_SIZE * BLEND_SIZE; i++) {
    const o = i * 4;
    const aa = a.data[o + 3], ba = b.data[o + 3];
    data[o] = (((255 - aa) * b.data[o] + aa * a.data[o]) / 255) | 0;
    data[o + 1] = (((255 - aa) * b.data[o + 1] + aa * a.data[o + 1]) / 255) | 0;
    data[o + 2] = (((255 - aa) * b.data[o + 2] + aa * a.data[o + 2]) / 255) | 0;
    data[o + 3] = (255 - ((255 - aa) * (255 - ba)) / 255) | 0;
  }
  return encodeBlp({ width: BLEND_SIZE, height: BLEND_SIZE, data });
}
