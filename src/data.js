/** Transport-neutral data adapter. A catalog may later come from an API. */
const cache = new Map();
async function fetchOK(url) {
  const response = await fetch(url);
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.error || `Asset could not be loaded (${response.status}).`);
  }
  return response;
}
export async function loadCatalog() {
  const catalog = await (await fetchOK(new URL('../assets/catalog.json?v=20261009-hy', import.meta.url))).json();
  if (catalog.version !== 1 || !Array.isArray(catalog.samples) || !catalog.samples.length)
    throw new Error('The sample catalog is empty or unsupported.');
  return catalog;
}
export async function loadMotion(path) {
  const url = new URL(path, document.baseURI).href;
  if (cache.has(url)) {
    const value = cache.get(url); cache.delete(url); cache.set(url, value); return value;
  }
  const promise = (async () => {
    const meta = await (await fetchOK(url)).json();
    if (meta.version !== 1 || meta.encoding !== 'uint16-le' || meta.upAxis !== 'Y' || meta.units !== 'meters')
      throw new Error('Unsupported motion format. Expected quantized, Y-up mesh data in meters.');
    for (const key of ['frames', 'verticesPerFrame', 'faceCount'])
      if (!Number.isSafeInteger(meta[key]) || meta[key] < 1) throw new Error(`Invalid ${key}.`);
    if (!Number.isFinite(meta.fps) || meta.fps <= 0) throw new Error('Invalid frame rate.');
    for (const key of ['offset', 'scale'])
      if (!Array.isArray(meta[key]) || meta[key].length !== 3 || !meta[key].every(Number.isFinite)) throw new Error(`Invalid ${key}.`);
    if (meta.scale.some(x => x <= 0)) throw new Error('Invalid vertex scale.');
    const buffers = await Promise.all([meta.vertices, meta.faces].map(async file =>
      (await fetchOK(new URL(file, url))).arrayBuffer()));
    if (buffers[0].byteLength !== meta.frames * meta.verticesPerFrame * 6 || buffers[1].byteLength !== meta.faceCount * 6)
      throw new Error('Motion asset is incomplete. Please export it again.');
    const packed = new Uint16Array(buffers[0]), faces = new Uint16Array(buffers[1]);
    if (faces.some(index => index >= meta.verticesPerFrame)) throw new Error('Invalid mesh topology.');
    const motion = {meta, packed, faces, duration: (meta.frames - 1) / meta.fps};
    motion.decode = (frame, target) => {
      const f = Math.max(0, Math.min(meta.frames - 1, Math.round(frame)));
      const start = f * meta.verticesPerFrame * 3;
      for (let i = 0; i < target.length; i++) target[i] = packed[start + i] * meta.scale[i % 3] + meta.offset[i % 3];
      return target;
    };
    return motion;
  })();
  cache.set(url, promise);
  while (cache.size > 2) cache.delete(cache.keys().next().value);
  try { return await promise; } catch (error) { cache.delete(url); throw error; }
}

export const protocols = {
  continuation: {name: 'Continuation', description: 'Observe the beginning, complete what follows.'},
  prefix: {name: 'Prefix filling', description: 'Observe the ending, complete what came before.'},
  inbetween: {name: 'In-betweening', description: 'Connect an observed beginning and ending.'},
  keyframe: {name: 'Keyframe completion', description: 'Connect a sparse set of observed poses.'},
};
/** Illustration masks are used ONLY when a real result and its mask are absent. */
export function illustrationMask(protocol, frames) {
  const edge = Math.max(1, Math.round(frames * .22));
  const keys = new Set([0, .25, .5, .75, 1].map(x => Math.round(x * (frames - 1))));
  return Array.from({length: frames}, (_, i) => protocol === 'continuation' ? i < edge :
    protocol === 'prefix' ? i >= frames - edge : protocol === 'inbetween' ? i < edge || i >= frames - edge : keys.has(i));
}
export function validateMask(mask, frames) {
  if (!Array.isArray(mask) || mask.length !== frames || !mask.every(x => typeof x === 'boolean'))
    throw new Error('The known-frame mask must contain one boolean per output frame.');
  return mask;
}
export function maskSegments(mask) {
  const segments = [];
  mask.forEach((known, i) => {
    const previous = segments.at(-1);
    if (!previous || previous.known !== known) segments.push({start: i, end: i + 1, known});
    else previous.end = i + 1;
  });
  return segments;
}
