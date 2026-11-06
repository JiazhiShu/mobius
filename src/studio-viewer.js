import * as THREE from 'three';
import {OrbitControls} from '../vendor/three/OrbitControls.js';

export const COLORS = {known: 0x3275d1, generated: 0xe9823f, comparisonC: 0x8b5cf6, source: 0x7d8c9c};
const COMPARISON_COLORS = [COLORS.known, COLORS.generated, COLORS.comparisonC];
// A page may set window.MOBIUS_VIEWER_THEME before this module loads. Defaults preserve the light stage.
const THEME = {
  background: '#f3f6f9', exposure: 1.25, hemisphere: [0xffffff, 0x8895a4, 2.6], key: [0xfff8ed, 3], fill: [0xd3e3ff, 2], back: null,
  floor: 0xf1f4f7, floorUnlit: false, floorOpacity: 1, grid: {size: 40, divisions: 80, center: 0xdce3eb, lines: 0xe7edf3, opacity: .65},
  fog: false, rim: 0, reflection: false, ...globalThis.MOBIUS_VIEWER_THEME,
};
function addRimLight(material) {
  if (!THEME.rim) return;
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      totalEmissiveRadiance += diffuseColor.rgb * pow(1. - saturate(dot(normalize(vViewPosition), normal)), 3.) * ${THEME.rim.toFixed(3)};`);
  };
}

/** Owns graphics only. All tracks share a clock (seconds) and a camera. */
export class MotionViewer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({canvas, antialias: true, alpha: false, preserveDrawingBuffer: true});
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = THEME.exposure;
    this.camera = new THREE.PerspectiveCamera(36, 1, .01, 500);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * .49;
    this.controls.minDistance = .5;
    this.tracks = []; this.mode = 'single'; this.ghosts = []; this.mask = null;
    this.maskColors = {known: COLORS.known, generated: COLORS.generated};
    this.onlyKnown = false; this.seconds = 0; this.preset = 'perspective';
    this.scenes = [this.makeScene(), this.makeScene()];
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement);
    this.resize();
  }
  makeScene() {
    const scene = new THREE.Scene(); scene.background = new THREE.Color(THEME.background);
    if (THEME.fog) scene.fog = new THREE.Fog(THEME.background, 10, 40);
    scene.add(new THREE.HemisphereLight(...THEME.hemisphere));
    const key = new THREE.DirectionalLight(...THEME.key); key.position.set(3, 7, 5); scene.add(key);
    const fill = new THREE.DirectionalLight(...THEME.fill); fill.position.set(-4, 3, -3); scene.add(fill);
    if (THEME.back) { const back = new THREE.DirectionalLight(...THEME.back); back.position.set(2, 3, -6); scene.add(back); }
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), THEME.floorUnlit
      ? new THREE.MeshBasicMaterial({color: THEME.floor, transparent: THEME.floorOpacity < 1, opacity: THEME.floorOpacity})
      : new THREE.MeshStandardMaterial({color: THEME.floor, roughness: 1, transparent: THEME.floorOpacity < 1, opacity: THEME.floorOpacity}));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -.008; floor.renderOrder = -1; scene.add(floor);
    const grid = new THREE.GridHelper(THEME.grid.size, THEME.grid.divisions, THEME.grid.center, THEME.grid.lines); grid.position.y = -.005;
    grid.material.transparent = true; grid.material.opacity = THEME.grid.opacity; scene.add(grid);
    return scene;
  }
  resize() {
    const {width, height} = this.canvas.parentElement.getBoundingClientRect();
    this.width = Math.max(1, width); this.height = Math.max(1, height);
    this.renderer.setSize(this.width, this.height, false);
  }
  clearTracks() {
    this.clearGhosts();
    for (const track of this.tracks) { track.mesh.removeFromParent(); track.mesh.geometry.dispose(); track.mesh.material.dispose(); }
    this.tracks = [];
  }
  setTracks(motions, mode = 'single') {
    const previousMode = this.mode;
    this.clearTracks(); this.mode = mode; this.mask = null; this.onlyKnown = false;
    const lower = [Infinity, Infinity, Infinity], upper = [-Infinity, -Infinity, -Infinity];
    for (const motion of motions.filter(Boolean)) {
      for (let axis = 0; axis < 3; axis++) {
        lower[axis] = Math.min(lower[axis], motion.meta.offset[axis]);
        upper[axis] = Math.max(upper[axis], motion.meta.offset[axis] + 65535 * motion.meta.scale[axis]);
      }
    }
    this.origin = new THREE.Vector3((lower[0] + upper[0]) / 2, lower[1], (lower[2] + upper[2]) / 2);
    this.span = Math.max(upper[0] - lower[0], upper[2] - lower[2], (upper[1] - lower[1]) * 1.15, 2.4);
    this.subjectHeight = upper[1] - lower[1];
    motions.forEach((motion, index) => {
      if (!motion) return;
      const geometry = new THREE.BufferGeometry();
      geometry.setIndex(new THREE.BufferAttribute(motion.faces, 1));
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(motion.meta.verticesPerFrame * 3), 3).setUsage(THREE.DynamicDrawUsage));
      const material = new THREE.MeshStandardMaterial({color: index === 0 && mode !== 'single' ? COLORS.source : COLORS.known, roughness: .7, metalness: .03});
      addRimLight(material);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(this.origin).multiplyScalar(-1); mesh.frustumCulled = false;
      this.scenes[index && mode === 'split' ? 1 : 0].add(mesh);
      const track = {motion, mesh, index, frame: -1};
      if (THEME.reflection) {
        // A mirrored child seen through the translucent floor; it shares geometry, material, and visibility.
        track.reflection = new THREE.Mesh(geometry, material);
        track.reflection.scale.y = -1; track.reflection.frustumCulled = false;
        mesh.add(track.reflection);
      }
      this.tracks.push(track);
    });
    this.setMode(mode); this.setView(this.preset); this.setTime(0);
    if (mode === 'comparison') {
      this.setSeparation(3);
      if (previousMode !== 'comparison') this.setView('front');
    }
  }
  setMode(mode) {
    this.mode = mode;
    for (const track of this.tracks) {
      this.scenes[track.index && mode === 'split' ? 1 : 0].add(track.mesh);
      const transparent = mode === 'overlay' && track.index === 0;
      track.mesh.material.transparent = transparent; track.mesh.material.opacity = transparent ? .25 : 1;
      track.mesh.material.depthWrite = !transparent;
      track.mesh.material.color.setHex(mode === 'comparison' ? COMPARISON_COLORS[track.index % COMPARISON_COLORS.length] : track.index === 0 && mode !== 'single' ? COLORS.source : track.index ? COLORS.generated : COLORS.known);
    }
    this.setView(this.preset);
  }
  setTrackColors(colors) {
    for (const track of this.tracks) if (colors[track.index]) track.mesh.material.color.set(colors[track.index]);
  }
  setSeparation(gap) {
    if (this.mode !== 'comparison' || !this.tracks.length) return;
    this.separation = gap;
    const floor = Math.min(...this.tracks.map(track => track.motion.meta.offset[1]));
    const visible = this.tracks.filter(track => track.enabled !== false);
    for (const track of this.tracks) {
      if (!track.startCenter) {
        const first = track.motion.decode(0, new Float32Array(track.motion.meta.verticesPerFrame * 3));
        const box = new THREE.Box3().setFromArray(first);
        track.startCenter = box.getCenter(new THREE.Vector3());
      }
      // A single translation of the whole clip: retain every subsequent displacement.
      const visibleIndex = visible.indexOf(track);
      const positionIndex = visibleIndex < 0 ? 0 : visibleIndex - (visible.length - 1) / 2;
      track.mesh.position.set(positionIndex * gap - track.startCenter.x, -floor, -track.startCenter.z);
    }
    this.updateComparisonBounds();
    for (const ghost of this.ghosts) {
      const track = this.tracks.find(item => item.index === ghost.userData.trackIndex);
      if (track) ghost.position.copy(track.mesh.position);
    }
    this.setView(this.preset);
  }
  updateComparisonBounds() {
    const lower = new THREE.Vector3(Infinity, Infinity, Infinity), upper = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    for (const track of this.tracks.filter(track => track.enabled !== false)) {
      const {offset, scale} = track.motion.meta;
      lower.min(new THREE.Vector3(...offset).add(track.mesh.position));
      upper.max(new THREE.Vector3(...offset.map((value, axis) => value + 65535 * scale[axis])).add(track.mesh.position));
    }
    this.comparisonTarget = lower.clone().add(upper).multiplyScalar(.5);
    this.comparisonTarget.y = (upper.y - lower.y) * .43;
    this.span = Math.max(upper.x - lower.x, upper.z - lower.z, (upper.y - lower.y) * 1.15, 2.4);
    this.subjectHeight = upper.y - lower.y;
  }
  setTrackVisible(index, visible) {
    const track = this.tracks.find(item => item.index === index);
    if (!track) return;
    track.enabled = visible;
    if (this.mode === 'comparison') this.setSeparation(this.separation ?? 3);
    this.setTime(this.seconds);
    for (const ghost of this.ghosts) if (ghost.userData.trackIndex === index) ghost.visible = visible;
    if (this.mode === 'comparison' && this.tracks.some(item => item.enabled !== false)) {
      this.updateComparisonBounds();
      this.setView(this.preset);
    }
  }
  setView(preset = 'perspective') {
    this.preset = preset;
    const aspect = (this.width / (this.mode === 'split' ? 2 : 1)) / this.height;
    const distance = (this.span || 3) * 1.35 / Math.min(1, aspect);
    const target = this.mode === 'comparison' && this.comparisonTarget ? this.comparisonTarget.clone() : new THREE.Vector3(0, (this.subjectHeight || 2) * .43, 0);
    const direction = preset === 'front' ? new THREE.Vector3(0, .12, 1) : preset === 'side' ? new THREE.Vector3(1, .12, 0) : new THREE.Vector3(1.05, .5, 1.55);
    this.camera.position.copy(target).addScaledVector(direction.normalize(), distance);
    this.controls.target.copy(target); this.controls.maxDistance = Math.max(30, distance * 3); this.controls.update();
    if (THEME.fog) for (const scene of this.scenes) { scene.fog.near = distance * 1.2; scene.fog.far = distance * 3.2; }
  }
  setMask(mask, onlyKnown = false, colors = null) {
    this.mask = mask; this.onlyKnown = onlyKnown;
    this.maskColors = colors ?? {known: COLORS.known, generated: COLORS.generated};
    this.setTime(this.seconds);
  }
  setTime(seconds) {
    this.seconds = seconds;
    for (const track of this.tracks) {
      const frame = Math.min(track.motion.meta.frames - 1, Math.max(0, Math.round(seconds * track.motion.meta.fps)));
      if (frame !== track.frame) {
        const position = track.mesh.geometry.attributes.position;
        track.motion.decode(frame, position.array); position.needsUpdate = true;
        track.mesh.geometry.computeVertexNormals(); track.frame = frame;
      }
      const known = this.mask?.[frame] ?? true;
      track.mesh.visible = track.enabled !== false && (!this.onlyKnown || known);
      if (this.mask) track.mesh.material.color.setHex(known ? this.maskColors.known : this.maskColors.generated);
    }
  }
  clearGhosts() {
    for (const mesh of this.ghosts) { mesh.removeFromParent(); mesh.geometry.dispose(); mesh.material.dispose(); }
    this.ghosts = [];
  }
  setGhosts(enabled) {
    this.clearGhosts(); if (!enabled || !this.tracks.length) return;
    for (const track of this.mode === 'comparison' ? this.tracks : [this.tracks[0]]) {
    const {motion} = track;
    const candidates = this.mask ? this.mask.flatMap((known, i) => known ? [i] : []) : Array.from({length: motion.meta.frames}, (_, i) => i);
    if (!candidates.length) return;
    const frames = [...new Set(Array.from({length: Math.min(5, candidates.length)}, (_, i) => candidates[Math.round(i * (candidates.length - 1) / Math.max(1, Math.min(5, candidates.length) - 1))]))];
    for (const frame of frames) {
      const geometry = new THREE.BufferGeometry(); geometry.setIndex(new THREE.BufferAttribute(motion.faces, 1));
      geometry.setAttribute('position', new THREE.BufferAttribute(motion.decode(frame, new Float32Array(motion.meta.verticesPerFrame * 3)), 3));
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({color: track.mesh.material.color, roughness: .9, transparent: true, opacity: .13, depthWrite: false}));
      mesh.position.copy(track.mesh.position); mesh.userData.trackIndex = track.index; this.scenes[0].add(mesh); this.ghosts.push(mesh);
    }
    }
  }
  setKeyframeAnchors(mask) {
    this.clearGhosts();
    if (!mask || !this.tracks.length) return;
    const frames = mask.flatMap((known, frame) => known ? [frame] : []);
    for (const track of this.tracks) {
      for (const frame of frames) {
        if (frame >= track.motion.meta.frames) continue;
        const geometry = new THREE.BufferGeometry();
        geometry.setIndex(new THREE.BufferAttribute(track.motion.faces, 1));
        geometry.setAttribute('position', new THREE.BufferAttribute(
          track.motion.decode(frame, new Float32Array(track.motion.meta.verticesPerFrame * 3)), 3));
        geometry.computeVertexNormals();
        const material = new THREE.MeshStandardMaterial({
          color: COLORS.generated, roughness: .9, transparent: true, opacity: .18, depthWrite: false,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.copy(track.mesh.position); mesh.userData.trackIndex = track.index;
        this.scenes[track.index && this.mode === 'split' ? 1 : 0].add(mesh);
        this.ghosts.push(mesh);
      }
    }
  }
  render() {
    this.controls.update();
    for (const track of this.tracks) if (track.reflection) track.reflection.position.y = -2 * track.mesh.position.y;
    const split = this.mode === 'split', count = split ? 2 : 1, width = this.width / count;
    this.renderer.setScissorTest(true);
    this.camera.aspect = width / this.height; this.camera.updateProjectionMatrix();
    for (let index = 0; index < count; index++) {
      this.renderer.setViewport(index * width, 0, width, this.height);
      this.renderer.setScissor(index * width, 0, width, this.height);
      this.renderer.render(this.scenes[index], this.camera);
    }
    this.renderer.setScissorTest(false);
  }
  dispose() {
    this.resizeObserver.disconnect(); this.controls.dispose(); this.clearTracks();
    for (const scene of this.scenes) scene.traverse(object => { object.geometry?.dispose(); if (object.material) object.material.dispose(); });
    this.renderer.dispose();
  }
}
