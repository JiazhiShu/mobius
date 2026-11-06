import * as THREE from 'three';
import {loadMotion} from './data.js?v=20261013-paper-copy';

/**
 * Hero: words travel along a Möbius band, dissolve into tokens at the twist, and
 * print out as a real Möbius-generated motion on the far side. The band has one
 * surface, so the loop never ends: language -> motion -> language.
 *
 * u = 0 is the flat front of the band (motion); u = PI is its upright back wall (language).
 */
const RADIUS = 3, HALF_WIDTH = .94, BODY_COUNT = 7, BODY_SCALE = .66, TRAVEL_SECONDS = 15;
const BODY_RANGE = 1.5, OMEGA = 2 * BODY_RANGE / TRAVEL_SECONDS, TAU = Math.PI * 2;
const BLUE = new THREE.Color('#3b86ff'), ORANGE = new THREE.Color('#ff8a3c');

function bandPoint(u, v, target) {
  const half = u / 2, radius = RADIUS + v * Math.cos(half);
  return target.set(radius * Math.sin(u), v * Math.sin(half), radius * Math.cos(u));
}
function bandFrame(u, frame) {
  const half = u / 2;
  frame.tangent.set(Math.cos(u), 0, -Math.sin(u));
  frame.across.set(Math.cos(half) * Math.sin(u), Math.sin(half), Math.cos(half) * Math.cos(u));
  frame.normal.crossVectors(frame.across, frame.tangent).normalize();
  return frame;
}

const bandVertex = /* glsl */`
  varying vec2 vBand;
  void main() {
    vBand = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
  }`;
const bandFragment = /* glsl */`
  #define PI 3.14159265359
  #define TAU 6.28318530718
  uniform float uTime, uRadius, uTextLength, uOmega;
  uniform vec3 uBlue, uOrange;
  uniform sampler2D uText;
  varying vec2 vBand;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
  float hairline(float x, float width) { return 1. - smoothstep(width, width + fwidth(x) * 1.5, abs(x)); }
  void main() {
    float u = vBand.x, v = vBand.y;
    float language = smoothstep(.2, .8, .5 - .5 * cos(u));
    vec3 tint = mix(uBlue, uOrange, language);
    float flow = u - uTime * uOmega;
    float alpha = .05 + .035 * language;
    alpha += hairline(abs(v) - .985, .012) * .8;
    alpha += hairline(fract(v * 3. + .5) - .5, .006) * .1;
    float ticks = hairline(fract(flow * 96. / TAU) - .5, .03);
    alpha += ticks * smoothstep(.8, .92, abs(v)) * .4;

    float twist = exp(-pow((abs(u - PI) - PI / 2.) / .62, 2.));
    vec2 grid = vec2(flow * 84. / TAU, (v * .5 + .5) * 7.);
    vec2 id = vec2(mod(floor(grid.x), 84.), floor(grid.y));
    vec2 cell = fract(grid);
    float box = step(.14, cell.x) * step(cell.x, .86) * step(.16, cell.y) * step(cell.y, .84);
    float token = box * step(.56, hash(id)) * smoothstep(.12, .7, twist);
    alpha += token * (.28 + .5 * hash(id + 7.));

    vec3 color = tint * alpha;
    float window = 1. - smoothstep(.95, 1.6, abs(u - PI));
    if (window > 0. && abs(v) < .66) {
      float glyph = texture2D(uText, vec2(-flow * uRadius / uTextLength, v / .66 * .5 + .5)).r;
      color += mix(vec3(1., .95, .88), uOrange, .22) * glyph * window * 1.08;
    }
    gl_FragColor = vec4(color, 1.);
    #include <colorspace_fragment>
  }`;

function bandGeometry(segments = 720) {
  const positions = [], uvs = [], indices = [], point = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    const u = i / segments * TAU;
    for (const v of [-1, 1]) {
      bandPoint(u, v * HALF_WIDTH, point);
      positions.push(point.x, point.y, point.z); uvs.push(u, v);
    }
    if (i < segments) { const a = i * 2; indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

function textTexture(text, maxSize) {
  const width = Math.min(8192, maxSize), height = width / 25;
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  const label = `${text}  ·  `;
  let size = height * .62;
  context.font = `400 ${size}px PaperSerif, Georgia, serif`;
  size *= Math.min(1, width / context.measureText(label).width);
  context.font = `400 ${size}px PaperSerif, Georgia, serif`;
  const advance = context.measureText(label).width, repeats = Math.floor(width / advance) || 1;
  context.fillStyle = '#000'; context.fillRect(0, 0, width, height);
  context.fillStyle = '#fff'; context.textBaseline = 'middle';
  for (let i = 0; i < repeats; i++) context.fillText(label, (i + .5) * (width / repeats) - advance / 2, height * .54);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping; texture.colorSpace = THREE.NoColorSpace;
  texture.anisotropy = 8; texture.generateMipmaps = true; texture.minFilter = THREE.LinearMipmapLinearFilter;
  return texture;
}

function bodyMaterial() {
  const uniforms = {uMix: {value: 0}, uCut: {value: 0}, uEdge: {value: ORANGE}};
  const material = new THREE.MeshStandardMaterial({color: BLUE, roughness: .5, metalness: .04, side: THREE.DoubleSide});
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `attribute vec3 aPositionNext; attribute vec3 aNormalNext; uniform float uMix; varying float vHeight;\n${shader.vertexShader}`
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = normalize(mix(normal, aNormalNext, uMix));')
      .replace('#include <begin_vertex>', 'vec3 transformed = mix(position, aPositionNext, uMix); vHeight = transformed.y;');
    shader.fragmentShader = `uniform float uCut; uniform vec3 uEdge; varying float vHeight;\n${shader.fragmentShader}`
      .replace('#include <clipping_planes_fragment>', 'if (vHeight > uCut) discard;\n#include <clipping_planes_fragment>')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float edge = smoothstep(.09, 0., uCut - vHeight);
        totalEmissiveRadiance += uEdge * edge * 2.6;
        if (!gl_FrontFacing) totalEmissiveRadiance += uEdge * .55;
        totalEmissiveRadiance += diffuseColor.rgb * pow(1. - saturate(abs(dot(normalize(vViewPosition), normal))), 2.6) * 1.25;`);
  };
  material.customProgramCacheKey = () => 'mobius-hero-body';
  return {material, uniforms};
}

async function buildFrames(motion) {
  const {verticesPerFrame: count, frames} = motion.meta;
  const index = new THREE.BufferAttribute(motion.faces, 1);
  const positions = [], normals = [];
  for (let frame = 0; frame < frames; frame++) {
    const position = new THREE.BufferAttribute(motion.decode(frame, new Float32Array(count * 3)), 3);
    const scratch = new THREE.BufferGeometry(); scratch.setIndex(index); scratch.setAttribute('position', position);
    scratch.computeVertexNormals();
    positions.push(position); normals.push(scratch.getAttribute('normal'));
    if (frame % 8 === 7) await new Promise(requestAnimationFrame);
  }
  return positions.map((position, frame) => {
    const next = Math.min(frame + 1, frames - 1);
    const geometry = new THREE.BufferGeometry(); geometry.setIndex(index);
    geometry.setAttribute('position', position); geometry.setAttribute('normal', normals[frame]);
    geometry.setAttribute('aPositionNext', positions[next]); geometry.setAttribute('aNormalNext', normals[next]);
    return geometry;
  });
}

export async function startHero(canvas) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let renderer;
  try { renderer = new THREE.WebGLRenderer({canvas, antialias: true, alpha: true}); }
  catch { document.documentElement.classList.add('no-webgl'); return; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;

  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(30, 1, .1, 100);
  scene.add(new THREE.HemisphereLight(0xa9c1ff, 0x10131c, 1));
  const key = new THREE.DirectionalLight(0xffffff, 2.3); key.position.set(-2, 5, 7); scene.add(key);
  const warm = new THREE.DirectionalLight(0xff9a5c, 2.6); warm.position.set(5, 2, -5); scene.add(warm);

  await document.fonts.load('400 40px PaperSerif').catch(() => {});
  const meta = await fetch(new URL('../assets/hero-motion.json', import.meta.url)).then(response => response.json()).catch(() => null);
  const uniforms = {
    uTime: {value: 0}, uRadius: {value: RADIUS}, uOmega: {value: OMEGA}, uBlue: {value: BLUE}, uOrange: {value: ORANGE},
    uText: {value: textTexture(meta?.prompt ?? '', renderer.capabilities.maxTextureSize)},
    uTextLength: {value: 25 * (HALF_WIDTH * 2 * .66)},
  };
  scene.add(new THREE.Mesh(bandGeometry(), new THREE.ShaderMaterial({
    vertexShader: bandVertex, fragmentShader: bandFragment, uniforms, side: THREE.DoubleSide,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  })));

  const bodies = Array.from({length: BODY_COUNT}, (_, index) => {
    const {material, uniforms: shared} = bodyMaterial();
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    mesh.matrixAutoUpdate = false; mesh.frustumCulled = false; mesh.visible = false; scene.add(mesh);
    return {mesh, shared, offset: index / BODY_COUNT};
  });
  let frames = null;
  loadMotion('./assets/hero-motion.json').then(buildFrames).then(result => { frames = result; }).catch(() => {});

  const frame = {tangent: new THREE.Vector3(), across: new THREE.Vector3(), normal: new THREE.Vector3()};
  const point = new THREE.Vector3(), forward = new THREE.Vector3(), side = new THREE.Vector3(), facing = new THREE.Vector3();
  function placeBody(body, phase) {
    const u = (phase * 2 - 1) * BODY_RANGE;
    bandFrame(u, frame); bandPoint(u, 0, point);
    facing.crossVectors(frame.tangent, frame.normal);
    forward.copy(frame.tangent).multiplyScalar(.56).addScaledVector(facing, .83).normalize();
    side.crossVectors(frame.normal, forward);
    body.mesh.matrix.makeBasis(side, frame.normal, forward).scale(new THREE.Vector3(BODY_SCALE, BODY_SCALE, BODY_SCALE)).setPosition(point);
    const clip = phase * (frames.length - 1), lower = Math.min(frames.length - 2, Math.floor(clip));
    body.mesh.geometry = frames[lower]; body.shared.uMix.value = clip - lower;
    const presence = THREE.MathUtils.smoothstep(phase, 0, .15) * (1 - THREE.MathUtils.smoothstep(phase, .85, 1));
    body.shared.uCut.value = presence * 3 - .02;
    body.mesh.visible = presence > .005;
  }

  let width = 0, height = 0, pointerX = 0, pointerY = 0, cameraX = 0, cameraY = 0;
  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width); height = Math.max(1, rect.height);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    const narrow = width <= 1180;
    camera.fov = narrow ? Math.max(30, 31 * 390 / Math.min(width, 700) * (height / width > 1 ? 1.02 : .9)) : 30;
    if (narrow) camera.setViewOffset(width, height, 0, height * .03, width, height);
    else camera.setViewOffset(width, height, -width * .2, -height * .05, width, height);
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas); resize();
  addEventListener('pointermove', event => {
    pointerX = event.clientX / innerWidth - .5; pointerY = event.clientY / innerHeight - .5;
  }, {passive: true});

  // A fixed start offset opens on an already populated band rather than an empty one.
  let clock = TRAVEL_SECONDS * 3.3, last = performance.now(), onScreen = true, animation = 0;
  const shouldRun = () => onScreen && !document.hidden;
  function draw(now) {
    const elapsed = Math.min((now - last) / 1000, .1); last = now;
    if (!reduced) clock += elapsed;
    uniforms.uTime.value = clock;
    cameraX += (pointerX - cameraX) * .04; cameraY += (pointerY - cameraY) * .04;
    camera.position.set(cameraX * 1.5, 3.2 - cameraY * .7, 14.6);
    camera.lookAt(0, .32, 0);
    for (const body of bodies) {
      if (!frames) { body.mesh.visible = false; continue; }
      placeBody(body, (clock / TRAVEL_SECONDS + body.offset) % 1);
    }
    renderer.render(scene, camera);
    animation = shouldRun() && !reduced ? requestAnimationFrame(draw) : 0;
  }
  function resume() { if (!animation && shouldRun()) { last = performance.now(); animation = requestAnimationFrame(draw); } }
  new IntersectionObserver(([entry]) => { onScreen = entry.isIntersecting; resume(); }, {threshold: 0}).observe(canvas);
  document.addEventListener('visibilitychange', resume);
  if (reduced) {
    const redraw = setInterval(() => { if (frames) { clearInterval(redraw); resume(); } }, 200);
  }
  resume();
}
