import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { VignetteShader } from 'three/addons/shaders/VignetteShader.js';

THREE.BufferGeometry.prototype.ni = function () { return this.index ? this.toNonIndexed() : this; };
const DATA = JSON.parse(document.getElementById('model').textContent);
const stage = document.getElementById('stage');
const labelsEl = document.getElementById('labels');
const hint = document.getElementById('hint');
const chip = document.getElementById('floorchip');
const UFZ = 4.45;
const CX = 8.42, CZ = -12.93;
const P = (x, y, z) => new THREE.Vector3(x, z, -y);          // plan (x, y, height) -> three.js
const D2R = Math.PI / 180;

// ------------------------------------------------------------------ seeded random
let seed = 20100;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

// ------------------------------------------------------------------ procedural textures
function cv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function valueNoise(size, cells) {
  const g = new Float32Array(cells * cells); for (let i = 0; i < g.length; i++) g[i] = rnd();
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const fx = x / size * cells, fy = y / size * cells, ix = Math.floor(fx), iy = Math.floor(fy);
    let tx = fx - ix, ty = fy - iy; tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
    const a = g[(iy % cells) * cells + ix % cells], b = g[(iy % cells) * cells + (ix + 1) % cells];
    const c = g[((iy + 1) % cells) * cells + ix % cells], d = g[((iy + 1) % cells) * cells + (ix + 1) % cells];
    out[y * size + x] = a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  }
  return out;
}
function fbm(size, base, oct, gain = 0.5) {
  const out = new Float32Array(size * size); let amp = 1, tot = 0;
  for (let o = 0; o < oct; o++) { const n = valueNoise(size, base << o); for (let i = 0; i < out.length; i++) out[i] += n[i] * amp; tot += amp; amp *= gain; }
  for (let i = 0; i < out.length; i++) out[i] /= tot; return out;
}
function paint(size, fn) {            // fn(x,y,i) -> [r,g,b,a?] 0..255
  const c = cv(size, size), ctx = c.getContext('2d'), im = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x, p = fn(x, y, i); im.data[i * 4] = p[0]; im.data[i * 4 + 1] = p[1]; im.data[i * 4 + 2] = p[2]; im.data[i * 4 + 3] = p[3] ?? 255;
  }
  ctx.putImageData(im, 0, 0); return c;
}
function heightToNormal(h, size, strength) {
  return paint(size, (x, y) => {
    const s = (xx, yy) => h[((yy + size) % size) * size + (xx + size) % size];
    const dx = (s(x + 1, y) - s(x - 1, y)) * strength, dy = (s(x, y + 1) - s(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1);
    return [(-dx / l * 0.5 + 0.5) * 255, (dy / l * 0.5 + 0.5) * 255, (1 / l * 0.5 + 0.5) * 255];
  });
}
const hex = c => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
const mix = (a, b, t) => a + (b - a) * t;
const maxAniso = () => renderer.capabilities.getMaxAnisotropy();
function tex(canvas, tileW, tileH, srgb = true) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / tileW, 1 / (tileH ?? tileW));
  t.anisotropy = Math.min(8, maxAniso()); if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t;
}
function tinted(size, base, n, amp) { const c = hex(base); return paint(size, (x, y, i) => { const k = 1 + (n[i] - 0.5) * amp; return [c[0] * k, c[1] * k, c[2] * k]; }); }

function makeTextures() {
  const T = {};
  // painted plaster
  let n = fbm(256, 4, 5); T.plaster = tex(tinted(256, 0xecebe7, n, 0.05), 2.5); T.plasterN = tex(heightToNormal(fbm(256, 32, 3), 256, 1.2), 0.6, 0.6, false);
  // polished concrete
  n = fbm(512, 3, 6);
  T.concrete = tex(paint(512, (x, y, i) => { const c = hex(0xa3a19b); const k = 0.86 + n[i] * 0.28; const sp = rnd() < 0.004 ? 0.75 : 1; return [c[0] * k * sp, c[1] * k * sp, c[2] * k * sp]; }), 3.2);
  T.concreteR = tex(paint(512, (x, y, i) => { const v = 90 + n[i] * 90; return [v, v, v]; }), 3.2, 3.2, false);
  // charcoal render
  n = fbm(256, 16, 4); T.renderN = tex(heightToNormal(n, 256, 3), 0.8, 0.8, false);
  T.render = tex(tinted(256, 0x2b2c2e, fbm(256, 4, 4), 0.14), 2);
  // oak grain (furniture, battens, doors)
  const grain = (size, base, dark, streak) => { const w = fbm(size, 4, 4); return paint(size, (x, y, i) => {
    const t = Math.sin((y / size * streak + w[i] * 6) * Math.PI) * 0.5 + 0.5; const c1 = hex(base), c2 = hex(dark); const k = Math.pow(t, 4) * 0.55 + (w[i] - 0.5) * 0.25;
    return [mix(c1[0], c2[0], k), mix(c1[1], c2[1], k), mix(c1[2], c2[2], k)]; }); };
  T.oak = tex(grain(512, 0xc9a06f, 0x9c7244, 60), 1.6, 1.6);
  T.oakDark = tex(grain(512, 0x7d5d3f, 0x5c422b, 70), 1.6, 1.6);
  { const size = 256, w = fbm(size, 4, 4), c1 = hex(0xcf9d63), c2 = hex(0xa47143);
    T.batten = tex(paint(size, (x, y, i) => { const t = Math.pow(Math.sin((x / size * 30 + w[i] * 3) * Math.PI) * 0.5 + 0.5, 4) * 0.6 + (w[i] - 0.5) * 0.3; return [mix(c1[0], c2[0], t), mix(c1[1], c2[1], t), mix(c1[2], c2[2], t)]; }), 0.35, 1.6); }
  // oak plank floor: 6 planks per 1.08 m tile, 1.8 m long
  { const size = 1024, w = fbm(size, 6, 4), cols = []; for (let k = 0; k < 12; k++) cols.push(0.88 + rnd() * 0.2);
    const c1 = hex(0xc49a67), c2 = hex(0x9d7147);
    T.planks = tex(paint(size, (x, y, i) => {
      const row = Math.floor(y / size * 6), off = (row * 0.37) % 1, u = (x / size + off) % 1, seg = Math.floor(u * 2);
      const k = cols[(row * 2 + seg) % 12]; const t = Math.pow(Math.sin(((y / size * 6) % 1 * 5 + w[i] * 5) * Math.PI) * 0.5 + 0.5, 3);
      const edge = ((y / size * 6) % 1 < 0.012 || (u * 2) % 1 < 0.004) ? 0.55 : 1;
      return [mix(c1[0], c2[0], t) * k * edge, mix(c1[1], c2[1], t) * k * edge, mix(c1[2], c2[2], t) * k * edge]; }), 3.6, 1.08); }
  // timber decking
  { const size = 512, w = fbm(size, 5, 3); T.deck = tex(paint(size, (x, y, i) => { const b = (y / size * 5) % 1; const e = b < 0.04 ? 0.35 : 1; const k = 0.85 + w[i] * 0.3;
    return [140 * k * e, 104 * k * e, 72 * k * e]; }), 1.2, 0.7); }
  // large-format dark porcelain tile 1200 x 600 (texture covers 2 x 2 tiles)
  { const size = 1024, m = fbm(size, 5, 6), v = []; for (let k = 0; k < 4; k++) v.push(0.93 + rnd() * 0.12);
    T.tile = tex(paint(size, (x, y, i) => { const tx = Math.floor(x / size * 2), ty = Math.floor(y / size * 2);
      const gx = (x / size * 2) % 1, gy = (y / size * 2) % 1; const grout = gx < 0.0025 || gx > 0.9975 || gy < 0.005 || gy > 0.995;
      if (grout) return [34, 35, 37]; const k = v[ty * 2 + tx] * (0.9 + m[i] * 0.2); return [62 * k, 65 * k, 69 * k]; }), 2.4, 1.2);
    T.tileR = tex(paint(size, (x, y, i) => { const gx = (x / size * 2) % 1, gy = (y / size * 2) % 1; const g = gx < 0.004 || gx > 0.996 || gy < 0.008 || gy > 0.992; const r = g ? 240 : 70 + m[i] * 60; return [r, r, r]; }), 2.4, 1.2, false); }
  // fluted marble (texture = 0.40 m wide, 10 flutes)
  { const size = 512, vn = fbm(size, 3, 5); T.marble = tex(paint(size, (x, y, i) => {
      const vein = Math.abs(Math.sin((x / size * 3 + y / size * 1.4 + vn[i] * 4) * Math.PI)); const k = Math.pow(1 - vein, 14);
      return [mix(238, 150, k), mix(236, 150, k), mix(232, 152, k)]; }), 1, 1);
    const hf = new Float32Array(size * size); for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const u = (x / size * 10) % 1; hf[y * size + x] = Math.sqrt(Math.max(0, 1 - Math.pow(u * 2 - 1, 2))); }
    T.flutesN = tex(heightToNormal(hf, size, 6), 1, 1, false); }
  // rattan cane weave (with see-through gaps)
  { const size = 256; T.rattan = tex(paint(size, (x, y) => {
      const a = ((x + y) / size * 16) % 1, b = ((x - y + size) / size * 16) % 1, c = (x / size * 16) % 1;
      const s1 = Math.abs(a - 0.5) < 0.18, s2 = Math.abs(b - 0.5) < 0.18, s3 = Math.abs(c - 0.5) < 0.14;
      if (!(s1 || s2 || s3)) return [0, 0, 0, 0]; const k = s3 ? 0.85 : 1; return [206 * k, 170 * k, 118 * k, 255]; }), 0.12); }
  // fabrics
  { const size = 256, f = fbm(size, 64, 2); T.weaveN = tex(heightToNormal(paint ? (() => { const h = new Float32Array(size * size);
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) h[y * size + x] = (Math.sin(x / size * Math.PI * 96) * Math.sin(y / size * Math.PI * 96)) * 0.3 + f[y * size + x] * 0.7; return h; })() : null, size, 2.5), 0.25, 0.25, false);
    T.boucleN = tex(heightToNormal(fbm(256, 48, 3, 0.7), 256, 5), 0.18, 0.18, false); }
  // sheer curtain: faint vertical threads
  { const size = 256, n2 = fbm(size, 8, 3); T.sheer = tex(paint(size, (x, y, i) => { const v = 238 + Math.sin(x / size * Math.PI * 60) * 5 + n2[i] * 8; return [v, v, v - 3]; }), 0.5, 1); }
  // leaf (alpha)
  { const c = cv(128, 256), ctx = c.getContext('2d'); const g = ctx.createLinearGradient(0, 0, 128, 0);
    g.addColorStop(0, '#2f5a2c'); g.addColorStop(0.5, '#4f8a45'); g.addColorStop(1, '#2c5429'); ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(64, 4); ctx.bezierCurveTo(128, 70, 118, 190, 64, 252); ctx.bezierCurveTo(10, 190, 0, 70, 64, 4); ctx.fill();
    ctx.strokeStyle = 'rgba(200,230,170,.55)'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(64, 10); ctx.lineTo(64, 250); ctx.stroke();
    T.leaf = new THREE.CanvasTexture(c); T.leaf.colorSpace = THREE.SRGBColorSpace; }
  // three original abstract prints (orange, red, blue)
  T.art = [['#f28a3b', '#fdf1e2'], ['#d9412f', '#fbeee6'], ['#4d7fc0', '#eef3f8']].map(([fg, bg], k) => {
    const c = cv(256, 320), ctx = c.getContext('2d'); ctx.fillStyle = '#f7f5f0'; ctx.fillRect(0, 0, 256, 320);
    ctx.fillStyle = fg; ctx.fillRect(28, 28, 200, 264); ctx.fillStyle = bg;
    for (let j = 0; j < 7; j++) { ctx.beginPath(); const x = 60 + rnd() * 136, y = 60 + rnd() * 200, r = 12 + rnd() * 34;
      if (k === 1) { ctx.ellipse(x, y, r, r * 0.6, rnd() * 3, 0, Math.PI * 2); } else if (k === 0) { ctx.arc(x, y, r, 0, Math.PI * 2); } else { ctx.moveTo(x - r, y); ctx.quadraticCurveTo(x, y - r * 1.6, x + r, y); ctx.quadraticCurveTo(x, y + r * 0.4, x - r, y); }
      ctx.fill(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; });
  return T;
}

// ------------------------------------------------------------------ renderer / scene
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95;
stage.prepend(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 400);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

const T = makeTextures();

// sky + ground
const skyMat = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false,
  uniforms: { top: { value: new THREE.Color(0x2f6fd3) }, bot: { value: new THREE.Color(0xbcd5ee) } },
  vertexShader: `varying vec3 p; void main(){p=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  fragmentShader: `uniform vec3 top; uniform vec3 bot; varying vec3 p; void main(){float t=smoothstep(-0.02,0.6,p.y); gl_FragColor=vec4(mix(bot,top,t),1.);}` });
const sky = new THREE.Mesh(new THREE.SphereGeometry(180, 32, 16), skyMat); scene.add(sky);
const groundTex = tex(tinted(512, 0x8e8f8a, fbm(512, 8, 5), 0.25), 6);
const ground = new THREE.Mesh(new THREE.CircleGeometry(120, 64), new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1, envMapIntensity: 0.4 }));
ground.rotation.x = -Math.PI / 2; ground.position.set(CX, -0.205, CZ); ground.receiveShadow = true;
{ const uv = ground.geometry.attributes.uv, pos = ground.geometry.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i), pos.getY(i)); }
scene.add(ground);
const asphalt = tex(tinted(512, 0x4f5153, fbm(512, 32, 3), 0.35), 3);
const road = new THREE.Mesh(new THREE.PlaneGeometry(60, 9), new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.95, envMapIntensity: 0.3 }));
{ const uv = road.geometry.attributes.uv, pos = road.geometry.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i), pos.getY(i)); }
road.visible = false;

// lights
const hemi = new THREE.HemisphereLight(0xdfe8f2, 0x7a7266, 0.35); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1de, 2.8);
sun.position.set(CX + 16, 34, CZ + 34); sun.target.position.set(CX + 6, 0, CZ + 4);
sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 120 });
sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.025; sun.shadow.radius = 3;
scene.add(sun, sun.target);

// ------------------------------------------------------------------ materials
const std = (o) => new THREE.MeshStandardMaterial(Object.assign({ envMapIntensity: 0.7 }, o));
const M = {
  external: std({ color: 0xc4c2bc, map: T.concrete, roughness: 0.92 }),
  charcoal: std({ color: 0xffffff, map: T.render, normalMap: T.renderN, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.88 }),
  internal: std({ color: 0xffffff, map: T.plaster, normalMap: T.plasterN, normalScale: new THREE.Vector2(0.15, 0.15), roughness: 0.93 }),
  concrete_floor: std({ color: 0xffffff, map: T.concrete, roughnessMap: T.concreteR, roughness: 0.55, envMapIntensity: 0.9 }),
  oak_floor: std({ color: 0xffffff, map: T.planks, roughness: 0.55, envMapIntensity: 0.8 }),
  courtyard: std({ color: 0xffffff, map: T.deck, roughness: 0.85 }),
  frame: std({ color: 0x1b1c1e, roughness: 0.42, metalness: 0.5 }),
  glass: new THREE.MeshPhysicalMaterial({ color: 0xb9ccd2, transparent: true, opacity: 0.12, roughness: 0.03, metalness: 0, envMapIntensity: 0.7, depthWrite: false, side: THREE.DoubleSide }),
  door: std({ color: 0xffffff, map: T.oakDark, roughness: 0.55 }),
  structure: std({ color: 0xd0cec8, map: T.concrete, roughness: 0.85 }),
  joinery: std({ color: 0xe9e7e2, roughness: 0.45 }),
  countertop: std({ color: 0xf2f1ee, roughness: 0.22 }),
  metal: std({ color: 0x8e9093, roughness: 0.32, metalness: 0.85 }),
  sanitary: std({ color: 0xfafafa, roughness: 0.12 }),
  ceiling: std({ color: 0xf3f2ef, roughness: 0.95 }),
  roof: std({ color: 0x55585b, roughness: 0.7, metalness: 0.4 }),
  stair: std({ color: 0xffffff, map: T.oakDark, roughness: 0.6 }),
  desk_top: std({ color: 0xffffff, map: T.oak, roughness: 0.5 }),
  desk_frame: std({ color: 0x1c1d1f, roughness: 0.4, metalness: 0.6 }),
  chair: std({ color: 0x3b3f3d, normalMap: T.weaveN, roughness: 0.9 }),
  screen: std({ color: 0x0b0c0e, roughness: 0.18, metalness: 0.3, emissive: 0x101820, emissiveIntensity: 0.6 }),
  fabric: std({ color: 0x3f5a4d, normalMap: T.boucleN, roughness: 0.95 }),
  table_top: std({ color: 0xffffff, map: T.oak, roughness: 0.45 }),
  sofa: std({ color: 0x33493f, normalMap: T.boucleN, roughness: 0.95 }),
  sofa_cushion: std({ color: 0x3e564b, normalMap: T.boucleN, roughness: 0.95 }),
  planter: std({ color: 0x2c2c2d, roughness: 0.55 }),
  shelf: std({ color: 0xffffff, map: T.oak, roughness: 0.5 }),
  joinery_fit: std({ color: 0xebe9e4, roughness: 0.45 }),
  rack: std({ color: 0x21508f, roughness: 0.45, metalness: 0.5 }),
  rack_deck: std({ color: 0xd4741c, roughness: 0.5, metalness: 0.4 }),
  pallet: std({ color: 0xd3b58b, map: T.oak, roughness: 0.9 }),
  carton: std({ color: 0xbd9467, roughness: 0.95 }),
  timber: std({ color: 0xffffff, map: T.deck, roughness: 0.8 }),
  leaf: std({ map: T.leaf, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6 }),
  // entry lounge
  tile: std({ color: 0xffffff, map: T.tile, roughnessMap: T.tileR, roughness: 0.55, envMapIntensity: 1.0 }),
  nook_floor: std({ color: 0xffffff, map: T.planks, roughness: 0.45, envMapIntensity: 0.9 }),
  marble: std({ color: 0xffffff, map: T.marble, normalMap: T.flutesN, normalScale: new THREE.Vector2(1.4, 1.4), roughness: 0.3 }),
  stone_top: std({ color: 0xf1efeb, roughness: 0.2 }),
  batten: std({ color: 0xffffff, map: T.batten, roughness: 0.6 }),
  black_panel: std({ color: 0x1c1d1f, roughness: 0.7 }),
  brass: std({ color: 0xc19a5b, roughness: 0.28, metalness: 1 }),
  steel_black: std({ color: 0x151617, roughness: 0.4, metalness: 0.7 }),
  rattan: std({ color: 0xffffff, map: T.rattan, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.75 }),
  leather_tan: std({ color: 0xa86c3c, roughness: 0.48, side: THREE.DoubleSide }),
  boucle: std({ color: 0xcfd1d0, normalMap: T.boucleN, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 1 }),
  sheer: std({ color: 0xffffff, map: T.sheer, transparent: true, opacity: 0.8, side: THREE.DoubleSide, roughness: 1, emissive: 0xffffff, emissiveIntensity: 0.05, envMapIntensity: 0.45 }),
  led: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffe2b8).multiplyScalar(5) }),
  led_cool: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff6ea).multiplyScalar(6) }),
  exit: new THREE.MeshBasicMaterial({ color: new THREE.Color(0x19c26b).multiplyScalar(2.5) }),
  tv: std({ color: 0x08090a, roughness: 0.12, metalness: 0.2 }),
  white_flower: std({ color: 0xfbf8f4, roughness: 0.6, side: THREE.DoubleSide }),
  ceramic: std({ color: 0xece8e0, roughness: 0.35 }),
  candle: std({ color: 0xf6f1e7, roughness: 0.6, emissive: 0x201810 }),
  pink: std({ color: 0xe7a3b6, roughness: 0.7 }),
};
M.black_ceiling = M.black_panel.clone(); M.black_ceiling.side = THREE.DoubleSide;
M.art = T.art.map(t => std({ map: t, roughness: 0.8 }));

// world-space UV projection (metres) for boxy geometry
function projectUV(geo) {
  const p = geo.attributes.position, n = geo.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u, v; if (ay >= ax && ay >= az) { u = p.getX(i); v = p.getZ(i); } else if (ax >= az) { u = p.getZ(i); v = p.getY(i); } else { u = p.getX(i); v = p.getY(i); }
    uv[i * 2] = u; uv[i * 2 + 1] = v;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); return geo;
}

// ------------------------------------------------------------------ architecture
const floorGroups = { GF: new THREE.Group(), UF: new THREE.Group() };
floorGroups.GF.name = 'Ground floor'; floorGroups.UF.name = 'Upper floor';
scene.add(floorGroups.GF, floorGroups.UF);
const layers = { fitout: [], stair: [], facade: [], roof: [], ceiling: [], curtain: [] };
function addMesh(geo, mat, floor, layer, opts = {}) {
  const m = new THREE.Mesh(geo, mat);
  const glass = mat.transparent && mat !== M.sheer;
  m.castShadow = opts.cast ?? (!glass && layer !== 'ceiling');
  m.receiveShadow = opts.receive ?? !glass;
  if (mat.transparent) m.renderOrder = 2;
  (opts.parent || floorGroups[floor]).add(m);
  if (layers[layer]) layers[layer].push(m);
  return m;
}
for (const g of DATA.groups) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(g.v, 3)); geo.setIndex(g.i);
  const flat = geo.ni(); flat.computeVertexNormals(); projectUV(flat);
  let key = g.mat; if (key === 'slab') key = g.floor === 'UF' ? 'oak_floor' : 'concrete_floor'; if (key === 'glass_door') key = 'glass';
  const home = g.layer === 'stair' ? 'GF' : g.floor;
  if (g.mat === 'slab') {            // split slabs: walkable top gets the floor finish, edges and soffit get facade / ceiling finishes
    const pos = flat.attributes.position.array, nor = flat.attributes.normal.array, top = [], edge = [], under = [];
    for (let t = 0; t < pos.length; t += 9) { const ny = nor[t + 1]; (ny > 0.5 ? top : ny < -0.5 ? under : edge).push(...pos.slice(t, t + 9)); }
    const mk = arr => { const q = new THREE.BufferGeometry(); q.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); q.computeVertexNormals(); return projectUV(q); };
    if (top.length) addMesh(mk(top), M[key], home, g.layer).name = `${g.floor} floor finish`;
    if (edge.length) addMesh(mk(edge), g.floor === 'UF' ? M.charcoal : M.external, home, g.layer).name = `${g.floor} slab edge`;
    if (under.length) addMesh(mk(under), M.ceiling, home, g.layer).name = `${g.floor} slab soffit`;
    continue;
  }
  const mesh = addMesh(flat, M[key] || M.internal, home, g.layer);
  mesh.name = `${g.floor} ${g.layer} ${g.mat}`;
}

// ------------------------------------------------------------------ fit-out primitives (rounded, textured, merged by material)
function leafCluster(cx, cy, cz, r, out, opt = {}) {
  const n = opt.n ?? Math.max(14, Math.min(80, Math.round(46 * (r / 0.4) ** 2)));
  for (let k = 0; k < n; k++) {
    const s = r * (0.55 + rnd() * 0.35), lw = 0.16 * s / 0.4 * (opt.w || 1), lh = 0.42 * s / 0.4 * (opt.h || 1);
    const g = new THREE.PlaneGeometry(lw, lh, 1, 3);
    const pa = g.attributes.position; for (let i = 0; i < pa.count; i++) { const y = pa.getY(i); pa.setZ(i, -Math.pow((y / (lh / 2)) + 1, 2) * 0.07 * lh); }
    g.translate(0, lh / 2, 0); g.computeVertexNormals();
    const th = rnd() * Math.PI * 2, ph = ((opt.up ?? 0.15) + rnd() * (opt.spread ?? 0.75)) * Math.PI / 2;
    const o = new THREE.Object3D(); o.position.copy(P(cx, cy, cz - r * 0.25));
    o.rotation.set(0, th, 0); o.rotateX(-(Math.PI / 2 - ph)); o.rotateZ((rnd() - 0.5) * 0.6); o.updateMatrix();
    g.applyMatrix4(o.matrix); out.push(g.ni());
  }
}
const primBuckets = {};
function bucket(key) { return primBuckets[key] || (primBuckets[key] = []); }
for (const p of DATA.prims) {
  if (p.t === 'b') {
    const w = p.b[0] - p.a[0], h = p.b[2] - p.a[2], d = p.b[1] - p.a[1], mn = Math.min(w, h, d);
    const g = new RoundedBoxGeometry(w, h, d, 2, Math.min(0.018, mn * 0.35));
    g.translate((p.a[0] + p.b[0]) / 2, (p.a[2] + p.b[2]) / 2, -(p.a[1] + p.b[1]) / 2);
    bucket(p.f + '|' + p.m).push(g.ni());
  } else if (p.t === 'c') {
    const h = p.z[1] - p.z[0], seg = p.n < 8 ? p.n : 28;
    const g = new THREE.CylinderGeometry(p.r1, p.r, h, seg, 1, false);
    g.translate(p.c[0], (p.z[0] + p.z[1]) / 2, -p.c[1]);
    bucket(p.f + '|' + p.m).push(g.ni());
  } else if (p.t === 'l') {
    leafCluster(p.c[0], p.c[1], p.c[2], p.r, bucket(p.f + '|leaf'));
  }
}
for (const [key, geos] of Object.entries(primBuckets)) {
  const [floor, mat] = key.split('|');
  const g = mergeGeometries(geos.map(x => { const y = x.clone(); if (!y.attributes.uv) y.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(y.attributes.position.count * 2), 2)); return y; }));
  if (mat !== 'leaf') projectUV(g);
  const m = addMesh(g, M[mat] || M.joinery_fit, floor, 'fitout'); m.name = `${floor} fit-out ${mat}`;
}

// ------------------------------------------------------------------ curtains on all exterior windows
function curtainGeo(len, h) {
  const segs = Math.max(8, Math.round(len / 0.02)), g = new THREE.PlaneGeometry(len, h, segs, 1), pa = g.attributes.position;
  for (let i = 0; i < pa.count; i++) { const x = pa.getX(i); pa.setZ(i, Math.sin((x / 0.16) * Math.PI * 2) * 0.045); }
  g.computeVertexNormals(); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, pa.getX(i), pa.getY(i)); return g;
}
const curtainGroup = { GF: [], UF: [] }, trackGeos = { GF: [], UF: [] };
for (const w0 of DATA.windows) {
  const w = Object.assign({}, w0);
  if (w.f === 'GF' && w.a[0] > 16 && Math.min(w.a[1], w.b[1]) > 5 && Math.max(w.a[1], w.b[1]) < 8.6) continue;   // nook window sits behind the black panelling
  if (w.f === 'GF' && w.a[0] > 16 && Math.max(w.a[1], w.b[1]) < 4) { w.a = [w.a[0], 4.95]; w.b = [w.b[0], 1.8]; }   // one continuous sheer run along the lounge
  const ax = w.a[0], ay = w.a[1], bx = w.b[0], by = w.b[1], mx = (ax + bx) / 2, my = (ay + by) / 2;
  const tx = bx - ax, ty = by - ay, L = Math.hypot(tx, ty); let nx = -ty / L, ny = tx / L;
  if ((8.42 - mx) * nx + (12.9 - my) * ny < 0) { nx = -nx; ny = -ny; }       // point inward
  const off = w.t / 2 + 0.13, base = w.f === 'UF' ? UFZ : 0, top = base + (w.f === 'UF' ? 2.96 : 4.14), bot = base + 0.015;
  const len = L + 0.3, h = top - bot;
  const g = curtainGeo(len, h);
  const ang = Math.atan2(ty / L, tx / L);            // rotate plane x-axis to wall direction in three.js space (x, -y)
  const m = new THREE.Matrix4().makeRotationY(ang).setPosition(mx + nx * off, (top + bot) / 2, -(my + ny * off));
  g.applyMatrix4(m); curtainGroup[w.f].push(g.ni());
  const tr = new THREE.BoxGeometry(len, 0.03, 0.05); tr.applyMatrix4(new THREE.Matrix4().makeRotationY(ang).setPosition(mx + nx * off, top + 0.02, -(my + ny * off)));
  trackGeos[w.f].push(tr.ni());
}
for (const f of ['GF', 'UF']) {
  if (!curtainGroup[f].length) continue;
  addMesh(mergeGeometries(curtainGroup[f]), M.sheer, f, 'curtain', { cast: false, receive: true }).name = `${f} curtains`;
  addMesh(projectUV(mergeGeometries(trackGeos[f])), M.steel_black, f, 'curtain', { cast: false }).name = `${f} curtain tracks`;
}

// ------------------------------------------------------------------ ENTRY LOUNGE (photo reference)
const lounge = new THREE.Group(); lounge.name = 'Entry lounge'; floorGroups.GF.add(lounge);
const C = { x: 16.53, y: 8.9 };                 // arc centre traced from the two curved plan features
const R_IN = 3.30, R_OUT = 3.85, H_BAR = 1.05, SOFFIT = 2.45, CEIL = 4.17;
const arcPt = (r, phi, z = 0) => P(C.x + r * Math.cos(phi), C.y + r * Math.sin(phi), z);
const faceOut = phi => Math.atan2(Math.cos(phi), -Math.sin(phi));  // y-rotation so local +z points radially outward
function L(geo, mat, layer = 'lounge', opts) { return addMesh(geo, mat, 'GF', layer, Object.assign({ parent: lounge }, opts)); }
const shapeGeo = (shape, z) => { const g = new THREE.ShapeGeometry(shape, 48); g.rotateX(-Math.PI / 2); g.translate(0, z, 0); return g; };
const phiWall = r => -Math.PI - Math.asin((8.52 - C.y) / r);
const PHI_WALL = phiWall(R_IN); // angle where inner arc meets the understair wall

// floors: dark porcelain across the foyer, oak inside the nook
{ const s = new THREE.Shape(); s.moveTo(9.97, 1.72); s.lineTo(16.52, 1.72); s.lineTo(16.52, C.y - R_IN);
  s.absarc(C.x, C.y, R_IN, -Math.PI / 2, PHI_WALL, true); s.lineTo(12.72, 8.52); s.lineTo(12.72, 7.2); s.lineTo(9.97, 7.2); s.closePath();
  L(shapeGeo(s, 0.004), M.tile, 'lounge', { cast: false });
  const n = new THREE.Shape(); n.moveTo(16.52, 8.52); n.lineTo(16.52, C.y - R_IN); n.absarc(C.x, C.y, R_IN, -Math.PI / 2, PHI_WALL, true); n.closePath();
  L(shapeGeo(n, 0.006), M.nook_floor, 'lounge', { cast: false }); }

// fluted marble counters with LED lip, stone top and brass foot rail
function counter(phi0, phi1) {
  const len = phi1 - phi0, th0 = phi0 + Math.PI / 2;
  const outer = new THREE.CylinderGeometry(R_OUT, R_OUT, H_BAR - 0.06, Math.ceil(len * 60), 1, true, th0, len);
  outer.translate(C.x, (H_BAR - 0.06) / 2 + 0.04, -C.y);
  { const uv = outer.attributes.uv, al = R_OUT * len; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * al / 0.4, uv.getY(i) * (H_BAR - 0.06) / 0.4); }
  L(outer, M.marble);
  const kick = new THREE.CylinderGeometry(R_OUT - 0.05, R_OUT - 0.05, 0.04, Math.ceil(len * 40), 1, true, th0, len); kick.translate(C.x, 0.02, -C.y); L(kick, M.steel_black);
  const inner = new THREE.CylinderGeometry(R_IN, R_IN, H_BAR, Math.ceil(len * 40), 1, true, th0, len); inner.translate(C.x, H_BAR / 2, -C.y); L(inner, M.black_panel);
  for (const ph of [phi0, phi1]) { const e = new THREE.PlaneGeometry(R_OUT - R_IN, H_BAR); const mid = arcPt((R_IN + R_OUT) / 2, ph, H_BAR / 2);
    e.rotateY(faceOut(ph) + Math.PI / 2); e.translate(mid.x, mid.y, mid.z); L(e, M.marble); }
  const top = new THREE.Shape(); top.absarc(C.x, C.y, R_OUT + 0.06, phi0 - 0.004, phi1 + 0.004, false); top.absarc(C.x, C.y, R_IN - 0.04, phi1 + 0.004, phi0 - 0.004, true);
  const tg = new THREE.ExtrudeGeometry(top, { depth: 0.04, bevelEnabled: false, curveSegments: 64 }); tg.rotateX(-Math.PI / 2); tg.translate(0, H_BAR - 0.02, 0); L(tg, M.stone_top);
  const led = new THREE.CylinderGeometry(R_OUT + 0.035, R_OUT + 0.035, 0.012, Math.ceil(len * 60), 1, true, th0, len); led.translate(C.x, H_BAR - 0.032, -C.y); L(led, M.led, 'lounge', { cast: false });
  const pts = []; for (let k = 0; k <= 40; k++) pts.push(arcPt(R_OUT + 0.2, phi0 + 0.02 + (len - 0.04) * k / 40, 0.2));
  L(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 80, 0.018, 12, false), M.brass);
  const nb = Math.max(2, Math.round(R_OUT * len / 1.1));
  for (let k = 0; k <= nb; k++) { const ph = phi0 + 0.03 + (len - 0.06) * k / nb, a = arcPt(R_OUT, ph, 0.2), b = arcPt(R_OUT + 0.2, ph, 0.2);
    const br = new THREE.CylinderGeometry(0.01, 0.01, a.distanceTo(b), 8); br.rotateX(Math.PI / 2); br.rotateY(faceOut(ph)); br.translate((a.x + b.x) / 2, 0.2, (a.z + b.z) / 2); L(br, M.brass); }
}
const W0 = -172 * D2R, W1 = -137 * D2R, E0 = -113 * D2R, E1 = -90.4 * D2R;
counter(W0, W1); counter(E0, E1);

// bar stools: black steel frame, rattan seat and back
function makeStool(seatMat = M.rattan) {
  const g = new THREE.Group(), seatH = 0.76, s = 0.2, sb = 0.23;
  const add = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = m.receiveShadow = true; g.add(m); return m; };
  const leg = (x0, z0, x1, z1, y1) => { const a = new THREE.Vector3(x0, 0, z0), b = new THREE.Vector3(x1, y1, z1);
    const m = add(new THREE.CylinderGeometry(0.011, 0.011, a.distanceTo(b), 10), M.steel_black); m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()); };
  leg(-sb, -sb, -s, -s, seatH); leg(sb, -sb, s, -s, seatH); leg(-sb, sb, -s, s, 1.12); leg(sb, sb, s, s, 1.12);
  const fr = 0.215; for (const [w, d, x, z] of [[2 * fr, 0.016, 0, -fr], [2 * fr, 0.016, 0, fr], [0.016, 2 * fr, -fr, 0], [0.016, 2 * fr, fr, 0]]) { const m = add(new THREE.BoxGeometry(w, 0.016, d), M.steel_black); m.position.set(x, 0.3, z); }
  add(new RoundedBoxGeometry(0.44, 0.03, 0.42, 2, 0.012), M.steel_black).position.y = seatH;
  add(new RoundedBoxGeometry(0.4, 0.035, 0.38, 2, 0.015), seatMat).position.y = seatH + 0.03;
  const backG = new THREE.CylinderGeometry(0.7, 0.7, 0.22, 16, 1, true, -0.31, 0.62);
  { const uv = backG.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.44 / 0.12, uv.getY(i) * 0.22 / 0.12); }
  add(backG, seatMat).position.set(0, 1.0, -0.49);
  const pts = []; for (let k = 0; k <= 12; k++) { const a = -0.31 + 0.62 * k / 12; pts.push(new THREE.Vector3(0.7 * Math.sin(a), 1.115, 0.7 * Math.cos(a) - 0.49)); }
  add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.011, 8), M.steel_black);
  return g;
}
{ const proto = makeStool(M.leather_tan);
  const place = (phi) => { const s = proto.clone(); const p = arcPt(R_OUT + 0.42, phi, 0); s.position.copy(p); s.rotation.y = faceOut(phi); lounge.add(s); };
  for (const d of [-165, -154.5, -144]) place(d * D2R);
  for (const d of [-107, -98.5]) place(d * D2R); }

// curved timber batten bulkhead (full height at the west end, like the photo)
{ const R_B = 3.62, step = 0.078 / R_B, geos = [], full = -166 * D2R, back0 = [], back1 = [];
  for (let ph = phiWall(R_B) + 0.012; ph <= -90.6 * D2R; ph += step) {
    const isFull = ph < full, z0 = isFull ? 0 : SOFFIT, h = CEIL - z0;
    const b = new THREE.BoxGeometry(0.042, h, 0.05); const p = arcPt(R_B, ph, z0 + h / 2);
    b.rotateY(faceOut(ph)); b.translate(p.x, p.y, p.z); geos.push(b.ni()); }
  const bg = mergeGeometries(geos); projectUV(bg);
  // battens run vertically, so re-map uv to (arc, height)
  L(bg, M.batten, 'lounge');
  const PB = phiWall(R_B - 0.04), th0 = PB + Math.PI / 2, lenB = -90.4 * D2R - PB;
  const bk = new THREE.CylinderGeometry(R_B - 0.04, R_B - 0.04, CEIL - SOFFIT, 96, 1, true, th0, lenB); bk.translate(C.x, (CEIL + SOFFIT) / 2, -C.y); L(bk, M.black_panel);
  const bkf = new THREE.CylinderGeometry(R_B - 0.04, R_B - 0.04, SOFFIT, 24, 1, true, th0, full - PB); bkf.translate(C.x, SOFFIT / 2, -C.y); L(bkf, M.black_panel);
  // soffit over the nook (hidden in overhead views so the nook stays visible)
  const s = new THREE.Shape(); s.moveTo(16.52, 8.52); s.lineTo(16.52, C.y - R_B); s.absarc(C.x, C.y, R_B, -Math.PI / 2, phiWall(R_B), true); s.closePath();
  L(shapeGeo(s, SOFFIT), M.black_ceiling, 'ceiling', { cast: false });
  const spots = []; for (const [x, y] of [[15.4, 7.2], [14.4, 7.8], [15.9, 6.2]]) { const c = new THREE.CylinderGeometry(0.05, 0.05, 0.01, 20); c.translate(x, SOFFIT - 0.006, -y); spots.push(c.ni()); }
  L(mergeGeometries(spots), M.led_cool, 'ceiling', { cast: false });
}

// nook back walls: black panelling, TVs, open shelving, prints, exit sign
{ const box = (x0, y0, z0, x1, y1, z1, mat, layer = 'lounge') => { const g = new RoundedBoxGeometry(x1 - x0, z1 - z0, y1 - y0, 1, 0.004); g.translate((x0 + x1) / 2, (z0 + z1) / 2, -(y0 + y1) / 2); projectUV(g); return L(g, mat, layer); };
  const yb = 8.49, ye = 16.51;
  box(12.84, yb - 0.02, 0, 14.39, yb, SOFFIT, M.black_panel); box(15.14, yb - 0.02, 0, 16.52, yb, SOFFIT, M.black_panel); box(14.39, yb - 0.02, 2.1, 15.14, yb, SOFFIT, M.black_panel);
  box(ye, 5.06, 0, 16.52 + 0.005, 5.83, SOFFIT, M.black_panel); box(ye, 5.83, 0, 16.525, 6.57, 0.3, M.black_panel);
  box(ye, 6.57, 2.1, 16.525, 7.39, SOFFIT, M.black_panel); box(ye, 7.39, 0, 16.525, 8.49, SOFFIT, M.black_panel);
  box(13.05, yb - 0.08, 1.25, 14.05, yb - 0.02, 1.83, M.tv); box(13.08, yb - 0.083, 1.28, 14.02, yb - 0.08, 1.8, M.screen);
  box(ye - 0.07, 7.55, 1.45, ye - 0.01, 8.2, 1.84, M.tv);
  // open shelving boxes with oak frames
  for (let k = 0; k < 3; k++) { const x0 = 12.95 + k * 0.47, x1 = x0 + 0.44;
    box(x0, yb - 0.28, 2.02, x1, yb - 0.02, 2.04, M.shelf); box(x0, yb - 0.28, 2.36, x1, yb - 0.02, 2.38, M.shelf);
    box(x0, yb - 0.28, 2.02, x0 + 0.02, yb - 0.02, 2.38, M.shelf); box(x1 - 0.02, yb - 0.28, 2.02, x1, yb - 0.02, 2.38, M.shelf);
    const v = new THREE.CylinderGeometry(0.045, 0.06, 0.16 + k * 0.03, 16); v.translate(x0 + 0.14, 2.04 + 0.08 + k * 0.015, -(yb - 0.15)); L(v, k === 1 ? M.brass : M.ceramic);
    const b2 = new THREE.SphereGeometry(0.05, 16, 12); b2.translate(x0 + 0.32, 2.09, -(yb - 0.14)); L(b2, M.planter); }
  // three prints on the east panel
  for (let k = 0; k < 3; k++) { const x0 = 15.3 + k * 0.4; box(x0, yb - 0.035, 1.3, x0 + 0.34, yb - 0.02, 1.74, M.steel_black);
    const a = new THREE.PlaneGeometry(0.3, 0.4); a.translate(x0 + 0.17, 1.52, -(yb - 0.037)); L(a, M.art[k]); }
  box(14.62, yb - 0.04, 2.18, 14.92, yb - 0.02, 2.3, M.exit);
  // doors shown closed, finished in black like the panelling
  box(14.43, 8.5, 0.005, 15.1, 8.58, 2.06, M.black_panel); box(14.98, 8.46, 0.95, 15.0, 8.5, 1.15, M.brass);
  box(16.6, 6.61, 0.005, 16.66, 7.35, 2.06, M.black_panel); box(16.6, 3.7, 0.005, 16.66, 4.46, 2.06, M.black_panel);
  // hanging plant strands beside the TV
  const strands = []; leafCluster(12.93, 8.3, 1.9, 0.18, strands); leafCluster(14.25, 8.3, 2.1, 0.16, strands);
  L(mergeGeometries(strands), M.leaf, 'lounge');
  // counter styling: orchid, candles, flowers, fruit bowl
  const deco = (g, m) => L(g, m, 'lounge');
  const top = H_BAR + 0.02;
  { const p = arcPt((R_IN + R_OUT) / 2, -96 * D2R, top); const pot = new THREE.CylinderGeometry(0.07, 0.06, 0.13, 20); pot.translate(p.x, p.y + 0.065, p.z); deco(pot, M.ceramic);
    const fl = []; for (let k = 0; k < 14; k++) { const f = new THREE.CircleGeometry(0.035, 6); f.rotateY(rnd() * 6); f.rotateX(rnd() - 0.5); f.translate(p.x + (rnd() - 0.5) * 0.25, p.y + 0.3 + rnd() * 0.22, p.z + (rnd() - 0.5) * 0.18); fl.push(f.ni()); }
    deco(mergeGeometries(fl), M.white_flower); const lv = []; leafCluster(p.x, -p.z, top + 0.18, 0.12, lv); deco(mergeGeometries(lv), M.leaf); }
  { const p = arcPt((R_IN + R_OUT) / 2, -168 * D2R, top); for (let k = 0; k < 3; k++) { const c = new THREE.CylinderGeometry(0.018, 0.02, 0.14 + k * 0.05, 12); c.translate(p.x + k * 0.05, p.y + 0.07 + k * 0.025, p.z + k * 0.04); deco(c, M.candle); }
    const fl = []; for (let k = 0; k < 10; k++) { const s = new THREE.SphereGeometry(0.03, 8, 6); s.translate(p.x + 0.25 + (rnd() - 0.5) * 0.14, p.y + 0.1 + rnd() * 0.06, p.z - 0.1 + (rnd() - 0.5) * 0.12); fl.push(s.ni()); }
    deco(mergeGeometries(fl), M.pink); }
  { const p = arcPt((R_IN + R_OUT) / 2, -150 * D2R, top); const bowl = new THREE.SphereGeometry(0.15, 24, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2); bowl.scale(1, 0.4, 1); bowl.translate(p.x, p.y + 0.06, p.z); deco(bowl, M.ceramic); }
}

// black ceiling with a circular LED ring pendant over the foyer (walk views)
{ const s = new THREE.Shape(); s.moveTo(9.97, 1.72); s.lineTo(16.52, 1.72); s.lineTo(16.52, 8.52); s.lineTo(9.97, 8.52); s.closePath();
  L(shapeGeo(s, CEIL), M.black_ceiling, 'ceiling', { cast: false, receive: false });
  const ring = new THREE.TorusGeometry(1.15, 0.014, 8, 160); ring.rotateX(Math.PI / 2); ring.translate(12.3, 3.55, -4.3); L(ring, M.led_cool, 'ceiling', { cast: false });
  const wires = []; for (let k = 0; k < 3; k++) { const a = k * Math.PI * 2 / 3; const w = new THREE.CylinderGeometry(0.002, 0.002, CEIL - 3.55, 4); w.translate(12.3 + Math.cos(a) * 1.15, (CEIL + 3.55) / 2, -4.3 + Math.sin(a) * 1.15); wires.push(w.ni()); }
  L(mergeGeometries(wires), M.steel_black, 'ceiling', { cast: false });
  const glow = new THREE.PointLight(0xfff4e4, 9, 9, 2); glow.position.copy(P(12.3, 4.3, 3.3)); lounge.add(glow); layers.ceiling.push(glow);
  const warm = new THREE.PointLight(0xffd9a8, 4, 5, 2); warm.position.copy(P(15.0, 7.0, 2.2)); lounge.add(warm); layers.ceiling.push(warm);
}

// lounge: high-back sofa, two armchairs and a coffee table in pale boucle
{ const rb = (w, h, d, r, x, z, y, mat) => { const g = new RoundedBoxGeometry(w, h, d, 3, r); g.translate(x, z, -y); return L(g, mat); };
  // sofa against the east curtains, facing west
  const sx0 = 15.6, sx1 = 16.33, sy0 = 2.15, sy1 = 3.75, cyS = (sy0 + sy1) / 2;
  rb(sx1 - sx0, 0.3, sy1 - sy0, 0.05, (sx0 + sx1) / 2, 0.28, cyS, M.boucle);
  rb(sx1 - sx0 - 0.2, 0.12, sy1 - sy0 - 0.2, 0.05, (sx0 + sx1) / 2 - 0.08, 0.48, cyS, M.boucle);
  rb(0.2, 0.85, sy1 - sy0, 0.07, sx1 - 0.1, 0.72, cyS, M.boucle);
  rb(sx1 - sx0, 0.72, 0.12, 0.05, (sx0 + sx1) / 2, 0.64, sy0 + 0.06, M.boucle); rb(sx1 - sx0, 0.72, 0.12, 0.05, (sx0 + sx1) / 2, 0.64, sy1 - 0.06, M.boucle);
  for (const [x, y] of [[sx0 + 0.05, sy0 + 0.05], [sx1 - 0.05, sy0 + 0.05], [sx0 + 0.05, sy1 - 0.05], [sx1 - 0.05, sy1 - 0.05]]) rb(0.03, 0.13, 0.03, 0.008, x, 0.065, y, M.steel_black);
  // armchairs facing the sofa
  for (const yc of [2.5, 3.4]) { const xc = 14.3;
    rb(0.66, 0.2, 0.7, 0.06, xc, 0.36, yc, M.boucle); rb(0.18, 0.36, 0.7, 0.06, xc - 0.28, 0.58, yc, M.boucle);
    rb(0.62, 0.1, 0.1, 0.04, xc + 0.02, 0.5, yc - 0.33, M.boucle); rb(0.62, 0.1, 0.1, 0.04, xc + 0.02, 0.5, yc + 0.33, M.boucle);
    for (const dy of [-0.37, 0.37]) { rb(0.7, 0.02, 0.02, 0.006, xc, 0.26, yc + dy, M.steel_black); rb(0.02, 0.26, 0.02, 0.006, xc - 0.33, 0.13, yc + dy, M.steel_black); rb(0.02, 0.26, 0.02, 0.006, xc + 0.33, 0.13, yc + dy, M.steel_black); } }
  // coffee table
  rb(0.6, 0.02, 0.9, 0.006, 15.05, 0.4, 2.95, M.stone_top); for (const [x, y] of [[14.78, 2.53], [15.32, 2.53], [14.78, 3.37], [15.32, 3.37]]) rb(0.02, 0.39, 0.02, 0.006, x, 0.195, y, M.steel_black);
  const pot = new THREE.CylinderGeometry(0.05, 0.045, 0.07, 16); pot.translate(15.05, 0.445, -2.95); L(pot, M.ceramic);
  const lv = []; leafCluster(15.05, 2.95, 0.5, 0.07, lv); L(mergeGeometries(lv), M.leaf);
  // plants: tall fig by the entry, one by the curtains
  for (const [x, y, h] of [[10.45, 2.2, 1.7], [13.4, 2.1, 1.3]]) { const p = new THREE.CylinderGeometry(0.21, 0.17, 0.46, 24); p.translate(x, 0.23, -y); L(p, M.planter);
    const st = new THREE.CylinderGeometry(0.015, 0.02, h * 0.6, 6); st.translate(x, 0.46 + h * 0.3, -y); L(st, M.door);
    const lv2 = []; leafCluster(x, y, 0.46 + h * 0.62, h * 0.3, lv2); leafCluster(x + 0.05, y - 0.04, 0.46 + h * 0.9, h * 0.2, lv2); L(mergeGeometries(lv2), M.leaf); }
}
lounge.traverse(o => { if (o.isMesh && !o.material.transparent && o.material !== M.led && o.material !== M.led_cool) { o.receiveShadow = true; } });

// ================================================================== PHOTO-REFERENCED SPACES (courtyard, warehouse, studio, east office)
const S = {};   // extra textures
{
  // 1200 x 1200 concrete pavers (texture covers 2 x 2)
  const size = 1024, n = fbm(size, 6, 6), v = [0.97, 1.03, 1.0, 0.95];
  S.pavers = tex(paint(size, (x, y, i) => { const gx = (x / size * 2) % 1, gy = (y / size * 2) % 1;
    if (gx < 0.004 || gx > 0.996 || gy < 0.004 || gy > 0.996) return [120, 121, 121];
    const k = v[Math.floor(y / size * 2) * 2 + Math.floor(x / size * 2)] * (0.9 + n[i] * 0.2); return [188 * k, 188 * k, 185 * k]; }), 2.4, 2.4);
  // white aluminium cladding panels 1.2 x 1.0
  S.clad = tex(paint(256, (x, y) => { const gx = (x / 256) % 1, gy = (y / 256) % 1; const g = gx < 0.01 || gy < 0.012; const v = g ? 190 : 244; return [v, v, v]; }), 1.2, 1.0);
  // rope weave: vertical cords with gaps
  S.rope = tex(paint(128, (x, y) => { const u = (x / 128 * 10) % 1; if (Math.abs(u - 0.5) > 0.32) return [0, 0, 0, 0];
    const tw = Math.sin((y / 128 * 12 + (u > 0.5 ? 0.5 : 0)) * Math.PI * 2) * 0.5 + 0.5; const c = 44 + tw * 22; return [c, c, c + 2, 255]; }), 0.12, 0.12);
  // chevron oak floor (texture covers 1.2 x 1.2 m)
  { const size = 1024, w = fbm(size, 8, 3), cols = []; for (let k = 0; k < 24; k++) cols.push(0.86 + rnd() * 0.22);
    const c1 = hex(0xcf9a5e), c2 = hex(0xa87140);
    S.chevron = tex(paint(size, (x, y, i) => { const X = x / size * 1.2, Y = y / size * 1.2, c = Math.floor(X / 0.3), fx = X - c * 0.3;
      const vv = Y + (c % 2 === 0 ? fx : 0.3 - fx), idx = Math.floor(vv / 0.1), fr = vv / 0.1 - idx; const seam = fr < 0.05 || fx < 0.003;
      const k = cols[((idx % 12) + 12) % 12 + (c % 2) * 12] * (seam ? 0.62 : 1); const t = Math.pow(Math.sin((fr * 3 + w[i] * 4) * Math.PI) * 0.5 + 0.5, 4) * 0.4;
      return [mix(c1[0], c2[0], t) * k, mix(c1[1], c2[1], t) * k, mix(c1[2], c2[2], t) * k]; }), 1.2, 1.2); }
  S.carpet = tex(tinted(256, 0x3a3c3e, fbm(256, 64, 2), 0.35), 0.5);
  S.carpetN = tex(heightToNormal(fbm(256, 96, 2), 256, 2), 0.3, 0.3, false);
  // roller shutter ribs
  { const size = 256, h = new Float32Array(size * size); for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) h[y * size + x] = Math.abs(Math.sin(y / size * Math.PI * 8));
    S.shutterN = tex(heightToNormal(h, size, 5), 1, 0.6, false); }
  // mid-brown studio planks
  S.studioPlanks = T.planks.clone(); S.studioPlanks.needsUpdate = true;
  // distressed rug
  { const n2 = fbm(512, 6, 6), n3 = fbm(512, 24, 3); S.rug = new THREE.CanvasTexture(paint(512, (x, y, i) => {
      const bx = Math.min(x, 511 - x, y, 511 - y) < 14 ? 0.85 : 1; const pat = Math.abs(Math.sin((x - 256) * (y - 256) / 9000)) * 0.4 + n2[i] * 0.6; const k = (pat > 0.62 ? 0.78 : 1) * (0.9 + n3[i] * 0.15) * bx;
      return [224 * k, 219 * k, 208 * k]; })); S.rug.colorSpace = THREE.SRGBColorSpace; }
  // acoustic felt panel with arch grooves (one panel = 1.2 x 2.75 m)
  { const W = 240, H = 550, c = cv(W, H), ctx = c.getContext('2d'); ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
    for (const [cx, base] of [[W * 0.5, H * 0.98]]) for (let k = 0; k < 5; k++) { const r = 34 + k * 20; ctx.beginPath(); ctx.moveTo(cx - r, base); ctx.lineTo(cx - r, H * 0.42); ctx.arc(cx, H * 0.42, r, Math.PI, 0); ctx.lineTo(cx + r, base); ctx.stroke(); }
    for (let k = 0; k < 3; k++) { const r = 30 + k * 18; ctx.beginPath(); ctx.arc(0, H * 0.16, r, -Math.PI / 2, Math.PI / 2); ctx.stroke(); ctx.beginPath(); ctx.arc(W, H * 0.16, r, Math.PI / 2, Math.PI * 1.5); ctx.stroke(); }
    const d = ctx.getImageData(0, 0, W, H).data, hgt = new Float32Array(W * H); for (let i = 0; i < W * H; i++) hgt[i] = d[i * 4] / 255;
    // normal map needs a square buffer; resample to 512
    const sz = 512, hs = new Float32Array(sz * sz); for (let y = 0; y < sz; y++) for (let x = 0; x < sz; x++) hs[y * sz + x] = hgt[Math.floor(y / sz * H) * W + Math.floor(x / sz * W)];
    S.feltN = new THREE.CanvasTexture(heightToNormal(hs, sz, 2.2));
    const f = fbm(256, 48, 3, 0.7); S.felt = new THREE.CanvasTexture(paint(256, (x, y, i) => { const v = 206 + (f[i] - 0.5) * 30 + (rnd() - 0.5) * 18; return [v, v, v + 2]; })); S.felt.colorSpace = THREE.SRGBColorSpace; }
  // mesh chair back
  S.mesh = tex(paint(64, (x, y) => ((x % 8) < 2 || (y % 8) < 2) ? [26, 27, 29, 255] : [18, 18, 20, 150]), 0.03, 0.03);
  // basketball net
  S.net = new THREE.CanvasTexture(paint(128, (x, y) => { const a = ((x + y) % 32) < 3 || ((x - y + 512) % 32) < 3; return a ? [245, 245, 245, 255] : [0, 0, 0, 0]; }));
  S.net.wrapS = S.net.wrapT = THREE.RepeatWrapping; S.net.repeat.set(3, 1);
  // painted court on grey epoxy (warehouse 12.95 x 5.5 m)
  { const W = 2048, H = 870, c = cv(W, H), ctx = c.getContext('2d'), n4 = fbm(512, 8, 5); const ppm = W / 12.95;
    const base = cv(512, 512); base.getContext('2d').putImageData((() => { const im = new ImageData(512, 512); for (let i = 0; i < 512 * 512; i++) { const v = 142 + (n4[i] - 0.5) * 22; im.data[i * 4] = v; im.data[i * 4 + 1] = v + 2; im.data[i * 4 + 2] = v + 4; im.data[i * 4 + 3] = 255; } return im; })(), 0, 0);
    ctx.drawImage(base, 0, 0, W, H);
    const Y = y => H - y * ppm, X = x => x * ppm, cyc = 2.75;
    ctx.strokeStyle = 'rgba(248,248,246,.95)'; ctx.lineWidth = 0.06 * ppm;
    ctx.strokeRect(X(0.05), Y(cyc + 1.8), X(4.55), 3.6 * ppm);
    ctx.beginPath(); ctx.arc(X(4.6), Y(cyc), 1.8 * ppm, -Math.PI / 2, Math.PI / 2); ctx.stroke();
    ctx.setLineDash([0.3 * ppm, 0.3 * ppm]); ctx.beginPath(); ctx.arc(X(4.6), Y(cyc), 1.8 * ppm, Math.PI / 2, Math.PI * 1.5); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(X(1.2), Y(cyc), 6.0 * ppm, -1.1, 1.1); ctx.stroke();
    ctx.fillStyle = 'rgba(40,42,45,.9)'; ctx.fillRect(X(0.9), Y(cyc + 0.45), 0.9 * ppm, 0.9 * ppm);
    ctx.beginPath(); ctx.moveTo(X(12.9), 0); ctx.lineTo(X(12.9), H); ctx.stroke();
    S.court = new THREE.CanvasTexture(c); S.court.colorSpace = THREE.SRGBColorSpace; S.court.anisotropy = 8; }
  // light box signs, hanging signs, mural, screen slide
  const lightBox = (word, c1, c2) => { const c = cv(128, 640), ctx = c.getContext('2d'); const g = ctx.createLinearGradient(0, 0, 0, 640); g.addColorStop(0, c1); g.addColorStop(1, c2);
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 640); ctx.strokeStyle = 'rgba(10,20,40,.85)'; ctx.lineWidth = 6; ctx.strokeRect(8, 8, 112, 624);
    ctx.save(); ctx.translate(76, 330); ctx.rotate(Math.PI / 2); ctx.fillStyle = '#0d1a3a'; ctx.font = '700 64px Archivo, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(word, 0, 0); ctx.restore();
    ctx.fillStyle = '#0d1a3a'; for (let k = 0; k < 5; k++) ctx.fillRect(40 + k * 11, 580 - (k % 2 ? 18 : 30), 6, k % 2 ? 18 : 30);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
  S.flash = lightBox('FLASH', '#bfe6ff', '#8fb8ff'); S.podcast = lightBox('PODCAST', '#d8c9ff', '#8e9dff'); S.frame = lightBox('FRAME', '#c8f7c9', '#7fdc8f');
  S.hang = ['BUILD.', 'SOLVE.', 'DISCOVER.'].map(w => { const c = cv(256, 256), ctx = c.getContext('2d'); ctx.fillStyle = '#111214'; ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = '#f4f3ef'; ctx.font = '800 38px Archivo, Arial, sans-serif'; ctx.fillText(w, 22, 64); ctx.font = '500 13px "IBM Plex Mono", monospace'; ctx.fillText('AT AIIMS', 24, 86);
    ctx.font = 'italic 600 30px Georgia, serif'; ctx.fillText('together', 118, 222); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; });
  { const c = cv(1024, 700), ctx = c.getContext('2d'); ctx.fillStyle = '#141516'; ctx.fillRect(0, 0, 1024, 700);
    ctx.strokeStyle = '#f3f1ec'; ctx.lineWidth = 7; ctx.font = '900 180px Archivo, Arial, sans-serif'; ctx.strokeText('AIIMS', 70, 470);
    ctx.fillStyle = '#d63a2f'; ctx.beginPath(); ctx.arc(820, 250, 120, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 4; for (let k = 0; k < 9; k++) { ctx.beginPath(); ctx.arc(820, 250, 140 + k * 16, Math.PI * 0.9, Math.PI * 1.7); ctx.stroke(); }
    ctx.fillStyle = '#f3f1ec'; for (let k = 0; k < 40; k++) { ctx.beginPath(); ctx.arc(60 + rnd() * 900, 560 + rnd() * 110, 3 + rnd() * 5, 0, Math.PI * 2); ctx.fill(); }
    ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(40, 120); for (let x = 40; x < 620; x += 20) ctx.lineTo(x, 120 + Math.sin(x / 40) * 26); ctx.stroke();
    S.mural = new THREE.CanvasTexture(c); S.mural.colorSpace = THREE.SRGBColorSpace; }
  { const c = cv(512, 296), ctx = c.getContext('2d'); const g = ctx.createLinearGradient(0, 0, 512, 296); g.addColorStop(0, '#0e1b33'); g.addColorStop(1, '#1b3f6b'); ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 296);
    ctx.fillStyle = '#ffffff'; ctx.font = '700 40px Archivo, Arial, sans-serif'; ctx.fillText('Welcome to AIIMS', 36, 120); ctx.font = '400 20px "IBM Plex Sans", sans-serif'; ctx.fillStyle = '#b8cbe6'; ctx.fillText('Be fearless together', 38, 158);
    ctx.fillStyle = '#4f8cff'; ctx.fillRect(38, 190, 120, 34); S.slide = new THREE.CanvasTexture(c); S.slide.colorSpace = THREE.SRGBColorSpace; }
  S.work = [0, 1, 2].map(k => { const c = cv(256, 150), ctx = c.getContext('2d'); ctx.fillStyle = '#f4f6f8'; ctx.fillRect(0, 0, 256, 150); ctx.fillStyle = '#2d3a4a'; ctx.fillRect(0, 0, 256, 12);
    if (k === 0) { ctx.strokeStyle = '#c9d1da'; for (let x = 0; x < 256; x += 24) { ctx.beginPath(); ctx.moveTo(x, 12); ctx.lineTo(x, 150); ctx.stroke(); } for (let y = 12; y < 150; y += 9) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(256, y); ctx.stroke(); } ctx.fillStyle = '#7bc27f'; ctx.fillRect(48, 30, 72, 9); }
    else if (k === 1) { ctx.fillStyle = '#e3e8ee'; ctx.fillRect(0, 12, 56, 138); ctx.fillStyle = '#9aa7b6'; for (let y = 24; y < 140; y += 14) ctx.fillRect(66, y, 80 + rnd() * 90, 5); ctx.fillStyle = '#4f8cff'; ctx.fillRect(66, 110, 50, 14); }
    else { ctx.fillStyle = '#1e2430'; ctx.fillRect(0, 12, 256, 138); ctx.fillStyle = '#7fd1a7'; for (let y = 24; y < 140; y += 11) ctx.fillRect(12 + (y % 3) * 10, y, 40 + rnd() * 120, 4); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; });
  { const c = cv(128, 256), ctx = c.getContext('2d'); const g = ctx.createRadialGradient(64, 150, 10, 64, 150, 120); g.addColorStop(0, '#3f7a3a'); g.addColorStop(1, '#1e4a1f'); ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(64, 250); ctx.bezierCurveTo(-30, 180, 0, 20, 64, 6); ctx.bezierCurveTo(128, 20, 158, 180, 64, 250); ctx.fill();
    ctx.strokeStyle = 'rgba(190,220,150,.55)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(64, 248); ctx.lineTo(64, 14); ctx.stroke();
    ctx.lineWidth = 1.5; for (let k = 0; k < 7; k++) { const y = 60 + k * 26; ctx.beginPath(); ctx.moveTo(64, y + 16); ctx.lineTo(18, y); ctx.moveTo(64, y + 16); ctx.lineTo(110, y); ctx.stroke(); }
    S.fig = new THREE.CanvasTexture(c); S.fig.colorSpace = THREE.SRGBColorSpace; }
}
Object.assign(M, {
  pavers: std({ color: 0xffffff, map: S.pavers, roughness: 0.8, envMapIntensity: 0.6 }),
  frame_white: std({ color: 0xf1f2f2, roughness: 0.35, metalness: 0.3 }),
  clad: std({ color: 0xffffff, map: S.clad, roughness: 0.4, metalness: 0.15 }),
  louvre: std({ color: 0xf2f3f3, roughness: 0.35, metalness: 0.4 }),
  rope: std({ color: 0xffffff, map: S.rope, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.85 }),
  cushion_dark: std({ color: 0x3b3e41, normalMap: T.weaveN, roughness: 0.95 }),
  dark_concrete: std({ color: 0x6a6c6d, map: T.concrete, roughness: 0.6 }),
  table_black: std({ color: 0x1c1d1f, roughness: 0.5 }),
  outdoor_fabric: std({ color: 0x6c7175, normalMap: T.weaveN, roughness: 0.95 }),
  fig: std({ map: S.fig, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.45 }),
  bark: std({ color: 0x6b5543, roughness: 0.9 }),
  chevron: std({ color: 0xffffff, map: S.chevron, roughness: 0.5, envMapIntensity: 0.8 }),
  carpet: std({ color: 0xffffff, map: S.carpet, normalMap: S.carpetN, roughness: 1 }),
  tile_light: std({ color: 0x9a9da0, map: T.tile, roughnessMap: T.tileR, roughness: 0.4, envMapIntensity: 1.0 }),
  court: std({ map: S.court, roughness: 0.38, envMapIntensity: 0.9 }),
  concrete_soffit: std({ color: 0xb7b5b0, map: T.concrete, roughness: 0.9, side: THREE.DoubleSide }),
  shutter: std({ color: 0x1a1b1d, normalMap: S.shutterN, normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.45, metalness: 0.6 }),
  studio_floor: std({ color: 0xb49a82, map: S.studioPlanks, roughness: 0.5, envMapIntensity: 0.8 }),
  felt: std({ map: S.felt, normalMap: S.feltN, normalScale: new THREE.Vector2(1.6, 1.6), roughness: 1 }),
  rug: std({ map: S.rug, roughness: 1 }),
  mesh_back: std({ color: 0xffffff, map: S.mesh, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.8 }),
  net: std({ map: S.net, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1 }),
  rim: std({ color: 0xe0561c, roughness: 0.4, metalness: 0.6 }),
  white: std({ color: 0xf5f5f3, roughness: 0.4 }),
  hang: S.hang.map(t => std({ map: t, roughness: 0.6 })),
  mural: std({ map: S.mural, roughness: 0.8 }),
  flash: new THREE.MeshBasicMaterial({ map: S.flash, color: new THREE.Color(2.2, 2.2, 2.2) }),
  podcast: new THREE.MeshBasicMaterial({ map: S.podcast, color: new THREE.Color(2.2, 2.2, 2.2) }),
  frame: new THREE.MeshBasicMaterial({ map: S.frame, color: new THREE.Color(2.0, 2.0, 2.0) }),
  slide: new THREE.MeshBasicMaterial({ map: S.slide, color: new THREE.Color(1.3, 1.3, 1.3) }),
  softbox_in: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.6, 1.55), side: THREE.DoubleSide }),
  work: [0, 1, 2].map(k => new THREE.MeshBasicMaterial({ map: S.work[k], color: new THREE.Color(0.95, 0.95, 0.95) })),
  paper: ['#e9677e', '#a78bd9', '#4c9be0', '#f2c230', '#5c5f63', '#d8c7a2', '#f0a93b', '#2fb3c9', '#9b92d6', '#ef6f73'].map(c => std({ color: c, roughness: 0.9, side: THREE.DoubleSide })),
});
M.pavers.map.repeat.set(1 / 2.4, 1 / 2.4);
// courtyard floor now uses the pavers
scene.traverse(o => { if (o.isMesh && o.material === M.courtyard) o.material = M.pavers; });

// ---- helpers (plan coordinates in metres; z is absolute height)
const SP = {};  // groups per space
function space(name, floor) { const g = new THREE.Group(); g.name = name; floorGroups[floor].add(g); SP[name] = g; return g; }
function put(group, geo, mat, opts = {}) { const m = new THREE.Mesh(geo, mat); m.castShadow = opts.cast ?? !mat.transparent; m.receiveShadow = opts.receive ?? true; if (mat.transparent) m.renderOrder = 2; group.add(m); if (opts.layer && layers[opts.layer]) layers[opts.layer].push(m); return m; }
function bx(group, x0, y0, z0, x1, y1, z1, mat, opts = {}) {
  const w = x1 - x0, h = z1 - z0, d = y1 - y0, r = opts.r ?? Math.min(0.006, Math.min(w, h, d) * 0.3);
  const g = r > 0 ? new RoundedBoxGeometry(w, h, d, 1, r) : new THREE.BoxGeometry(w, h, d);
  g.translate((x0 + x1) / 2, (z0 + z1) / 2, -(y0 + y1) / 2); if (opts.uv !== false) projectUV(g); return put(group, g, mat, opts);
}
function patch(group, x0, y0, x1, y1, z, mat, opts = {}) {      // horizontal plane, world-metre UVs
  const g = new THREE.PlaneGeometry(x1 - x0, y1 - y0); g.rotateX(-Math.PI / 2); g.translate((x0 + x1) / 2, z, -(y0 + y1) / 2);
  if (opts.uv !== false) projectUV(g); return put(group, g, mat, Object.assign({ cast: false }, opts));
}
// wall lining along a wall line, with rectangular holes [s0, s1, z0, z1]
function lining(group, axis, c, s0, s1, z0, z1, holes, mat, t = 0.012, opts = {}) {
  const cuts = new Set([s0, s1]); holes.forEach(h => { cuts.add(Math.max(s0, Math.min(s1, h[0]))); cuts.add(Math.max(s0, Math.min(s1, h[1]))); });
  const xs = [...cuts].sort((a, b) => a - b);
  for (let i = 0; i < xs.length - 1; i++) { const a = xs[i], b = xs[i + 1]; if (b - a < 0.005) continue; const mid = (a + b) / 2;
    const hs = holes.filter(h => h[0] <= mid && h[1] >= mid).map(h => [h[2], h[3]]).sort((p, q) => p[0] - q[0]);
    let z = z0; const spans = []; for (const [h0, h1] of hs) { if (h0 > z) spans.push([z, h0]); z = Math.max(z, h1); } if (z < z1) spans.push([z, z1]);
    for (const [q0, q1] of spans) { if (axis === 'x') bx(group, a, c, q0, b, c + t, q1, mat, Object.assign({ r: 0 }, opts)); else bx(group, c, a, q0, c + t, b, q1, mat, Object.assign({ r: 0 }, opts)); } }
}
function hexOutline(group, cx, cy, z, R, cols, rows, mat) {       // honeycomb LED grid, shared edges merged
  const seen = new Set(), geos = [];
  for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
    const hx = cx + (q - (cols - 1) / 2) * R * 1.5, hy = cy + (r - (rows - 1) / 2) * R * Math.sqrt(3) + (q % 2 ? R * Math.sqrt(3) / 2 : 0);
    for (let k = 0; k < 6; k++) { const a0 = k * Math.PI / 3, a1 = (k + 1) * Math.PI / 3;
      const p0 = [hx + R * Math.cos(a0), hy + R * Math.sin(a0)], p1 = [hx + R * Math.cos(a1), hy + R * Math.sin(a1)];
      const key = [p0, p1].map(p => p.map(v => v.toFixed(2)).join(',')).sort().join('|'); if (seen.has(key)) continue; seen.add(key);
      const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), g = new THREE.BoxGeometry(L - 0.02, 0.028, 0.04);
      g.rotateY(Math.atan2(p1[1] - p0[1], p1[0] - p0[0])); g.translate((p0[0] + p1[0]) / 2, z, -(p0[1] + p1[1]) / 2); geos.push(g.ni()); } }
  return put(group, mergeGeometries(geos), mat, { cast: false, layer: 'ceiling' });
}
function hangWire(group, x, y, z0, z1) { const w = new THREE.CylinderGeometry(0.0025, 0.0025, z1 - z0, 4); w.translate(x, (z0 + z1) / 2, -y); return put(group, w, M.steel_black, { cast: false }); }
function potPlant(group, x, y, z, opt) {                         // fiddle-leaf fig or bird-of-paradise in a black bowl
  const bowl = new THREE.SphereGeometry(opt.pot, 28, 14, 0, Math.PI * 2, Math.PI * 0.32, Math.PI * 0.68); bowl.scale(1, 0.8, 1);
  bowl.translate(x, z + opt.pot * 0.8, -y); put(group, bowl, M.planter);
  const top = z + opt.pot * 1.2, geos = [];
  { const soil = new THREE.CircleGeometry(opt.pot * 0.83, 24); soil.rotateX(-Math.PI / 2); soil.translate(x, top - 0.04, -y); put(group, soil, M.bark, { cast: false }); }
  if (opt.kind === 'fig') {
    const tr = new THREE.CylinderGeometry(0.025, 0.04, opt.h * 0.75, 8); tr.translate(x, top + opt.h * 0.37, -y); put(group, tr, M.bark);
    for (let k = 0; k < 6; k++) leafCluster(x + (rnd() - 0.5) * 0.3, y + (rnd() - 0.5) * 0.3, top + opt.h * (0.3 + k * 0.13), opt.h * 0.2, geos, { n: 16, w: 2.3, h: 1.05, up: 0.35, spread: 0.55 });
    put(group, mergeGeometries(geos), M.fig);
  } else {
    for (let k = 0; k < 11; k++) { const a = rnd() * Math.PI * 2, lean = 0.12 + rnd() * 0.25, L = opt.h * (0.55 + rnd() * 0.35);
      const ex = x + Math.cos(a) * L * lean, ey = y + Math.sin(a) * L * lean, ez = top + L * 0.95;
      const st = new THREE.CylinderGeometry(0.008, 0.012, L, 5); const m = new THREE.Mesh(st); m.position.copy(P((x + ex) / 2, (y + ey) / 2, (top + ez) / 2));
      m.lookAt(P(ex, ey, ez)); m.rotateX(Math.PI / 2); m.updateMatrix(); st.applyMatrix4(m.matrix); geos.push(st.ni());
      const lf = new THREE.PlaneGeometry(0.2, 0.55, 1, 4); const pa = lf.attributes.position; for (let i = 0; i < pa.count; i++) pa.setZ(i, -Math.abs(pa.getX(i)) * 0.25);
      lf.translate(0, 0.27, 0); lf.computeVertexNormals(); const o = new THREE.Object3D(); o.position.copy(P(ex, ey, ez)); o.rotation.set(0, -a + Math.PI / 2, 0); o.rotateX(-lean * 1.6); o.updateMatrix();
      lf.applyMatrix4(o.matrix); geos.push(lf.ni()); }
    put(group, mergeGeometries(geos), M.fig);
  }
}

// ---- reusable furniture prototypes
function ropeChair() {
  const g = new THREE.Group(), add = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = m.receiveShadow = true; g.add(m); return m; };
  for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) { const a = new THREE.Vector3(x * 1.15, 0, z * 1.15), b = new THREE.Vector3(x, 0.42, z);
    const m = add(new THREE.CylinderGeometry(0.011, 0.009, a.distanceTo(b), 8), M.steel_black); m.position.copy(a).add(b).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()); }
  const ring = add(new THREE.TorusGeometry(0.26, 0.012, 8, 40), M.steel_black); ring.rotation.x = Math.PI / 2; ring.position.y = 0.43;
  add(new RoundedBoxGeometry(0.46, 0.07, 0.44, 3, 0.03), M.cushion_dark).position.y = 0.47;
  const shell = new THREE.CylinderGeometry(0.29, 0.26, 0.38, 32, 1, true, Math.PI * 1.3, Math.PI * 1.4);
  { const uv = shell.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 1.25 / 0.12, uv.getY(i) * 0.38 / 0.12); }
  add(shell, M.rope).position.y = 0.62;
  const rim = add(new THREE.TorusGeometry(0.29, 0.013, 8, 48, Math.PI * 1.4), M.steel_black); rim.rotation.x = Math.PI / 2; rim.rotation.z = -Math.PI * 0.2; rim.position.y = 0.81;
  return g;   // front of the chair faces local -z
}
function meshChair() {
  const g = new THREE.Group(), add = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = m.receiveShadow = true; g.add(m); return m; };
  for (let k = 0; k < 5; k++) { const a = k * Math.PI * 2 / 5; const arm = add(new THREE.BoxGeometry(0.32, 0.03, 0.045), M.steel_black); arm.position.set(Math.cos(a) * 0.16, 0.07, Math.sin(a) * 0.16); arm.rotation.y = -a;
    const cst = add(new THREE.SphereGeometry(0.028, 10, 8), M.steel_black); cst.position.set(Math.cos(a) * 0.31, 0.03, Math.sin(a) * 0.31); }
  add(new THREE.CylinderGeometry(0.025, 0.03, 0.36, 12), M.metal).position.y = 0.26;
  add(new RoundedBoxGeometry(0.5, 0.08, 0.48, 3, 0.03), M.chair).position.y = 0.48;
  const back = add(new RoundedBoxGeometry(0.46, 0.56, 0.03, 2, 0.012), M.mesh_back); back.position.set(0, 0.86, 0.24); back.rotation.x = -0.12;
  const bf = add(new RoundedBoxGeometry(0.48, 0.58, 0.02, 2, 0.01), M.steel_black); bf.position.set(0, 0.86, 0.262); bf.rotation.x = -0.12; bf.scale.set(1, 1, 0.5);
  for (const sx of [-0.27, 0.27]) { add(new RoundedBoxGeometry(0.04, 0.2, 0.04, 1, 0.01), M.steel_black).position.set(sx, 0.6, 0.02); add(new RoundedBoxGeometry(0.07, 0.03, 0.26, 1, 0.01), M.steel_black).position.set(sx, 0.71, 0.0); }
  return g;   // front faces local -z
}
const place = (proto, group, x, y, z, faceYaw) => { const o = proto.clone(); o.position.copy(P(x, y, z)); o.rotation.y = faceYaw; group.add(o); return o; };
// yaw so the chair's front (local -z) looks toward plan direction (dx, dy)
const yawToward = (dx, dy) => Math.atan2(-dx, dy);

// ================================================================== COURTYARD (upper floor)
{
  const G = space('Courtyard', 'UF'), z0 = UFZ + 0.03, x0 = 5.54, x1 = 9.25, y0 = 10.18, y1 = 17.0, head = UFZ + 2.6, top = UFZ + 3.45;
  // white cladding above the glazing, rising to the louvre roof
  for (const [a, b, c, axis] of [[x0, x1, y0, 'x'], [x0, x1, y1, 'x'], [y0, y1, x0, 'y'], [y0, y1, x1, 'y']]) {
    if (axis === 'x') bx(G, a - 0.06, c - 0.06, head, b + 0.06, c + 0.06, top, M.clad, { r: 0 }); else bx(G, c - 0.06, a, head, c + 0.06, b, top, M.clad, { r: 0 }); }
  // louvre roof: perimeter beams + angled blades casting the striped light in the photo
  bx(G, x0 - 0.06, y0 - 0.1, top, x1 + 0.06, y0 + 0.08, top + 0.22, M.louvre); bx(G, x0 - 0.06, y1 - 0.08, top, x1 + 0.06, y1 + 0.1, top + 0.22, M.louvre);
  bx(G, x0 - 0.1, y0, top, x0 + 0.08, y1, top + 0.22, M.louvre); bx(G, x1 - 0.08, y0, top, x1 + 0.1, y1, top + 0.22, M.louvre);
  { const geos = []; for (let y = y0 + 0.16; y < y1 - 0.1; y += 0.2) { const b = new THREE.BoxGeometry(x1 - x0 - 0.16, 0.022, 0.17); b.rotateX(0.6); b.translate((x0 + x1) / 2, top + 0.12, -y); geos.push(b.ni()); }
    put(G, projectUV(mergeGeometries(geos)), M.louvre, { layer: 'roof' }); }
  // long dark-concrete dining table on a plinth, rope chairs around it
  bx(G, 6.95, 12.25, z0 + 0.72, 7.95, 14.85, z0 + 0.77, M.dark_concrete, { r: 0.01 }); bx(G, 7.12, 12.65, z0, 7.78, 14.45, z0 + 0.72, M.dark_concrete, { r: 0.01 });
  const rc = ropeChair();
  for (const y of [12.75, 13.55, 14.35]) { place(rc, G, 6.52, y, z0, yawToward(1, 0)); place(rc, G, 8.38, y, z0, yawToward(-1, 0)); }
  place(rc, G, 7.45, 11.85, z0, yawToward(0, 1)); place(rc, G, 7.45, 15.25, z0, yawToward(0, -1));
  // small black table near the north end, grey outdoor sofa along the north glazing
  bx(G, 6.1, 15.75, z0 + 0.71, 6.9, 16.35, z0 + 0.74, M.table_black, { r: 0.008 });
  for (const [x, y] of [[6.14, 15.79], [6.86, 15.79], [6.14, 16.31], [6.86, 16.31]]) bx(G, x - 0.015, y - 0.015, z0, x + 0.015, y + 0.015, z0 + 0.71, M.steel_black, { r: 0 });
  place(rc, G, 6.5, 15.35, z0, yawToward(0, 1));
  { const sx0 = 6.5, sx1 = 8.3, sy0 = 10.28, sy1 = 11.08;   // grey outdoor sofa at the south end, back to the glass, facing the dining table
    bx(G, sx0, sy0, z0 + 0.12, sx1, sy1, z0 + 0.42, M.outdoor_fabric, { r: 0.05 }); bx(G, sx0, sy0 - 0.02, z0 + 0.42, sx1, sy0 + 0.18, z0 + 0.82, M.outdoor_fabric, { r: 0.06 });
    bx(G, sx0, sy0, z0 + 0.42, sx0 + 0.15, sy1, z0 + 0.62, M.outdoor_fabric, { r: 0.05 }); bx(G, sx1 - 0.15, sy0, z0 + 0.42, sx1, sy1, z0 + 0.62, M.outdoor_fabric, { r: 0.05 });
    bx(G, sx0 - 0.02, sy0 - 0.02, z0, sx1 + 0.02, sy1 + 0.02, z0 + 0.12, M.steel_black, { r: 0.005 }); }
  // candles on the table
  for (const [x, y] of [[7.35, 13.1], [7.5, 13.45], [7.4, 13.9], [7.55, 14.2]]) { const c = new THREE.CylinderGeometry(0.035, 0.035, 0.09, 16); c.translate(x, z0 + 0.815, -y); put(G, c, M.candle); }
  // fiddle-leaf fig (foreground in the photo) and bird-of-paradise plants
  potPlant(G, 5.95, 11.25, z0, { kind: 'fig', pot: 0.34, h: 2.1 });
  potPlant(G, 8.85, 11.1, z0, { kind: 'bop', pot: 0.28, h: 1.5 });
  potPlant(G, 5.95, 16.5, z0, { kind: 'bop', pot: 0.26, h: 1.3 });
}

// ================================================================== WAREHOUSE (ground floor) - black box, court, hex lights, shutters, backdrops
{
  const G = space('Warehouse', 'GF'), X0 = 3.525, X1 = 16.52, Y0 = 15.555, Y1 = 21.055, H = 4.175;
  patch(G, X0, Y0, X1, Y1, 0.004, M.court, { uv: false });
  lining(G, 'x', Y0, X0, 16.53, 0, H, [[10.46, 11.19, 0, 2.1], [13.35, 14.8, 0.3, 2.75]], M.black_panel);                              // south wall
  lining(G, 'x', Y1 - 0.012, X0, X1, 0, H, [[6.78, 9.58, 0, 3.35], [13.4, 16.2, 0, 3.35]], M.black_panel);     // north (storage) wall
  lining(G, 'y', X0, Y0, Y1, 0, H, [[15.79, 16.52, 0, 2.1], [20.18, 20.89, 0, 2.1]], M.black_panel);           // west wall with two doors
  lining(G, 'y', X1 - 0.012, Y0, Y1, 0, H, [[16.21, 20.71, 0, 4.0]], M.black_panel);                           // east wall around the roller door
  // black doors, closed
  for (const [a, b] of [[15.79, 16.52], [20.18, 20.89]]) bx(G, X0 + 0.005, a + 0.03, 0.005, X0 + 0.05, b - 0.03, 2.07, M.black_panel);
  // doorway beside the screen: black steel frame, glazed black door held open, lit white corridor beyond
  bx(G, 10.4, Y0 - 0.02, 0, 10.46, Y0 + 0.04, 2.16, M.steel_black, { r: 0 }); bx(G, 11.19, Y0 - 0.02, 0, 11.25, Y0 + 0.04, 2.16, M.steel_black, { r: 0 });
  bx(G, 10.4, Y0 - 0.02, 2.1, 11.25, Y0 + 0.04, 2.16, M.steel_black, { r: 0 });
  bx(G, 10.46, 15.44, 0, 10.48, 15.55, 2.1, M.white, { r: 0 }); bx(G, 11.17, 15.44, 0, 11.19, 15.55, 2.1, M.white, { r: 0 });
  { const leaf = new THREE.Group(); leaf.position.copy(P(11.17, 15.46, 0)); leaf.rotation.y = -Math.PI / 2 + 0.12; G.add(leaf);
    const fr = (w, h, x, y) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.045), M.steel_black); m.position.set(x, y, 0); m.castShadow = true; leaf.add(m); };
    fr(0.08, 2.04, -0.04, 1.03); fr(0.08, 2.04, -0.66, 1.03); fr(0.7, 0.08, -0.35, 2.01); fr(0.7, 0.2, -0.35, 0.1);
    const gl = new THREE.Mesh(new THREE.PlaneGeometry(0.54, 1.8), M.glass); gl.position.set(-0.35, 1.1, 0); leaf.add(gl);
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.3, 0.03), M.steel); h.position.set(-0.62, 1.05, 0.05); leaf.add(h); }
  bx(G, 11.33, Y0 + 0.0, 1.05, 11.41, Y0 + 0.03, 1.2, M.table_black, { r: 0.005 }); bx(G, 11.33, Y0 + 0.0, 1.28, 11.41, Y0 + 0.03, 1.4, M.table_black, { r: 0.005 });
  { const c = cv(128, 128), ctx = c.getContext('2d'); ctx.fillStyle = '#f2f2f0'; ctx.fillRect(0, 0, 128, 128); ctx.fillStyle = '#151515';
    ctx.beginPath(); ctx.arc(46, 42, 16, 0, 7); ctx.arc(80, 42, 16, 0, 7); ctx.fill(); ctx.fillRect(28, 58, 58, 34); ctx.beginPath(); ctx.moveTo(86, 68); ctx.lineTo(106, 58); ctx.lineTo(106, 92); ctx.lineTo(86, 82); ctx.fill();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; const ic = new THREE.PlaneGeometry(0.24, 0.24); ic.translate(10.82, 1.6, -12.14); put(G, ic, std({ map: t, roughness: 0.6 }), { cast: false }); }
  { const l = new THREE.PointLight(0xffffff, 3, 5, 2); l.position.copy(P(10.8, 13.8, 2.6)); G.add(l); layers.ceiling.push(l); }
  bx(G, 10.4, 15.1, 0.004, 11.25, 15.46, 0.012, M.tile_light, { r: 0 });
  // roller shutters (east roller door, east storage opening) with housings
  const shutter = (axis, c, a, b, h) => { if (axis === 'y') { bx(G, c - 0.03, a, 0.005, c, b, h, M.shutter, { r: 0 }); bx(G, c - 0.32, a - 0.05, h, c, b + 0.05, h + 0.32, M.black_panel, { r: 0.02 }); }
    else { bx(G, a, c - 0.03, 0.005, b, c, h, M.shutter, { r: 0 }); bx(G, a - 0.05, c - 0.32, h - 0.3, b + 0.05, c, h + 0.02, M.black_panel, { r: 0.02 }); } };
  shutter('y', X1 - 0.02, 16.21, 20.71, 3.84); shutter('x', Y1 - 0.02, 13.4, 16.2, 3.33);
  // studio window into the storage/podcast room (west opening)
  bx(G, 6.78, Y1 - 0.05, 0, 9.58, Y1 + 0.02, 0.06, M.steel_black, { r: 0 }); bx(G, 6.78, Y1 - 0.05, 3.29, 9.58, Y1 + 0.02, 3.35, M.steel_black, { r: 0 });
  for (const x of [6.78, 8.15, 9.52]) bx(G, x, Y1 - 0.05, 0, x + 0.06, Y1 + 0.02, 3.35, M.steel_black, { r: 0 });
  { const gl = new THREE.PlaneGeometry(2.8, 3.29); gl.translate(8.18, 1.7, -(Y1 - 0.015)); put(G, gl, M.glass, { cast: false }); }
  // light box signs projecting from the wall
  const signBox = (x, mat) => { const g = new THREE.BoxGeometry(0.1, 0.95, 0.2); g.translate(x, 2.75, -(Y1 - 0.11));
    put(G, g, [mat, mat, M.black_panel, M.black_panel, M.black_panel, M.black_panel], { cast: false }); };
  signBox(6.6, M.frame); signBox(9.74, M.podcast); signBox(13.22, M.flash);
  // colour paper backdrop rolls cascading on the wall between the openings
  { const xa = 10.0, xb = 12.6, n = M.paper.length;
    for (let k = 0; k < n; k++) { const y = Y1 - 0.05 - k * 0.03, z = 3.62 - k * 0.07, bottom = 1.25 + k * 0.13, sx = k * 0.07;
      const roll = new THREE.CylinderGeometry(0.045, 0.045, xb - xa, 20); roll.rotateZ(Math.PI / 2); roll.translate((xa + xb) / 2 + sx, z, -y); put(G, roll, M.paper[k]);
      const sh = new THREE.PlaneGeometry(xb - xa, z - bottom); sh.translate((xa + xb) / 2 + sx, (z + bottom) / 2, -(y - 0.045)); put(G, sh, M.paper[k], { cast: false }); }
    for (const x of [xa - 0.06, xb + 0.66]) bx(G, x, Y1 - 0.4, 2.9, x + 0.04, Y1, 3.7, M.steel_black, { r: 0 }); }
  // basketball hoop on the west wall
  { const cy = 18.3; bx(G, X0, cy - 0.12, 2.9, 4.1, cy + 0.12, 3.02, M.steel_black, { r: 0 });
    const bb = new THREE.BoxGeometry(0.02, 0.9, 1.2); bb.translate(4.12, 3.25, -cy); put(G, bb, M.glass, { cast: false });
    for (const [zA, zB, yA, yB] of [[2.8, 2.83, cy - 0.6, cy + 0.6], [3.67, 3.7, cy - 0.6, cy + 0.6], [2.8, 3.7, cy - 0.6, cy - 0.57], [2.8, 3.7, cy + 0.57, cy + 0.6], [2.92, 2.95, cy - 0.3, cy + 0.3], [3.36, 3.39, cy - 0.3, cy + 0.3], [2.92, 3.39, cy - 0.3, cy - 0.27], [2.92, 3.39, cy + 0.27, cy + 0.3]])
      bx(G, 4.13, yA, zA, 4.14, yB, zB, (zA > 2.9 && zB < 3.4) ? M.rim : M.white, { r: 0 });
    const rim = new THREE.TorusGeometry(0.23, 0.01, 8, 32); rim.rotateX(Math.PI / 2); rim.translate(4.14 + 0.25, 3.05, -cy); put(G, rim, M.rim);
    const net = new THREE.CylinderGeometry(0.23, 0.15, 0.42, 24, 1, true); net.translate(4.39, 2.84, -cy); put(G, net, M.net, { cast: false }); }
  // stage with presentation screen, carpet runner along the south wall
  // stage along the south wall with the LED video wall mounted flat on the wall above it
  bx(G, 5.4, Y0 + 0.02, 0, 10.2, 16.65, 0.3, M.black_panel, { r: 0.008 });
  bx(G, 5.38, 16.65, 0.02, 10.22, 16.67, 0.28, M.tv, { r: 0 });
  bx(G, 5.75, Y0 - 0.02, 1.1, 9.85, Y0 + 0.04, 3.4, M.tv, { r: 0.006 });
  { const sc = new THREE.PlaneGeometry(4.0, 2.2); sc.rotateY(Math.PI); sc.translate(7.8, 2.25, -(Y0 + 0.045)); put(G, sc, M.slide, { cast: false }); }
  for (const x of [6.3, 9.3]) { const st = new THREE.CylinderGeometry(0.2, 0.2, 0.05, 20); st.translate(x, 1.06, -16.1); put(G, st, M.cushion_dark);
    bx(G, x - 0.18, 16.0, 0.3, x - 0.16, 16.2, 1.03, M.steel_black, { r: 0 }); bx(G, x + 0.16, 16.0, 0.3, x + 0.18, 16.2, 1.03, M.steel_black, { r: 0 });
    bx(G, x - 0.18, 15.93, 0.55, x + 0.18, 15.95, 0.57, M.steel_black, { r: 0 }); }
  bx(G, 10.35, Y0 + 0.02, 0.004, 15.0, 16.45, 0.016, M.carpet, { r: 0 }); bx(G, 10.35, 16.45, 0.004, 15.0, 16.48, 0.02, M.metal, { r: 0 });
  // exposed concrete soffit, two downstand beams, honeycomb LED fields
  patch(G, X0, Y0, X1, Y1, H, M.concrete_soffit, { layer: 'ceiling' });
  for (const y of [16.35, 20.2]) bx(G, X0, y - 0.18, H - 0.38, X1, y + 0.18, H, M.concrete_soffit, { r: 0, layer: 'ceiling', cast: false });
  hexOutline(G, 7.6, 18.3, 3.72, 0.42, 7, 3, M.led_cool); hexOutline(G, 12.4, 18.3, 3.72, 0.42, 7, 3, M.led_cool);
  for (const [x, y] of [[5.3, 17.5], [5.3, 19.1], [10.0, 17.5], [10.0, 19.1], [14.7, 17.5], [14.7, 19.1]]) hangWire(G, x, y, 3.72, H - 0.38);
  for (const x of [4.0, 16.0]) bx(G, x, 16.65, H - 0.42, x + 0.04, 19.95, H - 0.4, M.led_cool, { r: 0, layer: 'ceiling', cast: false });
  for (const [x, y] of [[7.6, 18.3], [12.4, 18.3]]) { const l = new THREE.PointLight(0xf4f8ff, 10, 11, 2); l.position.copy(P(x, y, 3.5)); G.add(l); layers.ceiling.push(l); }
}

// ================================================================== STORAGE (ground floor) - west to east: photo cyc > podcast set > black podcast desks
{
  const G = space('Storage studio', 'GF'), X0 = 3.525, X1 = 16.52, Y0 = 21.15, Y1 = 25.545, H = 4.175;
  // textures / materials for this room
  const ribs = (() => { const c = cv(512, 128), ctx = c.getContext('2d'); ctx.fillStyle = '#111214'; ctx.fillRect(0, 0, 512, 128); ctx.fillStyle = '#e0682a';
    for (let k = 0; k < 16; k++) ctx.fillRect(k * 32, 0, 3, 128); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const ball = (() => { const c = cv(256, 128), ctx = c.getContext('2d'); ctx.fillStyle = '#d86a28'; ctx.fillRect(0, 0, 256, 128); ctx.strokeStyle = '#2a160c'; ctx.lineWidth = 3;
    for (const x of [64, 192]) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 128); ctx.stroke(); } ctx.beginPath(); ctx.moveTo(0, 64); ctx.lineTo(256, 64); ctx.stroke();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const R = {
    cyc: std({ color: 0xf2f2f0, roughness: 0.95, emissive: 0xffffff, emissiveIntensity: 0.03, side: THREE.DoubleSide }),
    ribs: std({ map: ribs, roughness: 0.7, side: THREE.DoubleSide }),
    darkOak: std({ color: 0x3a3542, map: T.planks, roughness: 0.55, envMapIntensity: 0.8 }),
    blackWood: std({ color: 0x3b3b3e, map: T.oakDark, roughness: 0.6 }),
    purple: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 0.35, 3.0) }),
    blue: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 1.1, 3.0) }),
    lantern: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.4, 2.3) }),
    duct: std({ color: 0xc9cbcd, roughness: 0.35, metalness: 0.9 }),
    gold: std({ color: 0xc9a24a, roughness: 0.3, metalness: 1 }),
    ball: std({ map: ball, roughness: 0.7 }),
    props: [0x6b3fd1, 0xf2f2f0, 0xc2302a, 0x2b6fd6, 0x1a1a1c, 0xe0b04a, 0x7d7f82].map(c => std({ color: c, roughness: 0.45, metalness: 0.2 })),
  };

  // ---- floors: studio timber for the cyc + podcast zones, dark stained oak under the desks
  patch(G, X0, Y0, 11.9, Y1, 0.004, M.studio_floor);
  patch(G, 11.9, Y0, X1, Y1, 0.004, R.darkOak);

  // ---- 1. PHOTO AREA: white infinity cove wrapping the north-west corner
  { const Rc = 0.6, xw = 3.58, yn = 25.5, xe = 7.8, ys = 22.4, top = 3.6;
    const back = new THREE.PlaneGeometry(xe - (xw + Rc), top - Rc); back.translate((xw + Rc + xe) / 2, (top + Rc) / 2, -yn); put(G, back, R.cyc, { cast: false });
    const side = new THREE.PlaneGeometry((yn - Rc) - ys, top - Rc); side.rotateY(Math.PI / 2); side.translate(xw, (top + Rc) / 2, -(ys + yn - Rc) / 2); put(G, side, R.cyc, { cast: false });
    const cn = new THREE.CylinderGeometry(Rc, Rc, xe - (xw + Rc), 20, 1, true, Math.PI, Math.PI / 2); cn.rotateZ(Math.PI / 2); cn.translate((xw + Rc + xe) / 2, Rc, -(yn - Rc)); put(G, cn, R.cyc, { cast: false });
    const cw = new THREE.CylinderGeometry(Rc, Rc, (yn - Rc) - ys, 20, 1, true, Math.PI * 1.5, Math.PI / 2); cw.rotateX(Math.PI / 2); cw.translate(xw + Rc, Rc, -(ys + yn - Rc) / 2); put(G, cw, R.cyc, { cast: false });
    const cv2 = new THREE.CylinderGeometry(Rc, Rc, top - Rc, 20, 1, true, Math.PI, Math.PI / 2); cv2.translate(xw + Rc, (top + Rc) / 2, -(yn - Rc)); put(G, cv2, R.cyc, { cast: false });
    const oct = new THREE.SphereGeometry(Rc, 20, 10, Math.PI * 1.5, Math.PI / 2, Math.PI / 2, Math.PI / 2); oct.translate(xw + Rc, Rc, -(yn - Rc)); put(G, oct, R.cyc, { cast: false });
    patch(G, xw + Rc, 23.3, xe, yn - Rc, 0.008, R.cyc); patch(G, xw, ys, xw + Rc, 23.3, 0.008, R.cyc);
    bx(G, xe, yn - 0.06, 0, xe + 0.05, yn, top, R.cyc, { r: 0 });
    // black wall above the cyc, and the black partition with blue floor glow between cyc and felt
    lining(G, 'x', Y1 - 0.012, X0, 7.85, top, H, [], M.black_panel); lining(G, 'y', X0, Y0, Y1, top, H, [], M.black_panel);
    lining(G, 'y', X0, Y0, ys, 0, top, [], M.black_panel);
    bx(G, 7.85, 25.2, 0, 8.08, Y1, 3.4, M.black_panel, { r: 0 });
    // ceiling rail grid, silver ducts, parabolic ribbed softbox and white octagon softbox
    for (const y of [22.6, 24.7]) bx(G, X0, y - 0.03, H - 0.3, 11.9, y + 0.03, H - 0.24, M.steel_black, { r: 0, layer: 'ceiling', cast: false });
    for (const x of [4.4, 7.2]) bx(G, x - 0.03, 22.6, H - 0.36, x + 0.03, 24.7, H - 0.3, M.steel_black, { r: 0, layer: 'ceiling', cast: false });
    { const d = new THREE.CylinderGeometry(0.16, 0.16, 8.3, 20); d.rotateZ(Math.PI / 2); d.translate(7.7, H - 0.5, -25.1); put(G, d, R.duct, { layer: 'ceiling', cast: false }); }
    { const dome = new THREE.SphereGeometry(0.5, 32, 10, 0, Math.PI * 2, 0, Math.PI * 0.46); const m = new THREE.Mesh(dome, R.ribs); m.position.copy(P(5.9, 23.7, 2.95)); m.rotation.set(0.5, 0, 0.35); m.castShadow = true; G.add(m);
      const df = new THREE.Mesh(new THREE.CircleGeometry(0.5 * Math.sin(Math.PI * 0.46), 32), M.softbox_in); df.rotation.x = Math.PI / 2; df.position.y = 0.5 * Math.cos(Math.PI * 0.46); m.add(df);
      bx(G, 5.8, 23.6, 3.25, 6.0, 23.8, 3.55, M.steel_black, { r: 0.02 }); hangWire(G, 5.9, 23.7, 3.55, H - 0.3);
      const oc = new THREE.CircleGeometry(0.45, 8); oc.translate(6.9, 2.55, -24.55); put(G, oc, M.softbox_in, { cast: false });
      const ob = new THREE.CylinderGeometry(0.45, 0.1, 0.25, 8, 1, true); ob.rotateX(-Math.PI / 2); ob.translate(6.9, 2.55, -24.68); put(G, ob, M.table_black);
      hangWire(G, 6.9, 24.7, 2.8, H - 0.3); bx(G, 9.2, 24.68, 1.6, 9.23, 24.72, H - 0.3, M.metal, { r: 0 });
      const kl = new THREE.SpotLight(0xffffff, 7, 9, 0.9, 0.8, 2); kl.position.copy(P(5.9, 23.5, 2.8)); kl.target.position.copy(P(5.0, 25.0, 0.5)); G.add(kl, kl.target); layers.ceiling.push(kl); }
  }

  // ---- 2. PODCAST SET: arched felt wall, boucle chairs, black oval table, mics, C-stand softbox
  { const cx = 10.1;
    for (let k = 0; k < 3; k++) { const x = 8.1 + k * 1.205; const g = new THREE.BoxGeometry(1.2, 2.75, 0.03); g.translate(x + 0.6, 1.375 + 0.02, -(Y1 - 0.02)); put(G, g, M.felt); }
    bx(G, 7.85, Y1 - 0.04, 2.8, 11.75, Y1 - 0.005, 3.4, M.black_panel, { r: 0 });
    lining(G, 'x', Y1 - 0.012, 7.85, 11.75, 3.4, H, [], M.black_panel);
    bx(G, 7.9, Y1 - 0.08, 0.004, 11.75, Y1 - 0.05, 0.02, R.blue, { r: 0, cast: false });
    { const r = new THREE.PlaneGeometry(3.3, 2.1); r.rotateX(-Math.PI / 2); r.translate(cx, 0.012, -24.15); put(G, r, M.rug, { cast: false }); }
    const tub = () => { const g = new THREE.Group(), add = (geo) => { const m = new THREE.Mesh(geo, M.boucle); m.castShadow = m.receiveShadow = true; g.add(m); return m; };
      add(new RoundedBoxGeometry(0.78, 0.36, 0.72, 4, 0.14)).position.y = 0.2;
      add(new RoundedBoxGeometry(0.78, 0.46, 0.2, 4, 0.1)).position.set(0, 0.55, 0.28);
      for (const sx of [-0.3, 0.3]) { const a = add(new RoundedBoxGeometry(0.2, 0.3, 0.66, 4, 0.1)); a.position.set(sx, 0.5, 0.02); }
      add(new RoundedBoxGeometry(0.46, 0.1, 0.5, 3, 0.05)).position.set(0, 0.42, -0.05); return g; };
    const t1 = tub(); t1.position.copy(P(cx - 0.75, 24.45, 0)); t1.rotation.y = yawToward(0.45, -1); G.add(t1);
    const t2 = tub(); t2.position.copy(P(cx + 0.75, 24.45, 0)); t2.rotation.y = yawToward(-0.45, -1); G.add(t2);
    const top = new THREE.CylinderGeometry(0.5, 0.5, 0.025, 48); top.scale(1, 1, 0.55); top.translate(cx, 0.47, -24.05); put(G, top, M.table_black);
    for (let k = 0; k < 3; k++) { const a = k * Math.PI * 2 / 3 + 0.3, x = cx + Math.cos(a) * 0.36, y = 24.05 + Math.sin(a) * 0.18; bx(G, x - 0.01, y - 0.01, 0, x + 0.01, y + 0.01, 0.46, M.steel_black, { r: 0 }); }
    bx(G, cx - 0.2, 23.98, 0.483, cx + 0.2, 24.14, 0.53, M.steel_black, { r: 0.008 });
    for (const [x, dir] of [[cx - 0.4, -1], [cx + 0.4, 1]]) { bx(G, x - 0.012, 23.9, 0.48, x + 0.012, 23.92, 0.95, M.steel_black, { r: 0 });
      const arm = new THREE.CylinderGeometry(0.01, 0.01, 0.5, 8); arm.rotateZ(Math.PI / 2 - dir * 0.5); arm.translate(x + dir * 0.2, 1.05, -23.91); put(G, arm, M.steel_black);
      const mic = new THREE.CylinderGeometry(0.028, 0.024, 0.16, 16); mic.rotateX(0.9); mic.translate(x + dir * 0.42, 1.13, -24.0); put(G, mic, M.steel_black);
      const hp = new THREE.TorusGeometry(0.085, 0.012, 8, 20, Math.PI); hp.translate(x + dir * 0.42, 1.0, -23.93); put(G, hp, M.steel_black); }
    const bx0 = 8.35, by0 = 22.9;
    for (let k = 0; k < 3; k++) { const a = k * Math.PI * 2 / 3; const leg = new THREE.CylinderGeometry(0.012, 0.012, 0.8, 6); leg.rotateZ(1.0); leg.rotateY(a); leg.translate(bx0 + Math.cos(a) * 0.3, 0.2, -(by0 + Math.sin(a) * 0.3)); put(G, leg, M.metal); }
    { const pole = new THREE.CylinderGeometry(0.018, 0.022, 3.0, 10); pole.translate(bx0, 1.6, -by0); put(G, pole, M.metal); }
    const boom = new THREE.CylinderGeometry(0.014, 0.014, 1.6, 8); boom.rotateZ(Math.PI / 2); boom.rotateY(-0.45); boom.translate(bx0 + 0.68, 3.0, -(by0 + 0.32)); put(G, boom, M.metal);
    const dm = new THREE.Mesh(new THREE.SphereGeometry(0.7, 32, 10, 0, Math.PI * 2, 0, Math.PI * 0.42), M.table_black); dm.position.copy(P(9.4, 23.55, 2.35)); dm.rotation.set(0.35, 0, -0.45); dm.castShadow = true; G.add(dm);
    const df = new THREE.Mesh(new THREE.CircleGeometry(0.7 * Math.sin(Math.PI * 0.42), 32), M.softbox_in); df.rotation.x = Math.PI / 2; df.position.y = 0.7 * Math.cos(Math.PI * 0.42); dm.add(df);
    const kl = new THREE.SpotLight(0xffffff, 10, 8, 0.8, 0.7, 2); kl.position.copy(P(9.4, 23.55, 2.2)); kl.target.position.copy(P(cx, 24.3, 0.3)); G.add(kl, kl.target); layers.ceiling.push(kl);
  }

  // ---- 3. BLACK PODCAST DESKS: L-shaped black counter, arched shelving with purple LED, lantern + softbox
  { lining(G, 'x', Y1 - 0.012, 11.75, X1, 0, H, [], M.black_panel);
    lining(G, 'y', X1 - 0.012, Y0 + 0.05, Y1, 0, H, [], M.black_panel);
    bx(G, 11.75, Y1 - 0.06, 0.004, 12.35, Y1 - 0.03, 0.03, R.purple, { r: 0, cast: false }); bx(G, X1 - 0.05, Y0 + 0.1, 0.004, X1 - 0.02, 21.85, 0.03, R.purple, { r: 0, cast: false });
    // L desk: north run + east run, black wood-grain fronts with an inset purple strip, dark top
    const Hd = 1.0;
    bx(G, 12.4, 24.25, 0, 15.9, 24.9, Hd - 0.04, R.blackWood, { r: 0.005 }); bx(G, 15.2, 21.9, 0, 15.9, 24.25, Hd - 0.04, R.blackWood, { r: 0.005 });
    bx(G, 12.35, 24.2, Hd - 0.04, 15.95, 24.95, Hd, M.table_black, { r: 0.006 }); bx(G, 15.15, 21.85, Hd - 0.04, 15.95, 24.2, Hd, M.table_black, { r: 0.006 });
    bx(G, 12.5, 24.235, 0.8, 15.12, 24.25, 0.86, R.purple, { r: 0, cast: false }); bx(G, 15.185, 21.95, 0.8, 15.2, 24.1, 0.86, R.purple, { r: 0, cast: false });
    // arched shelving units (local x runs along the wall, +z points into the room)
    const archUnit = (len, arches) => { const u = new THREE.Group(), add = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = m.receiveShadow = true; u.add(m); return m; };
      const w = len / arches, z0 = Hd, zTop = 2.35;
      for (let a = 0; a < arches; a++) { const xa = a * w, r = w / 2 - 0.03, cxA = xa + w / 2;
        const sh = new THREE.Shape(); sh.moveTo(xa + 0.02, z0); sh.lineTo(xa + w - 0.02, z0); sh.lineTo(xa + w - 0.02, zTop); sh.absarc(cxA, zTop, r + 0.01, 0, Math.PI, false); sh.lineTo(xa + 0.02, z0);
        add(new THREE.ExtrudeGeometry(sh, { depth: 0.02, bevelEnabled: false, curveSegments: 32 }), M.black_panel);
        const rim = new THREE.TorusGeometry(r, 0.03, 8, 40, Math.PI); rim.translate(cxA, zTop, 0.15); add(rim, M.black_panel);
        const glow = new THREE.TorusGeometry(r - 0.035, 0.008, 6, 40, Math.PI); glow.translate(cxA, zTop, 0.05); add(glow, R.purple).castShadow = false;
        for (const sx of [xa + 0.02, xa + w - 0.05]) add(new THREE.BoxGeometry(0.03, zTop - z0, 0.3), M.black_panel).position.set(sx + 0.015, (z0 + zTop) / 2, 0.15);
        for (const [k, zs] of [[0, 1.35], [1, 1.72], [2, 2.08]].map(p => p)) { const s = add(new THREE.BoxGeometry(w - 0.08, 0.03, 0.28), M.black_panel); s.position.set(cxA, zs, 0.15);
          const led = add(new THREE.BoxGeometry(w - 0.1, 0.008, 0.01), R.purple); led.position.set(cxA, zs - 0.02, 0.28); led.castShadow = false;
          // props: generic collectibles, trophies, figures, model cars, books, a ball
          let px = xa + 0.14; while (px < xa + w - 0.2) { const t = Math.floor(rnd() * 6), m = R.props[Math.floor(rnd() * R.props.length)];
            let o; if (t === 0) { o = add(new THREE.SphereGeometry(0.1, 20, 12), R.ball); o.position.set(px + 0.1, zs + 0.115, 0.15); px += 0.28; }
            else if (t === 1) { o = add(new THREE.CylinderGeometry(0.035, 0.05, 0.16, 12), R.gold); o.position.set(px + 0.05, zs + 0.095, 0.15); add(new THREE.SphereGeometry(0.045, 12, 8), R.gold).position.set(px + 0.05, zs + 0.2, 0.15); px += 0.2; }
            else if (t === 2) { o = add(new RoundedBoxGeometry(0.22, 0.06, 0.1, 2, 0.02), m); o.position.set(px + 0.11, zs + 0.045, 0.15); px += 0.3; }
            else if (t === 3) { for (let b = 0; b < 2; b++) { o = add(new THREE.BoxGeometry(0.15, 0.22, 0.012), M.art[Math.floor(rnd() * 3)]); o.position.set(px + 0.08 + b * 0.16, zs + 0.125, 0.06); o.rotation.x = -0.12; } px += 0.36; }
            else if (t === 4) { o = add(new THREE.CapsuleGeometry(0.035, 0.1, 4, 10), m); o.position.set(px + 0.05, zs + 0.1, 0.15); px += 0.18; }
            else { o = add(new RoundedBoxGeometry(0.26, 0.09, 0.1, 2, 0.035), m); o.position.set(px + 0.13, zs + 0.06, 0.15); px += 0.34; } } }
      }
      return u; };
    const nU = archUnit(3.5, 2); nU.position.copy(P(12.45, Y1 - 0.015, 0)); G.add(nU);
    const eU = archUnit(2.95, 2); eU.position.copy(P(X1 - 0.015, 25.0, 0)); eU.rotation.y = -Math.PI / 2; G.add(eU);
    // desk kit: four mics with headphones, mixer, corner prompter screen
    for (const [x, y] of [[12.9, 24.55], [14.1, 24.55], [15.55, 23.6], [15.55, 22.5]]) {
      const b = new THREE.CylinderGeometry(0.07, 0.08, 0.02, 20); b.translate(x, Hd + 0.01, -y); put(G, b, M.steel_black);
      const st = new THREE.CylinderGeometry(0.008, 0.008, 0.3, 8); st.translate(x, Hd + 0.17, -y); put(G, st, M.steel_black);
      const mc = new THREE.CylinderGeometry(0.03, 0.026, 0.15, 16); mc.rotateX(0.35); mc.translate(x, Hd + 0.36, -y); put(G, mc, M.steel_black);
      const hp = new THREE.TorusGeometry(0.08, 0.012, 8, 20, Math.PI); hp.rotateX(-Math.PI / 2 + 0.2); hp.translate(x + 0.32, Hd + 0.03, -y); put(G, hp, M.steel_black); }
    bx(G, 15.25, 24.35, Hd, 15.7, 24.7, Hd + 0.06, M.steel_black, { r: 0.008 });
    { const pr = new THREE.Group(); pr.position.copy(P(15.5, 24.55, Hd)); pr.rotation.y = Math.PI / 4; G.add(pr);
      const gl = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.7), M.glass); gl.position.set(0, 0.55, 0); pr.add(gl);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.26), M.slide); scr.position.set(0, 0.45, -0.02); scr.rotation.y = Math.PI; pr.add(scr);
      const fr = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.04, 0.12), M.steel_black); fr.position.set(0, 0.2, 0); pr.add(fr); }
    // hanging lantern ball light and an orange-ribbed softbox
    { const l = new THREE.SphereGeometry(0.42, 32, 20); l.translate(15.0, 2.85, -23.1); put(G, l, R.lantern, { cast: false });
      hangWire(G, 15.0, 23.1, 3.27, H); const pl = new THREE.PointLight(0xffffff, 8, 8, 2); pl.position.copy(P(15.0, 23.1, 2.5)); G.add(pl); layers.ceiling.push(pl);
      const sb = new THREE.CylinderGeometry(0.42, 0.08, 0.55, 12, 1, true); const sm = new THREE.Mesh(sb, R.ribs); sm.position.copy(P(12.8, 22.7, 3.0)); sm.rotation.set(-0.9, 0, 0.5); G.add(sm);
      const face = new THREE.Mesh(new THREE.CircleGeometry(0.42, 12), M.softbox_in); face.rotation.x = Math.PI / 2; face.position.y = -0.276; sm.add(face);
      hangWire(G, 12.8, 22.7, 3.25, H);
      for (const [x, y] of [[13.6, 23.4], [15.2, 24.0]]) { const p = new THREE.PointLight(0x9d45ff, 3.5, 4, 2); p.position.copy(P(x, y, 0.9)); G.add(p); layers.ceiling.push(p); } }
  }

  // ---- exposed soffit over the whole room
  patch(G, X0, Y0, X1, Y1, H, M.concrete_soffit, { layer: 'ceiling' });
}

// ================================================================== UPPER KITCHEN (left) + DINING NOOK (right) - from the kitchen photos
{
  const G = space('Kitchen', 'UF'), z0 = UFZ, zc = UFZ + 2.98;
  const K = {
    black: std({ color: 0x1f2022, roughness: 0.62 }),
    stone: std({ color: 0x141517, roughness: 0.35, normalMap: T.renderN, normalScale: new THREE.Vector2(0.2, 0.2) }),
    marble: std({ color: 0xffffff, map: T.marble, roughness: 0.22, envMapIntensity: 0.9 }),
    blue: std({ color: 0x3574a3, roughness: 0.9 }),
    blueSeat: std({ color: 0x1f5b8a, roughness: 0.38, envMapIntensity: 0.8 }),
    blueBack: std({ color: 0x24506f, normalMap: T.weaveN, roughness: 0.95 }),
    tweed: std({ color: 0xbfbcb6, normalMap: T.weaveN, roughness: 1 }),
    red: std({ color: 0xb3161b, roughness: 0.45 }), steel: std({ color: 0xd9dadb, roughness: 0.2, metalness: 1 }),
    jar: new THREE.MeshPhysicalMaterial({ color: 0xe8efe9, transparent: true, opacity: 0.3, roughness: 0.05, depthWrite: false }),
    flower: std({ color: 0xf2c24a, roughness: 0.7 }),
  };
  const kb = (x0, y0, a, x1, y1, b, mat, opts) => bx(G, x0, y0, z0 + a, x1, y1, z0 + b, mat, opts);   // heights relative to the upper floor
  // floor, black walls
  patch(G, 6.44, 20.19, 12.62, 25.78, z0 + 0.004, M.chevron);
  patch(G, 12.62, 21.39, 16.52, 25.78, z0 + 0.004, M.chevron);
  lining(G, 'x', 25.772, 6.44, 12.54, z0, zc, [], K.black);
  lining(G, 'y', 6.44, 20.19, 25.78, z0, zc, [], K.black);
  // ---- LEFT: kitchen. Base runs along the back (north) and left (west) walls
  const doors = (x0, y0, x1, y1, a, b, along = 'x', w = 0.6) => { const L = along === 'x' ? x1 - x0 : y1 - y0, n = Math.max(1, Math.round(L / w)), s = L / n;
    for (let k = 0; k < n; k++) { const q0 = k * s + 0.002, q1 = (k + 1) * s - 0.002; if (along === 'x') kb(x0 + q0, y0, a, x0 + q1, y1, b, K.black, { r: 0.003 }); else kb(x0, y0 + q0, a, x1, y0 + q1, b, K.black, { r: 0.003 }); } };
  kb(6.45, 25.2, 0, 10.8, 25.77, 0.1, M.table_black, { r: 0 }); doors(6.45, 25.2, 10.8, 25.77, 0.1, 0.87);
  kb(6.45, 20.8, 0, 7.05, 25.2, 0.1, M.table_black, { r: 0 }); doors(6.45, 21.85, 7.05, 25.2, 0.1, 0.87, 'y');
  kb(6.43, 25.18, 0.87, 10.82, 25.78, 0.9, K.stone, { r: 0.004 }); kb(6.44, 21.85, 0.87, 7.07, 25.18, 0.9, K.stone, { r: 0.004 });
  // tall oven column on the left wall
  kb(6.45, 20.8, 0, 7.05, 21.85, 2.98, K.black, { r: 0.003 }); kb(7.05, 21.0, 0.9, 7.06, 21.65, 1.5, M.tv, { r: 0 }); kb(7.06, 21.05, 1.45, 7.09, 21.6, 1.47, K.steel, { r: 0 });
  // stone splashback and upper cabinets to the ceiling with a warm LED line underneath
  kb(6.45, 25.74, 0.9, 10.8, 25.77, 1.52, K.stone, { r: 0 }); kb(6.45, 21.85, 0.9, 6.48, 25.74, 1.52, K.stone, { r: 0 });
  doors(6.45, 25.38, 10.8, 25.77, 1.55, 2.98); doors(6.45, 21.85, 6.84, 25.38, 1.55, 2.98, 'y');
  kb(6.5, 25.36, 1.535, 10.75, 25.39, 1.545, M.led, { r: 0, cast: false }); kb(6.83, 21.9, 1.535, 6.86, 25.36, 1.545, M.led, { r: 0, cast: false });
  { const l = new THREE.PointLight(0xffc98a, 3, 3.5, 2); l.position.copy(P(8.6, 25.2, z0 + 1.35)); G.add(l); layers.ceiling.push(l); }
  // tall integrated fridge / pantry doors with long black bar handles, then the lit marble niche
  kb(10.85, 25.2, 0, 11.75, 25.77, 0.1, M.table_black, { r: 0 });
  kb(10.85, 25.2, 0.1, 11.29, 25.77, 2.2, K.black, { r: 0.003 }); kb(11.31, 25.2, 0.1, 11.75, 25.77, 2.2, K.black, { r: 0.003 });
  kb(10.85, 25.2, 2.22, 11.75, 25.77, 2.98, K.black, { r: 0.003 });
  kb(11.24, 25.15, 0.9, 11.26, 25.18, 1.9, M.steel_black, { r: 0 }); kb(11.34, 25.15, 0.9, 11.36, 25.18, 1.9, M.steel_black, { r: 0 });
  kb(11.8, 25.2, 0, 12.53, 25.77, 0.87, K.black, { r: 0.003 }); kb(11.78, 25.18, 0.87, 12.54, 25.78, 0.9, K.stone, { r: 0 });
  kb(11.78, 25.72, 0.9, 12.53, 25.76, 2.6, K.marble, { r: 0 }); kb(11.78, 25.2, 2.6, 12.54, 25.77, 2.98, K.black, { r: 0 });
  for (const zs of [1.45, 2.0]) { kb(11.8, 25.35, zs, 12.52, 25.72, zs + 0.035, M.table_black, { r: 0 }); kb(11.82, 25.36, zs - 0.012, 12.5, 25.38, zs, M.led, { r: 0, cast: false }); }
  kb(11.8, 25.35, 2.58, 12.52, 25.72, 2.6, M.led, { r: 0, cast: false });
  for (let k = 0; k < 2; k++) kb(12.08 + k * 0.2, 25.48, 2.035, 12.25 + k * 0.2, 25.6, 2.33, K.red, { r: 0.01 });
  kb(11.86, 25.5, 2.035, 12.0, 25.6, 2.28, M.white, { r: 0.01 });
  for (const x of [11.95, 12.2, 12.42]) { const j = new THREE.CylinderGeometry(0.05, 0.05, 0.15, 16); j.translate(x, z0 + 1.56, -25.55); put(G, j, K.jar); }
  { const l = new THREE.PointLight(0xffd7a0, 2.5, 2.5, 2); l.position.copy(P(12.15, 25.5, z0 + 1.9)); G.add(l); layers.ceiling.push(l); }
  // sink with gooseneck tap, espresso machine, grinder, glass cake display, flowers
  kb(7.9, 25.3, 0.895, 8.5, 25.65, 0.9, M.tv, { r: 0 });
  { const t = new THREE.CylinderGeometry(0.014, 0.014, 0.42, 10); t.translate(8.2, z0 + 1.11, -25.68); put(G, t, K.steel);
    const arc = new THREE.TorusGeometry(0.12, 0.012, 8, 20, Math.PI); arc.rotateY(Math.PI / 2); arc.translate(8.2, z0 + 1.32, -25.56); put(G, arc, K.steel); }
  kb(9.55, 25.35, 0.9, 10.35, 25.72, 1.35, M.white, { r: 0.02 }); kb(9.58, 25.33, 1.05, 10.32, 25.36, 1.2, K.steel, { r: 0 });
  for (const x of [9.72, 9.95, 10.18]) { const g = new THREE.CylinderGeometry(0.03, 0.03, 0.08, 12); g.translate(x, z0 + 1.0, -25.3); put(G, g, M.steel_black); }
  kb(9.2, 25.45, 0.9, 9.42, 25.65, 1.3, M.steel_black, { r: 0.02 });
  { const c = new THREE.BoxGeometry(0.5, 0.28, 0.32); c.translate(7.35, z0 + 1.04, -25.55); put(G, c, K.jar); }
  { const v = new THREE.CylinderGeometry(0.06, 0.05, 0.2, 16); v.translate(8.8, z0 + 1.0, -25.55); put(G, v, M.ceramic);
    const fl = []; for (let k = 0; k < 26; k++) { const s2 = new THREE.SphereGeometry(0.03, 8, 6); s2.translate(8.8 + (rnd() - 0.5) * 0.3, z0 + 1.2 + rnd() * 0.25, -25.55 + (rnd() - 0.5) * 0.2); fl.push(s2.ni()); }
    put(G, mergeGeometries(fl), K.flower); }
  // island: black body, marble top with waterfall end facing the room
  kb(8.55, 22.5, 0, 11.3, 23.4, 0.87, K.black, { r: 0.003 });
  kb(8.5, 22.4, 0.87, 11.36, 23.45, 0.93, K.marble, { r: 0.004 });
  kb(11.3, 22.4, 0, 11.36, 23.45, 0.87, K.marble, { r: 0.003 });
  // rattan bar stools down the left side of the island
  { const proto = makeStool(); for (let k = 0; k < 5; k++) { const s2 = proto.clone(); s2.position.copy(P(8.95 + k * 0.52, 21.95, z0)); s2.rotation.y = 0; G.add(s2); } }
  // linear black pendant over the island
  kb(8.75, 22.89, 2.28, 11.1, 22.96, 2.34, M.steel_black, { r: 0.005, layer: 'ceiling', cast: false }); kb(8.77, 22.905, 2.275, 11.08, 22.945, 2.28, M.led_cool, { r: 0, layer: 'ceiling', cast: false });
  hangWire(G, 9.1, 22.93, z0 + 2.34, zc); hangWire(G, 10.75, 22.93, z0 + 2.34, zc);
  { const geos = []; for (const [x, y] of [[7.6, 22.2], [7.6, 24.3], [10.9, 22.2], [10.9, 24.0], [8.9, 25.0]]) { const c = new THREE.CylinderGeometry(0.045, 0.045, 0.01, 16); c.translate(x, zc - 0.02, -y); geos.push(c.ni()); }
    put(G, mergeGeometries(geos), M.led_cool, { cast: false, layer: 'ceiling' }); }
  // south pantry kept as black tall cabinets
  kb(7.55, 20.21, 0, 9.25, 20.78, 2.2, K.black, { r: 0.003 }); kb(7.55, 20.21, 2.2, 9.25, 20.78, 2.98, K.black, { r: 0.003 });

  // ---- RIGHT: dining nook with blue banquette, black walls, window, TV
  lining(G, 'x', 25.772, 12.65, 16.52, z0 + 1.05, zc, [], K.blue);
  lining(G, 'x', 25.772, 12.65, 16.52, z0, z0 + 1.05, [], K.black);
  { const wins = DATA.windows.filter(w => w.f === 'UF' && w.a[0] > 16 && Math.min(w.a[1], w.b[1]) > 21.3).map(w => [Math.min(w.a[1], w.b[1]), Math.max(w.a[1], w.b[1]), UFZ + w.sill, UFZ + w.head]);
    lining(G, 'y', 16.508, 21.4, 25.78, z0, zc, wins, K.black); }
  lining(G, 'x', 21.4, 13.65, 16.52, z0, zc, [], K.black);
  // blue soffit over the banquette
  kb(12.65, 24.55, 2.62, 16.52, 25.77, 2.98, K.blue, { r: 0 }); kb(12.65, 24.53, 2.6, 16.52, 24.57, 2.98, M.steel_black, { r: 0 });
  // banquette: oak plinth, blue leather seat, upholstered blue back in two sections
  kb(12.75, 25.25, 0, 16.45, 25.72, 0.2, M.chevron, { r: 0 }); kb(12.72, 25.2, 0.2, 16.47, 25.77, 0.46, K.blueSeat, { r: 0.03 });
  kb(12.75, 25.6, 0.46, 14.58, 25.76, 1.05, K.blueBack, { r: 0.03 }); kb(14.62, 25.6, 0.46, 16.45, 25.76, 1.05, K.blueBack, { r: 0.03 });
  // marble tables with black pedestal bases
  const table = (cx, cy, w, d) => { kb(cx - w / 2, cy - d / 2, 0.72, cx + w / 2, cy + d / 2, 0.75, K.marble, { r: 0.004 });
    const p = new THREE.CylinderGeometry(0.035, 0.035, 0.7, 12); p.translate(cx, z0 + 0.36, -cy); put(G, p, M.steel_black);
    const b = new THREE.CylinderGeometry(0.24, 0.26, 0.03, 28); b.translate(cx, z0 + 0.015, -cy); put(G, b, M.steel_black); };
  // dining chair: black timber frame, curved rattan back, tweed seat
  const dchair = () => { const g = new THREE.Group(), add = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = m.receiveShadow = true; g.add(m); return m; };
    for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) { const l = add(new THREE.CylinderGeometry(0.016, 0.013, 0.46, 8), M.steel_black); l.position.set(x * 1.05, 0.23, z * 1.05); }
    add(new RoundedBoxGeometry(0.48, 0.07, 0.46, 3, 0.02), K.tweed).position.y = 0.48;
    const sh = new THREE.CylinderGeometry(0.3, 0.3, 0.2, 32, 1, true, Math.PI * 1.25, Math.PI * 1.5);
    { const uv = sh.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 1.4 / 0.12, uv.getY(i) * 0.2 / 0.12); }
    add(sh, M.rattan).position.y = 0.66;
    const rim = add(new THREE.TorusGeometry(0.3, 0.018, 8, 48, Math.PI * 1.5), M.steel_black); rim.rotation.x = Math.PI / 2; rim.rotation.z = -Math.PI * 0.25; rim.position.y = 0.77;
    for (const a of [Math.PI * 1.25, Math.PI * 2.75]) { const p = add(new THREE.CylinderGeometry(0.015, 0.015, 0.3, 8), M.steel_black); p.position.set(0.3 * Math.sin(a), 0.62, 0.3 * Math.cos(a)); }
    return g; };
  const dc = dchair();
  for (const cx of [13.55, 15.35]) { table(cx, 24.85, 1.25, 0.62); for (const dx of [-0.32, 0.32]) place(dc, G, cx + dx, 24.12, z0, yawToward(0, 1)); }
  for (const [cx, cy] of [[14.1, 22.55], [15.65, 23.05]]) { table(cx, cy, 0.7, 0.7); place(dc, G, cx - 0.62, cy, z0, yawToward(1, 0)); place(dc, G, cx + 0.62, cy, z0, yawToward(-1, 0)); }
  // wall TV on the south wall, downlights
  kb(14.0, 21.41, 1.35, 15.7, 21.46, 2.3, M.tv, { r: 0.008 });
  { const sc = new THREE.PlaneGeometry(1.64, 0.9); sc.rotateY(Math.PI); sc.translate(14.85, z0 + 1.825, -21.465); put(G, sc, M.art[2], { cast: false }); }
  { const geos = []; for (const [x, y] of [[13.4, 23.0], [15.3, 22.3], [14.4, 24.9], [15.9, 24.9], [13.3, 24.9]]) { const c = new THREE.CylinderGeometry(0.045, 0.045, 0.01, 16); c.translate(x, (y > 24.5 ? z0 + 2.61 : zc) - 0.02, -y); geos.push(c.ni()); }
    put(G, mergeGeometries(geos), M.led_cool, { cast: false, layer: 'ceiling' }); }
}

// ================================================================== ENTRY WALK-THROUGH (west side of the foyer) - from the walk-through photo
{
  const G = space('Entry walk-through', 'GF'), H = 4.17;
  const tileWall = (() => { const c = cv(256, 256), ctx = c.getContext('2d'); for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const v = 22 + Math.floor(rnd() * 16);
      ctx.fillStyle = `rgb(${v},${v},${v + 2})`; ctx.fillRect(x * 32, y * 32, 32, 32); ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(x * 32, y * 32, 32, 1.5); ctx.fillRect(x * 32, y * 32, 1.5, 32); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / 1.2, 1 / 1.2); return t; })();
  const W = {
    tiles: std({ map: tileWall, roughness: 0.85 }),
    grey: std({ color: 0xaeb2b5, normalMap: T.weaveN, roughness: 1 }),
    greyLight: std({ color: 0xbfc3c6, normalMap: T.weaveN, roughness: 1 }),
    black: std({ color: 0x1d1e20, roughness: 0.65 }),
    mat: std({ color: 0x3a3632, normalMap: T.weaveN, normalScale: new THREE.Vector2(2, 2), roughness: 1 }),
    niche: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 1.15, 1.05) }),
  };
  const signTex = (w, h, draw) => { const c = cv(w, h), ctx = c.getContext('2d'); draw(ctx, w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return std({ map: t, roughness: 0.5 }); };
  const wayfind = signTex(512, 360, (ctx, w, h) => { ctx.fillStyle = '#6e7174'; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = '#f4f4f2'; ctx.lineWidth = 12; ctx.beginPath(); ctx.moveTo(40, 130); ctx.lineTo(120, 50); ctx.moveTo(62, 50); ctx.lineTo(120, 50); ctx.lineTo(120, 108); ctx.stroke();
    ctx.fillStyle = '#f4f4f2'; ctx.font = '800 58px Archivo, Arial, sans-serif'; ctx.fillText('HIGH-LEVEL', 34, 212); ctx.fillText('GLOBAL TALENT', 34, 274); ctx.font = '500 30px "IBM Plex Mono", monospace'; ctx.fillText('RIGHT THIS WAY', 36, 324); });
  const plaque = signTex(400, 320, (ctx, w, h) => { ctx.fillStyle = '#151618'; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = '#c9a24a'; ctx.lineWidth = 3; ctx.strokeRect(10, 10, w - 20, h - 20);
    ctx.fillStyle = '#d6b35c'; ctx.beginPath(); ctx.moveTo(200, 70); ctx.lineTo(262, 106); ctx.lineTo(262, 178); ctx.lineTo(200, 214); ctx.lineTo(138, 178); ctx.lineTo(138, 106); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#151618'; ctx.beginPath(); ctx.moveTo(200, 104); ctx.lineTo(232, 122); ctx.lineTo(232, 160); ctx.lineTo(200, 178); ctx.lineTo(168, 160); ctx.lineTo(168, 122); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#e8e6e1'; ctx.textAlign = 'center'; ctx.font = '700 30px Archivo, Arial, sans-serif'; ctx.fillText('OUR PARTNERS', 200, 270); });
  const exitS = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 2.2, 0.9) });
  const _ch = std({ color: 0xdcdcdc, roughness: 0.12, metalness: 1 }); const K_chrome = () => _ch;

  // corridor floor tiles north of the foyer, up to the rear wall
  patch(G, 10.62, 8.52, 12.73, 11.96, 0.004, M.tile);
  // doormat before the corridor
  bx(G, 11.32, 8.1, 0.004, 12.15, 9.75, 0.016, W.mat, { r: 0 }); bx(G, 11.3, 8.08, 0.004, 12.17, 9.77, 0.012, M.steel_black, { r: 0 });
  // batten wall devices: access screen, intercom, keypad
  bx(G, 12.66, 9.15, 1.45, 12.695, 9.4, 1.65, M.tv, { r: 0.006 }); bx(G, 12.66, 9.55, 1.55, 12.695, 9.85, 1.75, M.tv, { r: 0.006 });
  bx(G, 12.66, 9.6, 1.12, 12.695, 9.85, 1.28, M.white, { r: 0.01 }); bx(G, 12.66, 9.0, 1.1, 12.695, 9.06, 1.25, M.steel_black, { r: 0.004 });
  // black wall panel on the foyer face of the rear glass run (keeps the front glass window like the photo)
  bx(G, 9.93, 5.12, 0, 9.97, 7.1, H, W.black, { r: 0 });
  { const p = new THREE.PlaneGeometry(0.62, 0.5); p.rotateY(Math.PI / 2); p.translate(9.975, 2.55, -6.3); put(G, p, plaque, { cast: false }); }
  bx(G, 9.975, 5.5, 1.3, 9.985, 5.72, 1.42, M.white, { r: 0.004 }); bx(G, 9.975, 5.74, 1.3, 9.985, 5.96, 1.42, M.white, { r: 0.004 });
  // high-back booth sofa in pale grey felt, black side table arm with a magazine slot
  bx(G, 9.99, 5.2, 0.0, 10.8, 7.05, 0.12, W.black, { r: 0.01 });
  bx(G, 10.05, 5.22, 0.12, 10.82, 7.03, 0.45, W.grey, { r: 0.04 });
  bx(G, 10.3, 5.26, 0.45, 10.8, 6.99, 0.56, W.greyLight, { r: 0.05 });
  bx(G, 9.99, 5.2, 0.45, 10.3, 7.05, 1.45, W.grey, { r: 0.05 });
  bx(G, 10.22, 5.26, 0.55, 10.36, 7.0, 1.0, W.greyLight, { r: 0.05 });
  bx(G, 9.99, 6.92, 0.45, 10.82, 7.05, 1.45, W.grey, { r: 0.04 });
  bx(G, 9.99, 5.06, 0.0, 10.82, 5.2, 0.62, W.black, { r: 0.01 });
  bx(G, 10.3, 4.92, 0.62, 10.82, 5.2, 0.65, W.black, { r: 0.006 });
  bx(G, 10.34, 5.07, 0.3, 10.36, 5.19, 0.6, M.white, { r: 0 });
  // full-height black coffee joinery (photo): upper doors, LED-lit recessed coffee niche with shelf, sink + gooseneck tap, white espresso machine, black base doors with vent
  { const f = 10.62, J0 = 7.2, J1 = 10.25, d = 0.62, x0 = f - 0.0, xi = f + d;   // joinery face at x = f + d (into the corridor)
    const jb = (a0, a1, z0, z1) => bx(G, f, a0, z0, xi, a1, z1, W.black, { r: 0.002 });
    const N0 = 7.55, N1 = 9.95, NB = 0.92, NT = 2.15;                       // niche extents
    jb(J0, N0, 0, H); jb(N1, J1, 0, H);                                     // side columns
    const S0 = 7.92, S1 = 8.5, SX0 = f + 0.1, SX1 = f + 0.5, SD = 0.2;     // under-mount sink opening right beside the machine
    for (let y = N0; y < N1 - 0.01; y += (N1 - N0) / 3) bx(G, xi - 0.02, y + 0.004, 0.05, xi, y + (N1 - N0) / 3 - 0.004, NB - 0.04, W.black, { r: 0.002 });   // base door fronts
    bx(G, f, N0, 0.05, xi - 0.02, S0, NB - 0.04, W.black, { r: 0 }); bx(G, f, S1, 0.05, xi - 0.02, N1, NB - 0.04, W.black, { r: 0 });   // carcass
    bx(G, f, S0, 0.05, xi - 0.02, S1, NB - 0.04 - SD - 0.02, W.black, { r: 0 });
    bx(G, f + 0.04, N0, 0, xi - 0.06, N1, 0.05, M.steel_black, { r: 0 });   // recessed kick
    bx(G, xi - 0.004, 8.75, 0.18, xi + 0.002, 9.35, 0.42, M.steel_black, { r: 0 });   // vent grille
    for (let k = 0; k < 7; k++) bx(G, xi + 0.002, 8.78, 0.2 + k * 0.03, xi + 0.006, 9.32, 0.212 + k * 0.03, M.tv, { r: 0 });
    bx(G, f, N0, NB - 0.04, xi + 0.03, S0, NB, M.table_black, { r: 0.003 }); bx(G, f, S1, NB - 0.04, xi + 0.03, N1, NB, M.table_black, { r: 0.003 });   // bench top around the sink
    bx(G, f, S0, NB - 0.04, SX0, S1, NB, M.table_black, { r: 0 }); bx(G, SX1, S0, NB - 0.04, xi + 0.03, S1, NB, M.table_black, { r: 0 });
    { const sinkM = std({ color: 0x1b1c1e, roughness: 0.35, metalness: 0.2 }); const zb = NB - 0.04 - SD;
      bx(G, SX0, S0, zb - 0.01, SX1, S1, zb, sinkM, { r: 0 });
      bx(G, SX0, S0, zb, SX0 + 0.01, S1, NB - 0.04, sinkM, { r: 0 }); bx(G, SX1 - 0.01, S0, zb, SX1, S1, NB - 0.04, sinkM, { r: 0 });
      bx(G, SX0, S0, zb, SX1, S0 + 0.01, NB - 0.04, sinkM, { r: 0 }); bx(G, SX0, S1 - 0.01, zb, SX1, S1, NB - 0.04, sinkM, { r: 0 });
      const dr = new THREE.CylinderGeometry(0.03, 0.03, 0.004, 18); dr.translate(f + 0.3, zb + 0.003, -(S0 + S1) / 2); put(G, dr, _ch); }
    for (let y = N0; y < N1 - 0.01; y += (N1 - N0) / 4) jb(y + 0.004, y + (N1 - N0) / 4 - 0.004, NT + 0.12, H - 0.9);  // upper doors
    jb(N0, N1, NT, NT + 0.12); jb(N0, N1, H - 0.9, H);                      // bulkhead + top
    bx(G, f, N0, NB, f + 0.02, N1, NT, W.black, { r: 0 });                  // niche back
    bx(G, f + 0.04, N0 + 0.05, NT - 0.03, f + 0.58, N1 - 0.05, NT - 0.015, W.niche, { r: 0, cast: false });   // LED strip
    { const l = new THREE.PointLight(0xfff2dd, 3.5, 3, 2); l.position.copy(P(f + 0.35, 8.75, NT - 0.15)); G.add(l); layers.ceiling.push(l); }
    bx(G, f, N0, 1.72, f + 0.3, 9.1, 1.75, W.black, { r: 0 });             // floating shelf
    // shelf props: tea boxes, teapot, syrup bottles, stirrers, glasses
    bx(G, f + 0.05, 7.62, 1.75, f + 0.25, 7.72, 2.0, M.table_black, { r: 0.004 }); bx(G, f + 0.05, 7.74, 1.75, f + 0.25, 7.84, 2.0, M.table_black, { r: 0.004 });
    { const tp = new THREE.SphereGeometry(0.07, 18, 12); tp.translate(f + 0.15, 1.82, -7.98); put(G, tp, M.pink); }
    for (const [y, h, m] of [[8.2, 0.3], [8.32, 0.27], [8.44, 0.3]]) { const bt = new THREE.CylinderGeometry(0.03, 0.035, h, 14); bt.translate(f + 0.15, 1.75 + h / 2, -y); put(G, bt, M.glass); const lq = new THREE.CylinderGeometry(0.03, 0.033, h * 0.45, 14); lq.translate(f + 0.15, 1.75 + h * 0.22, -y); put(G, lq, y > 8.4 ? M.rim : M.candle); }
    { const sg = new THREE.CylinderGeometry(0.04, 0.035, 0.12, 14); sg.translate(f + 0.15, 1.81, -8.7); put(G, sg, M.glass); for (let k = 0; k < 12; k++) bx(G, f + 0.13 + (k % 3) * 0.015, 8.68 + (k % 4) * 0.01, 1.76, f + 0.135 + (k % 3) * 0.015, 8.685 + (k % 4) * 0.01, 1.95, M.batten, { r: 0 }); }
    // sink + chrome gooseneck tap
    // black instant boiling-water tap and chrome canister on the far side of the sink
    { const bt = new THREE.CylinderGeometry(0.02, 0.022, 0.42, 12); bt.translate(f + 0.06, NB + 0.21, -7.72); put(G, bt, M.steel_black);
      const bh = new THREE.CylinderGeometry(0.014, 0.014, 0.14, 10); bh.rotateZ(Math.PI / 2); bh.translate(f + 0.13, NB + 0.42, -7.72); put(G, bh, M.steel_black);
      const cn = new THREE.CylinderGeometry(0.04, 0.04, 0.1, 16); cn.translate(f + 0.07, NB + 0.05, -7.82); put(G, cn, _ch); }
    { const p0 = P(f + 0.06, 8.21, NB), st = new THREE.CylinderGeometry(0.018, 0.022, 0.32, 12); st.translate(p0.x, NB + 0.16, p0.z); put(G, st, K_chrome());
      const pts = []; for (let k = 0; k <= 16; k++) { const a2 = k / 16 * Math.PI; pts.push(P(f + 0.06 + (1 - Math.cos(a2)) * 0.09, 8.21, NB + 0.32 + Math.sin(a2) * 0.13)); }
      put(G, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 32, 0.014, 10), K_chrome());
      const spr = new THREE.CylinderGeometry(0.02, 0.02, 0.12, 12); spr.translate(f + 0.24, NB + 0.27, -8.21); put(G, spr, K_chrome()); }
    { const mug = new THREE.CylinderGeometry(0.045, 0.045, 0.1, 18); mug.translate(f + 0.05, NB + 0.05, -8.42); put(G, mug, std({ color: 0x1f8a5a, roughness: 0.4 })); }
    // white two-group espresso machine
    const _mc0 = G.children.length;
    { const mx = f + 0.08, my0 = 8.55, my1 = 9.6, white = std({ color: 0xf3f4f5, roughness: 0.25, metalness: 0.1 }), ch = K_chrome();
      bx(G, mx, my0, NB, mx + 0.5, my1, NB + 0.05, white, { r: 0.01 });                       // base / drip tray
      bx(G, mx + 0.3, my0 + 0.03, NB + 0.05, mx + 0.5, my1 - 0.03, NB + 0.065, ch, { r: 0 });   // grate
      bx(G, mx, my0, NB + 0.05, mx + 0.22, my1, NB + 0.48, white, { r: 0.01 });               // back body
      bx(G, mx, my0, NB + 0.36, mx + 0.48, my1, NB + 0.52, white, { r: 0.012 });              // top head
      bx(G, mx, my0, NB + 0.05, mx + 0.48, my0 + 0.04, NB + 0.52, white, { r: 0.006 }); bx(G, mx, my1 - 0.04, NB + 0.05, mx + 0.48, my1, NB + 0.52, white, { r: 0.006 });
      bx(G, mx + 0.22, my0 + 0.05, NB + 0.36, mx + 0.225, my1 - 0.05, NB + 0.37, W.niche, { r: 0, cast: false });  // under-head light
      for (const gy of [8.88, 9.27]) { const g2 = new THREE.CylinderGeometry(0.045, 0.045, 0.06, 18); g2.translate(mx + 0.33, NB + 0.33, -gy); put(G, g2, ch);
        if (gy < 9) { const pf = new THREE.CylinderGeometry(0.035, 0.035, 0.03, 16); pf.translate(mx + 0.33, NB + 0.28, -gy); put(G, pf, ch);
        const h2 = new THREE.CylinderGeometry(0.012, 0.012, 0.16, 8); h2.rotateZ(Math.PI / 2); h2.translate(mx + 0.43, NB + 0.27, -gy); put(G, h2, M.steel_black); }
        for (let k = 0; k < 5; k++) { const bt = new THREE.CylinderGeometry(0.01, 0.01, 0.01, 10); bt.rotateZ(Math.PI / 2); bt.translate(mx + 0.485, NB + 0.46, -(gy - 0.09 + k * 0.045)); put(G, bt, ch); } }
      for (const ky of [8.62, 9.53]) { const kn = new THREE.CylinderGeometry(0.03, 0.03, 0.04, 16); kn.rotateZ(Math.PI / 2); kn.translate(mx + 0.5, NB + 0.45, -ky); put(G, kn, M.steel_black);
        const wd = new THREE.CylinderGeometry(0.006, 0.006, 0.2, 8); wd.translate(mx + 0.42, NB + 0.28, -(ky + (ky < 9 ? 0.04 : -0.04))); put(G, wd, ch); }
      { const c = cv(256, 32), x = c.getContext('2d'); x.fillStyle = '#f3f4f5'; x.fillRect(0, 0, 256, 32); x.fillStyle = '#1a1a1a'; x.font = '700 20px Archivo, Arial'; x.textAlign = 'center'; x.fillText('FUTURMAT', 128, 23);
        const t3 = new THREE.CanvasTexture(c); t3.colorSpace = THREE.SRGBColorSpace; const lg = new THREE.PlaneGeometry(0.22, 0.028); lg.rotateY(Math.PI / 2); lg.translate(mx + 0.482, NB + 0.49, -9.08); put(G, lg, std({ map: t3, roughness: 0.3 }), { cast: false }); }
      // cups, grinder hopper, tamper on top / beside
      for (let k = 0; k < 6; k++) { const cu = new THREE.CylinderGeometry(0.035, 0.028, 0.08, 14); cu.translate(mx + 0.12, NB + 0.56 + k * 0.025, -9.25); put(G, cu, M.white); }
      { const hp = new THREE.CylinderGeometry(0.07, 0.05, 0.16, 18); hp.translate(mx + 0.12, NB + 0.6, -9.5); put(G, hp, M.glass); const bn = new THREE.CylinderGeometry(0.065, 0.05, 0.1, 18); bn.translate(mx + 0.12, NB + 0.58, -9.5); put(G, bn, M.door); }
      { const kj = new THREE.CylinderGeometry(0.045, 0.045, 0.14, 16); kj.translate(mx + 0.1, NB + 0.59, -8.68); put(G, kj, M.steel_black); }
    }
    window.__coffeeMeshes = G.children.slice(_mc0);
    // tea towel on the bench edge
    bx(G, xi + 0.03, 7.6, NB - 0.25, xi + 0.05, 7.82, NB + 0.01, std({ color: 0xd8d2c0, normalMap: T.weaveN, roughness: 1 }), { r: 0.01 });
  }
  // trailing string-of-pearls plant at the end of the joinery
  { const lv = []; leafCluster(11.27, 10.2, 2.6, 0.18, lv, { n: 30, w: 0.4, h: 0.5, up: 0.0, spread: 1.0 }); leafCluster(11.27, 10.2, 2.1, 0.16, lv, { n: 24, w: 0.4, h: 0.5, up: 0.0, spread: 1.0 }); leafCluster(11.27, 10.2, 1.7, 0.12, lv, { n: 16, w: 0.4, h: 0.5, up: 0.0, spread: 1.0 }); put(G, mergeGeometries(lv), M.leaf); }
  // dark finishes over the remaining white wall faces along the walk-through
  bx(G, 9.93, 7.08, 0, 10.66, 7.2, H, W.black, { r: 0 });
  bx(G, 12.695, 8.52, 0, 12.73, 10.4, H, M.batten, { r: 0 });
  bx(G, 11.5, 10.36, 0, 12.73, 10.395, H, W.black, { r: 0 });
  bx(G, 10.62, 10.25, 0, 10.66, 11.93, H, W.black, { r: 0 });
  // rear wall: black tile, wayfinding sign, exit sign, door to the back
  bx(G, 10.62, 11.93, 0, 12.73, 11.96, H, W.tiles, { r: 0 });
  bx(G, 10.75, 11.9, 0, 11.6, 11.93, 2.1, M.white, { r: 0 }); bx(G, 10.8, 11.89, 0.02, 11.55, 11.9, 2.06, M.tv, { r: 0 });
  { const s = new THREE.PlaneGeometry(0.8, 0.56); s.translate(12.2, 1.95, -11.915); put(G, s, wayfind, { cast: false }); }
  bx(G, 11.02, 11.88, 2.2, 11.32, 11.9, 2.32, exitS, { r: 0, cast: false });
  // stair side: LED-lit handrail climbing to the right
  { const a = P(12.8, 10.54, 0.95), b = P(15.0, 10.54, 0.95 + 11 * 0.171);
    const hr = new THREE.CylinderGeometry(0.02, 0.02, a.distanceTo(b), 12); const m = new THREE.Mesh(hr, M.metal); m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()); m.castShadow = true; G.add(m);
    const led = new THREE.BoxGeometry(0.012, a.distanceTo(b), 0.02); const l = new THREE.Mesh(led, M.led); l.position.copy(m.position).add(new THREE.Vector3(0, -0.04, 0)); l.quaternion.copy(m.quaternion); G.add(l);
    bx(G, 12.73, 10.5, 0, 12.76, 10.58, 0.95, M.led, { r: 0, cast: false }); }
  // black ceiling over the corridor with a track of spotlights along the left
  bx(G, 9.97, 8.52, H - 0.01, 12.73, 11.96, H, M.black_ceiling, { r: 0, layer: 'ceiling', cast: false });
  bx(G, 10.93, 2.0, H - 0.07, 10.97, 11.6, H - 0.02, M.steel_black, { r: 0, layer: 'ceiling', cast: false });
  { const geos = [], lens = []; for (let y = 2.4; y < 11.6; y += 1.1) { const c = new THREE.CylinderGeometry(0.035, 0.035, 0.18, 14); c.rotateX(0.35); c.translate(10.95, H - 0.18, -y); geos.push(c.ni());
      const d = new THREE.CircleGeometry(0.028, 14); d.rotateX(Math.PI / 2 + 0.35); d.translate(10.95, H - 0.27, -(y - 0.03)); lens.push(d.ni()); }
    put(G, mergeGeometries(geos), M.steel_black, { layer: 'ceiling', cast: false }); put(G, mergeGeometries(lens), M.led_cool, { layer: 'ceiling', cast: false });
    for (const y of [4.5, 8.8]) { const s = new THREE.SpotLight(0xffe8cc, 6, 7, 0.6, 0.7, 2); s.position.copy(P(10.95, y, H - 0.3)); s.target.position.copy(P(10.2, y + 0.4, 1.0)); G.add(s, s.target); layers.ceiling.push(s); } }
}

// ================================================================== PODCAST ROOM behind the warehouse window (GF small glazed room)
{
  const G = space('Podcast room', 'GF'), H = 4.17, WX0 = 13.35, WX1 = 14.8, WS = 0.3, WH = 2.75;
  // warehouse south wall rebuilt with the doorway and the new window
  lining(G, 'x', 15.46, 3.53, 15.05, 0, 4.2, [[10.46, 11.19, 0, 2.1], [WX0, WX1, WS, WH]], M.internal, 0.09);
  // textures
  const herr = (() => { const c = cv(256, 256), ctx = c.getContext('2d'); ctx.fillStyle = '#131b2e'; ctx.fillRect(0, 0, 256, 256); ctx.strokeStyle = '#1f2a44'; ctx.lineWidth = 5;
    for (let y = -256; y < 512; y += 48) { ctx.beginPath(); for (let x = 0; x <= 256; x += 64) { ctx.lineTo(x, y + ((x / 64) % 2 ? 32 : 0)); } ctx.stroke(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / 1.0, 1 / 1.0); return t; })();
  const speck = (() => { const c = cv(256, 256), ctx = c.getContext('2d'); ctx.fillStyle = '#2b2c31'; ctx.fillRect(0, 0, 256, 256);
    for (let k = 0; k < 5000; k++) { const v = rnd(); ctx.fillStyle = v > 0.7 ? '#bdbdc3' : v > 0.4 ? '#5d5e66' : '#15161a'; ctx.fillRect(rnd() * 256, rnd() * 256, 2, 2); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / 0.8, 1 / 0.8); return t; })();
  const onAir = (() => { const c = cv(256, 96), ctx = c.getContext('2d'); ctx.clearRect(0, 0, 256, 96); ctx.strokeStyle = '#ff9a3c'; ctx.lineWidth = 5; ctx.strokeRect(8, 8, 240, 80);
    ctx.fillStyle = '#ffb35c'; ctx.font = '600 54px Archivo, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('ON AIR', 128, 68);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return new THREE.MeshBasicMaterial({ map: t, transparent: true, color: new THREE.Color(2.2, 2.0, 1.8) }); })();
  const R = {
    navy: std({ map: herr, roughness: 0.85 }), carpet: std({ map: speck, roughness: 1, normalMap: T.weaveN }),
    leather: std({ color: 0x7e4520, roughness: 0.45, envMapIntensity: 0.9 }), frame: std({ color: 0x1b1e1c, roughness: 0.4, metalness: 0.6 }),
    brass: std({ color: 0xc9a04a, roughness: 0.3, metalness: 1 }), blue: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 0.8, 3.0) }),
  };
  const X0 = 11.62, X1 = 14.93, Y0 = 12.12, Y1 = 15.455;
  patch(G, X0, Y0, X1, Y1, 0.005, R.carpet);
  lining(G, 'x', Y0, X0, X1, 0, H, [], R.navy, 0.015);
  lining(G, 'y', X1 - 0.015, Y0, Y1, 0, H, [], R.navy, 0.015);
  lining(G, 'x', Y1 - 0.015, X0, X1, 0, H, [[WX0, WX1, WS, WH]], R.navy, 0.015);
  bx(G, X0, Y0, H - 0.02, X1, Y1, H, M.black_ceiling, { r: 0, layer: 'ceiling', cast: false });
  // window: deep black frame both sides, clear glass
  for (const [x0, x1] of [[WX0 - 0.07, WX0], [WX1, WX1 + 0.07]]) bx(G, x0, 15.44, WS - 0.07, x1, 15.6, WH + 0.07, M.steel_black, { r: 0 });
  bx(G, WX0, 15.44, WS - 0.07, WX1, 15.6, WS, M.steel_black, { r: 0 }); bx(G, WX0, 15.44, WH, WX1, 15.6, WH + 0.07, M.steel_black, { r: 0 });
  { const gl = new THREE.PlaneGeometry(WX1 - WX0, WH - WS); gl.translate((WX0 + WX1) / 2, (WS + WH) / 2, -15.51); put(G, gl, M.glass, { cast: false }); }
  bx(G, WX0 - 0.1, 15.56, 0, WX1 + 0.1, 15.62, 0.12, M.metal, { r: 0 });
  // PODCAST light box projecting beside the window
  { const g = new THREE.BoxGeometry(0.1, 1.0, 0.2); g.translate(WX0 - 0.2, 2.25, -(15.555 + 0.11)); put(G, g, [M.podcast, M.podcast, M.black_panel, M.black_panel, M.black_panel, M.black_panel], { cast: false }); }
  // back wall: shelf line and blue LED strips, wall TV on the east side
  bx(G, 12.0, Y0 + 0.015, 1.95, 14.6, Y0 + 0.2, 1.98, R.brass, { r: 0 }); bx(G, 12.0, Y0 + 0.015, 2.35, 14.6, Y0 + 0.2, 2.38, R.brass, { r: 0 });
  bx(G, 12.3, Y0 + 0.016, 1.12, 13.0, Y0 + 0.03, 1.15, R.blue, { r: 0, cast: false }); bx(G, 13.5, Y0 + 0.016, 1.12, 14.2, Y0 + 0.03, 1.15, R.blue, { r: 0, cast: false });
  bx(G, X1 - 0.07, 13.1, 1.2, X1 - 0.015, 14.4, 1.95, M.tv, { r: 0.006 });
  for (let k = 0; k < 4; k++) { const b = new THREE.BoxGeometry(0.12, 0.16, 0.08); b.translate(12.3 + k * 0.6, 2.06, -(Y0 + 0.1)); put(G, b, M.art[k % 3]); }
  // two tan leather lounge chairs on black steel sled frames, angled toward each other
  const chair = () => { const g = new THREE.Group(), add = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = m.receiveShadow = true; g.add(m); return m; };
    for (const sx of [-0.36, 0.36]) { const pts = [[0.38, 0.02], [-0.42, 0.02], [-0.42, 0.62], [0.3, 0.62]].map(([z, y]) => new THREE.Vector3(sx, y, z));
      add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.02), 40, 0.016, 8), R.frame);
      add(new THREE.BoxGeometry(0.06, 0.02, 0.62), R.brass).position.set(sx, 0.64, -0.02); }
    const seat = add(new RoundedBoxGeometry(0.66, 0.14, 0.62, 3, 0.05), R.leather); seat.position.set(0, 0.36, 0.02); seat.rotation.x = -0.12;
    const back = add(new RoundedBoxGeometry(0.66, 0.66, 0.14, 3, 0.05), R.leather); back.position.set(0, 0.72, -0.34); back.rotation.x = -0.28;
    add(new THREE.BoxGeometry(0.7, 0.06, 0.06), R.frame).position.set(0, 0.3, 0.3);
    return g; };
  const c1 = chair(); c1.position.copy(P(12.55, 13.75, 0)); c1.rotation.y = yawToward(1, -0.7) + Math.PI; G.add(c1);
  const c2 = chair(); c2.position.copy(P(13.95, 13.2, 0)); c2.rotation.y = yawToward(-1, 0.55) + Math.PI; G.add(c2);
  // round perforated black side table with a gold retro mic
  { const t = new THREE.CylinderGeometry(0.34, 0.34, 0.5, 24, 1, true); t.translate(13.35, 0.25, -12.85); put(G, t, M.mesh_back);
    const tp = new THREE.CylinderGeometry(0.36, 0.36, 0.03, 32); tp.translate(13.35, 0.515, -12.85); put(G, tp, M.table_black);
    const mb = new THREE.CylinderGeometry(0.05, 0.06, 0.02, 16); mb.translate(13.25, 0.54, -12.9); put(G, mb, R.brass);
    const ms = new THREE.CylinderGeometry(0.008, 0.008, 0.16, 8); ms.translate(13.25, 0.62, -12.9); put(G, ms, R.brass);
    const mh = new THREE.CapsuleGeometry(0.035, 0.06, 4, 12); mh.translate(13.25, 0.74, -12.9); put(G, mh, R.brass); }
  // boom-arm mics clamped to the table, pointing at each chair
  for (const [tx, ty, px, py] of [[13.1, 12.95, 12.75, 13.5], [13.6, 12.95, 13.8, 13.35]]) {
    const a = P(tx, ty, 0.55), mid = P((tx + px) / 2, (ty + py) / 2, 1.15), b = P(px, py, 1.0);
    for (const [p0, p1] of [[a, mid], [mid, b]]) { const L = p0.distanceTo(p1), g = new THREE.CylinderGeometry(0.014, 0.014, L, 8); const m = new THREE.Mesh(g, M.steel_black);
      m.position.copy(p0).add(p1).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p1.clone().sub(p0).normalize()); m.castShadow = true; G.add(m); }
    const mic = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.028, 0.17, 16), M.steel_black); mic.position.copy(b); mic.rotation.z = 1.2; mic.castShadow = true; G.add(mic); }
  // ON AIR neon under a white lantern, and a halo ring pendant
  { const l = new THREE.SphereGeometry(0.3, 28, 18); l.scale(1, 0.75, 1); l.translate(14.35, 2.9, -15.05); put(G, l, M.softbox_in, { cast: false });
    const s = new THREE.PlaneGeometry(0.5, 0.19); s.rotateY(Math.PI); s.translate(14.35, 2.7, -15.28); put(G, s, onAir, { cast: false });
    hangWire(G, 14.35, 15.05, 3.1, H);
    const ring = new THREE.TorusGeometry(0.42, 0.014, 8, 80); ring.rotateX(Math.PI / 2); ring.translate(13.4, 2.45, -13.4); put(G, ring, M.led_cool, { cast: false });
    hangWire(G, 13.4, 13.82, 2.45, H); hangWire(G, 13.4, 12.98, 2.45, H);
    const pl = new THREE.PointLight(0xffe0c0, 6, 6, 2); pl.position.copy(P(13.4, 13.5, 2.3)); G.add(pl);
    const bl = new THREE.PointLight(0x5a78ff, 2.5, 4, 2); bl.position.copy(P(13.3, 12.4, 1.2)); G.add(bl); }
}

// ================================================================== KYNAN under the basketball ring (3D relief from his photo + modelled legs and ball)
{
  const G = space('Kynan', 'GF'), K = window.__KYNAN, base = 0.76, SC = 0.93;
  const tx = new THREE.TextureLoader().load('__KYNAN_TEX__'); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 8;
  const body = new THREE.Group(); G.add(body);
  const mk = (flip) => { const g = new THREE.BufferGeometry(); const v = K.v.slice(); if (flip) for (let i = 2; i < v.length; i += 3) v[i] = -v[i] * 0.85;
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(K.uv, 2));
    const ix = K.i.slice(); if (flip) for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } g.setIndex(ix); g.computeVertexNormals(); return g; };
  const front = new THREE.Mesh(mk(false), new THREE.MeshStandardMaterial({ map: tx, alphaTest: 0.45, roughness: 0.75, envMapIntensity: 0.5 }));
  const back = new THREE.Mesh(mk(true), new THREE.MeshStandardMaterial({ map: tx, alphaTest: 0.45, roughness: 0.8, color: 0x2a2a2a }));
  for (const m of [front, back]) { m.castShadow = true; m.receiveShadow = true; m.position.y = base; m.scale.setScalar(SC); body.add(m); }
  // legs below the photo: straight-leg rust-brown twill jeans to the ankle, white leather low-top sneakers
  const twill = (() => { const c = cv(256, 256), ctx = c.getContext('2d'); ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, 256, 256);
    for (let k = -256; k < 512; k += 4) { ctx.strokeStyle = `rgba(${rnd() > 0.5 ? 255 : 0},${rnd() > 0.5 ? 255 : 0},${rnd() > 0.5 ? 255 : 0},0.10)`; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(k + 256, 256); ctx.stroke(); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(10, 18); return t; })();
  const jean = std({ normalMap: T.weaveN, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.92, envMapIntensity: 0.5 });
  jean.color.setRGB(88 / 255 * 0.95, 44 / 255 * 0.95, 25 / 255 * 0.95).convertSRGBToLinear();
  const white = std({ color: 0xf2f2f0, roughness: 0.38, envMapIntensity: 1.0 }), whiteSole = std({ color: 0xfafaf8, roughness: 0.6 }), lacesM = std({ color: 0xe6e6e2, roughness: 0.8 });
  const px = x => (x - 386) / 1001 * SC;
  // straight leg: roomy thigh, near-constant width to the hem, small stack at the ankle
  const prof = [[0.0, 0.07], [0.066, 0.07], [0.07, 0.09], [0.067, 0.13], [0.069, 0.2], [0.071, 0.3], [0.074, 0.42], [0.078, 0.52], [0.084, 0.62], [0.092, 0.7], [0.097, base + 0.03], [0.0, base + 0.03]].map(([r2, y2]) => new THREE.Vector2(r2, y2));
  for (const [x, lean] of [[px(262), 0.02], [px(462), -0.015]]) {
    const g = new THREE.LatheGeometry(prof, 40); g.scale(1, 1, 0.88);
    const pa = g.attributes.position; for (let i = 0; i < pa.count; i++) { const y = pa.getY(i), a2 = Math.atan2(pa.getZ(i), pa.getX(i));
      let dx = lean * (base - y); if (y < 0.2) dx += Math.sin(y * 60 + a2 * 3) * 0.003;   // soft folds where the hem stacks
      pa.setX(i, pa.getX(i) + dx); }
    g.computeVertexNormals();
    const leg = new THREE.Mesh(g, jean); leg.castShadow = leg.receiveShadow = true; leg.position.set(x, 0, 0); body.add(leg);
    // outseam
    const seam = new THREE.Mesh(new THREE.BoxGeometry(0.003, base - 0.1, 0.006), std({ color: 0x3e2012, roughness: 1 })); seam.position.set(x + (x < 0 ? -0.075 : 0.075) + lean * base * 0.5, (base + 0.08) / 2, 0); body.add(seam);
    // white low-top sneaker: thick cupsole, rounded toe box, laces, collar
    const fx = x + lean * base, sh = new THREE.Group(); sh.position.set(fx, 0, 0.035); body.add(sh);
    const so = new THREE.Mesh(new RoundedBoxGeometry(0.108, 0.034, 0.29, 4, 0.014), whiteSole); so.position.set(0, 0.017, 0.02); sh.add(so);
    const up = new THREE.Mesh(new RoundedBoxGeometry(0.098, 0.07, 0.2, 4, 0.034), white); up.position.set(0, 0.066, -0.02); sh.add(up);
    const toe = new THREE.Mesh(new THREE.SphereGeometry(0.05, 28, 16), white); toe.scale.set(0.98, 0.58, 1.3); toe.position.set(0, 0.052, 0.095); sh.add(toe);
    const tongue = new THREE.Mesh(new RoundedBoxGeometry(0.06, 0.02, 0.09, 2, 0.008), white); tongue.position.set(0, 0.1, 0.03); tongue.rotation.x = -0.4; sh.add(tongue);
    for (let k = 0; k < 4; k++) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.004, 0.006), lacesM); l.position.set(0, 0.098 - k * 0.006, 0.06 - k * 0.018); l.rotation.x = -0.4; sh.add(l); }
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.004, 0.24), std({ color: 0xdedede, roughness: 0.7 })); stripe.position.set(0, 0.036, 0.02); sh.add(stripe);
    sh.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  }
  // AIIMS / KYNAN basketball held out in his raised hand
  { const c = cv(1024, 512), ctx = c.getContext('2d'); const g = ctx.createLinearGradient(0, 0, 0, 512); g.addColorStop(0, '#c9612a'); g.addColorStop(0.5, '#e07a38'); g.addColorStop(1, '#b8541f');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 1024, 512); for (let k = 0; k < 9000; k++) { ctx.fillStyle = `rgba(80,30,10,${rnd() * 0.25})`; ctx.fillRect(rnd() * 1024, rnd() * 512, 2, 2); }
    ctx.strokeStyle = '#1b120d'; ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(0, 256); ctx.lineTo(1024, 256); ctx.stroke();
    for (const x of [256, 768]) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 512); ctx.stroke(); }
    for (const cx0 of [0, 512]) { ctx.beginPath(); ctx.ellipse(cx0 + 256, 256, 150, 256, 0, 0, Math.PI * 2); ctx.stroke(); }
    ctx.fillStyle = '#20150f'; ctx.textAlign = 'center'; ctx.font = 'italic 900 64px Archivo, Arial, sans-serif'; ctx.fillText('AIIMS', 128, 200); ctx.font = '800 58px Archivo, Arial, sans-serif'; ctx.fillText('KYNAN', 128, 330);
    const bt = new THREE.CanvasTexture(c); bt.colorSpace = THREE.SRGBColorSpace;
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.12, 48, 32), std({ map: bt, roughness: 0.7 })); ball.position.set(K.meta.wrist[0] * SC + 0.07, base + K.meta.wrist[1] * SC + 0.07, 0.2);
    ball.rotation.y = -Math.PI / 2 - 0.35; ball.castShadow = true; body.add(ball);
    window.__dribble = { ball, top: base + K.meta.wrist[1] * SC - 0.06 - 0.025 - 0.12, bottom: 0.12, T: 0.62, rest: ball.position.y };
    ball.position.y = window.__dribble.top;
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.06, 24, 16), std({ color: 0x9e6450, roughness: 0.55 })); hand.scale.set(0.8, 0.42, 1.25); hand.position.set(K.meta.wrist[0] * SC + 0.05, base + K.meta.wrist[1] * SC - 0.06, 0.16); body.add(hand); }
  // stands under the ring on the west wall, facing down the court
  G.position.copy(P(5.35, 18.3, 0)); G.rotation.y = Math.PI / 2;
}

// ---- Kynan actions: click him, choose bounce or shoot; nothing happens until an option is chosen
{
  const d = window.__dribble, ball = d.ball, body = ball.parent, hand = new THREE.Vector3(ball.position.x, d.top, ball.position.z);
  const kyMeshes = []; SP['Kynan'].traverse(o => { if (o.isMesh) kyMeshes.push(o); });
  const hoopW = P(4.39, 18.3, 3.05), hoop = body.worldToLocal(hoopW.clone());
  let act = null;
  const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const resetBall = () => { ball.position.copy(hand); ball.scale.set(1, 1, 1); };
  resetBall();
  window.__kynanAct = (kind) => { act = { kind, t0: performance.now() }; if (reduce()) { act = null; resetBall(); } };
  window.__kynanTick = (now) => {
    if (!act) return; const t = (now - act.t0) / 1000;
    if (act.kind === 'bounce') { const T = d.T, n = 6; if (t > T * n) { act = null; resetBall(); return; }
      const u = (t / T) % 1, k = Math.abs(2 * u - 1), f = 1 - (1 - k) * (1 - k), y = d.bottom + (d.top - d.bottom) * f;
      ball.position.set(hand.x, y, hand.z); const sq = y < d.bottom + 0.03 ? 1 - (d.bottom + 0.03 - y) * 3 : 1; ball.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq)); ball.rotation.z = t * 3; return; }
    // shoot: 1.1 s arc to just above the rim, drop through the net, two bounces, then back in his hand
    const T1 = 1.1, apex = hoop.y + 1.3, above = hoop.clone(); above.y += 0.25;
    if (t < T1) { const u = t / T1; ball.position.lerpVectors(hand, above, u); ball.position.y = hand.y + (above.y - hand.y) * u + 4 * (apex - Math.max(hand.y, above.y)) * u * (1 - u); ball.rotation.x = -t * 8; return; }
    const t2 = t - T1, g = 9.8, floorY = d.bottom;
    const dropT = Math.sqrt(2 * (above.y - floorY) / g);
    if (t2 < dropT) { ball.position.set(above.x + t2 * 0.25, above.y - 0.5 * g * t2 * t2, above.z); return; }
    const t3 = t2 - dropT, v0 = g * dropT * 0.45, tb = 2 * v0 / g;
    if (t3 < tb * 2.2) { const k = t3 < tb ? t3 : (t3 - tb) * 1.8, v = t3 < tb ? v0 : v0 * 0.45; ball.position.set(above.x + (dropT + t3) * 0.25, floorY + Math.max(0, v * k - 0.5 * g * k * k), above.z); return; }
    if (t3 < tb * 2.2 + 0.6) return;
    act = null; resetBall();
  };
  // click / tap picking + option menu
  const menu = document.getElementById('kmenu'), ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let down = null;
  const pick = (e) => { const rc = renderer.domElement.getBoundingClientRect(); ndc.set(((e.clientX - rc.left) / rc.width) * 2 - 1, -((e.clientY - rc.top) / rc.height) * 2 + 1);
    ray.setFromCamera(ndc, camera); return ray.intersectObjects(kyMeshes, false).length > 0; };
  renderer.domElement.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
  renderer.domElement.addEventListener('pointermove', e => { if (!down) renderer.domElement.style.cursor = (pick(e) || (window.__hoverCoffee && window.__hoverCoffee(e))) ? 'pointer' : ''; });
  renderer.domElement.addEventListener('pointerup', e => {
    if (e.button !== 0) { down = null; return; }
    const moved = down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6; down = null; if (moved) return;
    if (pick(e)) { const rc = stage.getBoundingClientRect(); menu.hidden = false;
      const mx = Math.min(e.clientX - rc.left + 12, rc.width - menu.offsetWidth - 12), my = Math.min(e.clientY - rc.top + 12, rc.height - menu.offsetHeight - 12);
      menu.style.left = Math.max(12, mx) + 'px'; menu.style.top = Math.max(12, my) + 'px'; menu.querySelector('button').focus(); }
    else if (!menu.hidden) menu.hidden = true; else if (window.__pickOther && window.__pickOther(e)) {} else if (e.button === 0 && window.__jumpTo) window.__jumpTo(e); });
  menu.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; menu.hidden = true; if (b.dataset.act) window.__kynanAct(b.dataset.act); });
  addEventListener('keydown', e => { if (e.key === 'Escape') menu.hidden = true; });
}

// ================================================================== UPPER FRONT OPEN AREA (photos): desks on carpet (left), tiled walkway, black TV wall ahead, lounge against the courtyard glass (right)
{
  const G = space('Front open area', 'UF'), z0 = UFZ, zc = UFZ + 2.98;
  const fleck = (() => { const c = cv(512, 512), x = c.getContext('2d'); x.fillStyle = '#2a2b30'; x.fillRect(0, 0, 512, 512);
    for (let k = 0; k < 26000; k++) { const v = rnd(); x.fillStyle = v > 0.72 ? '#d8d9de' : v > 0.45 ? '#6a6c78' : '#14151a'; x.fillRect(rnd() * 512, rnd() * 512, 2 + rnd() * 3, 1.5); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / 1.2, 1 / 1.2); t.anisotropy = 8; return t; })();
  const F = {
    carpet: std({ map: fleck, normalMap: T.weaveN, roughness: 1 }),
    tile: std({ color: 0x6e665e, map: T.tile, roughnessMap: T.tileR, roughness: 0.32, envMapIntensity: 1.1 }),
    black: std({ color: 0x1b1c1e, roughness: 0.7 }),
    slat: std({ color: 0x1d1e20, roughness: 0.6 }),
    oakDark: std({ color: 0x6e6862, map: T.oakDark, roughness: 0.5 }),
    felt: std({ color: 0x45464a, normalMap: T.boucleN, roughness: 1 }),
    chairFab: std({ color: 0xb9babb, normalMap: T.weaveN, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.95 }),
    tube: std({ color: 0x111214, roughness: 0.35, metalness: 0.7 }),
    tableW: std({ color: 0xf2f2f0, roughness: 0.35 }),
    pot: std({ color: 0x3a3c3f, roughness: 0.55 }),
  };
  // floors: dark large-format tile everywhere, flecked carpet zone under the desks
  patch(G, 3.9, 1.62, 12.6, 10.05, z0 + 0.006, F.tile); patch(G, 0.2, 0.25, 3.85, 6.0, z0 + 0.006, F.tile);
  patch(G, 0.2, 0.25, 9.2, 5.9, z0 + 0.012, F.carpet); patch(G, 9.2, 1.75, 11.6, 5.9, z0 + 0.012, F.carpet);   // facade steps back east of x 9.5
  bx(G, 0.2, 5.88, z0 + 0.006, 11.6, 5.92, z0 + 0.016, M.steel_black, { r: 0 }); bx(G, 11.58, 0.25, z0 + 0.006, 11.62, 5.92, z0 + 0.016, M.steel_black, { r: 0 });
  // black vertical-slat wall behind the desks (bathroom block south face) and black TV wall (bathroom block east face)
  bx(G, 0.2, 6.0, z0, 3.86, 6.04, zc, F.black, { r: 0 });
  { const geos = []; for (let x = 0.24; x < 3.84; x += 0.11) { const b = new RoundedBoxGeometry(0.075, zc - z0 - 0.02, 0.05, 1, 0.012); b.translate(x, z0 + (zc - z0) / 2, -5.97); geos.push(b.ni()); } put(G, projectUV(mergeGeometries(geos)), F.slat); }
  bx(G, 3.86, 6.0, z0, 3.98, 9.05, zc, F.black, { r: 0 }); bx(G, 3.86, 6.0, z0, 4.0, 9.05, z0 + 0.1, M.metal, { r: 0 });
  bx(G, 3.86, 9.05, z0, 3.94, 10.08, zc, std({ color: 0xebe8e2, roughness: 0.9 }), { r: 0 });
  bx(G, 4.6, 9.6, z0, 5.42, 10.08, zc, F.black, { r: 0 });                              // black pier beside the courtyard glazing
  // wall TV: "EMPOWER IDEAS. ELEVATE SUCCESS." night-sky screen (photo)
  { const c = cv(1024, 576), x = c.getContext('2d'); const sky = x.createLinearGradient(0, 0, 0, 576); sky.addColorStop(0, '#050a24'); sky.addColorStop(0.6, '#0b2a6e'); sky.addColorStop(1, '#0a1838'); x.fillStyle = sky; x.fillRect(0, 0, 1024, 576);
    for (let k = 0; k < 500; k++) { x.fillStyle = `rgba(255,255,255,${0.3 + rnd() * 0.7})`; const r = rnd() * 1.6; x.beginPath(); x.arc(rnd() * 1024, rnd() * 400, r, 0, 7); x.fill(); }
    const pl = x.createRadialGradient(512, 560, 40, 512, 560, 300); pl.addColorStop(0, '#9ff3ff'); pl.addColorStop(0.5, '#3fc6f0'); pl.addColorStop(1, 'rgba(30,120,220,0)'); x.fillStyle = pl; x.beginPath(); x.arc(512, 600, 300, 0, 7); x.fill();
    x.fillStyle = '#05070f'; x.beginPath(); x.moveTo(0, 576); for (let k = 0; k <= 1024; k += 16) x.lineTo(k, 505 + Math.sin(k / 37) * 14 + Math.sin(k / 11) * 6); x.lineTo(1024, 576); x.fill();
    x.fillRect(560, 440, 10, 70); x.beginPath(); x.arc(565, 432, 9, 0, 7); x.fill(); x.lineWidth = 6; x.strokeStyle = '#05070f'; x.beginPath(); x.moveTo(565, 455); x.lineTo(590, 410); x.stroke();
    x.textAlign = 'center'; x.font = '900 70px Archivo, Arial, sans-serif'; x.fillStyle = '#dce7ff'; x.textAlign = 'right'; x.fillText('EMPOWER ', 560, 150); x.textAlign = 'left'; x.fillStyle = '#47c7ff'; x.fillText('IDEAS.', 560, 150); x.textAlign = 'center';
    x.fillStyle = '#dce7ff'; x.fillText('ELEVATE SUCCESS.', 512, 228);
    x.fillStyle = 'rgba(255,255,255,.15)'; x.fillRect(350, 175, 330, 20); x.fillStyle = '#e8ecf5'; x.font = '500 16px "IBM Plex Mono", monospace'; x.fillText('10:16 AM  ·  13 OCT', 512, 30);
    for (const [px, py] of [[440, 300], [512, 300], [584, 300]]) { x.strokeStyle = '#cfe9ff'; x.lineWidth = 3; x.beginPath(); x.arc(px, py, 14, 0, 7); x.stroke(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    bx(G, 3.98, 6.65, z0 + 1.15, 4.04, 8.45, z0 + 2.17, M.tv, { r: 0.008 });
    const sc = new THREE.PlaneGeometry(1.74, 0.96); sc.rotateY(Math.PI / 2); sc.translate(4.045, z0 + 1.66, -7.55); put(G, sc, new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(1.15, 1.15, 1.15) }), { cast: false });
    bx(G, 3.98, 8.75, z0 + 1.1, 4.0, 8.82, z0 + 1.24, M.steel_black, { r: 0.004 }); }
  // hanging box signs: CAPTURE. / Production over the desks, INFLUENCE. / Social on the TV wall corner
  const signBoxTex = (a, b) => { const c = cv(256, 384), x = c.getContext('2d'); x.fillStyle = '#111214'; x.fillRect(0, 0, 256, 384); x.fillStyle = '#f2f1ee';
    x.font = '800 38px Archivo, Arial, sans-serif'; x.fillText(a, 22, 66); x.font = '500 12px "IBM Plex Mono", monospace'; x.fillText('BY AIIMS', 24, 86); x.font = 'italic 600 34px Georgia, serif'; x.fillText(b, 70, 340);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return std({ map: t, roughness: 0.6 }); };
  { const m = signBoxTex('CAPTURE.', 'Production'), g = new THREE.BoxGeometry(0.42, 0.62, 0.42); g.translate(7.4, zc - 0.4, -4.6); put(G, g, [m, m, F.black, F.black, m, m], { layer: 'ceiling', cast: false });
    const m2 = signBoxTex('INFLUENCE.', 'Social'), g2 = new THREE.BoxGeometry(0.06, 0.4, 0.3); g2.translate(4.03, zc - 0.55, -5.85); put(G, g2, [m2, m2, F.black, F.black, m2, m2], { cast: false }); }
  // linear pendants over the desks, recessed downlights along the walkway
  for (const x of [2.0, 5.35, 8.7]) { bx(G, x - 0.03, 1.0, zc - 0.75, x + 0.03, 4.9, zc - 0.7, M.steel_black, { r: 0.004, layer: 'ceiling', cast: false }); bx(G, x - 0.02, 1.02, zc - 0.755, x + 0.02, 4.88, zc - 0.75, M.led, { r: 0, layer: 'ceiling', cast: false });
    for (const y of [1.3, 4.6]) hangWire(G, x, y, zc - 0.7, zc); }
  { const geos = []; for (let x = 4.6; x < 12.4; x += 1.3) for (const y of [6.6, 8.6]) { const c = new THREE.CylinderGeometry(0.045, 0.045, 0.01, 16); c.translate(x, zc - 0.02, -y); geos.push(c.ni()); }
    put(G, mergeGeometries(geos), M.led_cool, { cast: false, layer: 'ceiling' });
    const l = new THREE.PointLight(0xfff3e4, 6, 9, 2); l.position.copy(P(7.5, 7.6, z0 + 2.6)); G.add(l); layers.ceiling.push(l); }

  // ---- desks: back-to-back sit-stand pairs with grey felt screens, dual monitors on arms, black pedestals, mesh chairs
  const mc = meshChair();
  // three clusters of 6 sit-stand desks (3 each side of a felt-screen spine), running front-to-back like the timber bench
  const cluster = (cx, y0, n) => { const w = 1.4, d = 0.72;
    bx(G, cx - 0.02, y0 + 0.05, z0 + 0.74, cx + 0.02, y0 + n * w - 0.05, z0 + 1.3, F.felt, { r: 0.02 });
    for (let i = 0; i < n; i++) for (const side of [-1, 1]) { const dy0 = y0 + i * w + 0.02, dy1 = dy0 + w - 0.04, xA = side < 0 ? cx - d : cx, xB = xA + d, mid = (dy0 + dy1) / 2, edge = side < 0 ? xA : xB;
      bx(G, xA, dy0, z0 + 0.72, xB, dy1, z0 + 0.75, F.oakDark, { r: 0.004 });
      for (const ly of [dy0 + 0.1, dy1 - 0.1]) { bx(G, (xA + xB) / 2 - 0.03, ly - 0.03, z0, (xA + xB) / 2 + 0.03, ly + 0.03, z0 + 0.72, M.steel_black, { r: 0 }); bx(G, xA + 0.05, ly - 0.03, z0, xB - 0.05, ly + 0.03, z0 + 0.03, M.steel_black, { r: 0 }); }
      const mx = side < 0 ? cx - 0.16 : cx + 0.16;
      for (const oy of [-0.3, 0.3]) { bx(G, mx - 0.012, mid + oy - 0.28, z0 + 0.98, mx + 0.012, mid + oy + 0.28, z0 + 1.31, M.tv, { r: 0.004 });
        const sc = new THREE.PlaneGeometry(0.54, 0.31); sc.rotateY(side < 0 ? -Math.PI / 2 : Math.PI / 2); sc.translate(mx + (side < 0 ? -0.013 : 0.013), z0 + 1.145, -(mid + oy)); put(G, sc, M.work[Math.floor(rnd() * 3)], { cast: false }); }
      bx(G, mx - 0.02, mid - 0.02, z0 + 0.75, mx + 0.02, mid + 0.02, z0 + 1.0, M.steel_black, { r: 0 }); bx(G, mx - 0.03, mid - 0.32, z0 + 1.0, mx + 0.03, mid + 0.32, z0 + 1.03, M.steel_black, { r: 0 });
      bx(G, edge - side * 0.3 - 0.07, mid - 0.22, z0 + 0.75, edge - side * 0.3 + 0.07, mid + 0.22, z0 + 0.765, M.table_black, { r: 0.003 });
      const px = side < 0 ? xA - 0.0 : xB - 0.42; bx(G, px + (side < 0 ? 0.02 : 0), dy1 - 0.62, z0, px + (side < 0 ? 0.42 : 0.4), dy1 - 0.04, z0 + 0.62, F.black, { r: 0.01 });
      place(mc, G, edge + side * 0.45, mid - 0.15, z0, yawToward(-side, 0)); } };
  cluster(2.0, 0.85, 3); cluster(5.35, 0.85, 3); cluster(8.7, 2.25, 2);

  // ---- lounge against the courtyard glazing: four pale grey armchairs on black steel tube frames, round white table, big olive planter
  const armchair = () => { const g = new THREE.Group(), add = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = m.receiveShadow = true; g.add(m); return m; };
    add(new RoundedBoxGeometry(0.72, 0.16, 0.66, 3, 0.04), F.chairFab).position.set(0, 0.38, 0.02);
    add(new RoundedBoxGeometry(0.72, 0.5, 0.16, 3, 0.05), F.chairFab).position.set(0, 0.68, -0.28);
    const tubeAt = (pts) => { add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)), false, 'catmullrom', 0.01), 40, 0.014, 8), F.tube); };
    for (const sx of [-0.38, 0.38]) tubeAt([[sx, 0, 0.32], [sx, 0.6, 0.32], [sx, 0.62, 0.28], [sx, 0.62, -0.3], [sx, 0.6, -0.34], [sx, 0, -0.34]]);
    add(new THREE.BoxGeometry(0.76, 0.02, 0.02), F.tube).position.set(0, 0.3, 0.3); add(new THREE.BoxGeometry(0.76, 0.02, 0.02), F.tube).position.set(0, 0.3, -0.34);
    return g; };
  const ac = armchair();
  for (const [x, y, fx] of [[5.95, 8.45, 1], [5.95, 9.25, 1], [7.35, 8.45, -1], [7.35, 9.25, -1]]) place(ac, G, x, y, z0, yawToward(fx, 0) + Math.PI);
  { const tp = new THREE.CylinderGeometry(0.32, 0.32, 0.03, 40); tp.translate(6.65, z0 + 0.42, -8.85); put(G, tp, F.tableW);
    const st = new THREE.CylinderGeometry(0.03, 0.03, 0.4, 12); st.translate(6.65, z0 + 0.2, -8.85); put(G, st, F.tube);
    const bs = new THREE.CylinderGeometry(0.2, 0.2, 0.02, 24); bs.translate(6.65, z0 + 0.01, -8.85); put(G, bs, F.tube); }
  // courtyard glazing closed: fixed glass panes with white mullions across the old folding opening, cross doors shut
  { const gx0 = 5.58, gx1 = 9.21, n = 4, wP = (gx1 - gx0) / n;
    for (let k = 0; k <= n; k++) { const x = gx0 + k * wP; bx(G, x - 0.025, 10.09, z0, x + 0.025, 10.16, z0 + 2.56, M.frame_white, { r: 0 }); }
    bx(G, gx0, 10.09, z0, gx1, 10.16, z0 + 0.05, M.frame_white, { r: 0 }); bx(G, gx0, 10.09, z0 + 1.38, gx1, 10.16, z0 + 1.43, M.frame_white, { r: 0 });
    const gl = new THREE.PlaneGeometry(gx1 - gx0, 2.5); gl.translate((gx0 + gx1) / 2, z0 + 1.3, -10.125); put(G, gl, M.glass, { cast: false });
    for (const [a, b] of [[4.37, 5.0], [9.88, 10.55]]) { const d = new THREE.PlaneGeometry(b - a, 2.54); d.translate((a + b) / 2, z0 + 1.28, -10.125); put(G, d, M.glass, { cast: false });
      bx(G, b - 0.07, 10.07, z0 + 0.95, b - 0.05, 10.18, z0 + 1.25, M.metal, { r: 0 }); } }
  bx(G, 9.2, 10.04, z0 + 0.35, 9.3, 10.06, z0 + 0.47, M.white, { r: 0.004 });
  for (const [a, b2, x, y] of [['DISCOVER.', 'SEO', 11.0, 10.4], ['SOLVE.', 'Tech', 11.6, 10.4]]) { const m = signBoxTex(a, b2), g = new THREE.BoxGeometry(0.42, 0.5, 0.42); g.translate(x, zc - 0.45, -y); put(G, g, [m, m, F.black, F.black, m, m], { layer: 'ceiling', cast: false }); hangWire(G, x, y, zc - 0.2, zc); }
}

// ================================================================== DESIGN room (upper, east of the front open area) - from the design photos
{
  const G = space('Design', 'UF'), z0 = UFZ, zc = UFZ + 2.98;
  const fleck = (() => { const c = cv(512, 512), x = c.getContext('2d'); x.fillStyle = '#23262f'; x.fillRect(0, 0, 512, 512);
    for (let k = 0; k < 26000; k++) { const v = rnd(); x.fillStyle = v > 0.7 ? '#cfd3de' : v > 0.42 ? '#4d5470' : '#121420'; x.fillRect(rnd() * 512, rnd() * 512, 2 + rnd() * 3, 1.5); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / 1.2, 1 / 1.2); t.anisotropy = 8; return t; })();
  const D = { carpet: std({ map: fleck, normalMap: T.weaveN, roughness: 1 }), black: std({ color: 0x1c1d1f, roughness: 0.75 }), oakDark: std({ color: 0x6e6862, map: T.oakDark, roughness: 0.5 }),
    oak: std({ color: 0xffffff, map: T.oak, roughness: 0.45 }), blind: std({ color: 0x3a3b3d, roughness: 0.9, side: THREE.DoubleSide }), bin: std({ color: 0xcfd0d0, roughness: 0.4, metalness: 0.5 }) };
  patch(G, 12.73, 1.62, 16.52, 8.48, z0 + 0.012, D.carpet);
  // black walls (north / stair side and the west return), dark roller blinds half-down over the windows
  lining(G, 'x', 8.475, 12.73, 16.53, z0, zc, [], D.black, 0.012);
  lining(G, 'y', 12.73, 6.01, 8.49, z0, zc, [], D.black, 0.012);
  bx(G, 16.47, 2.24, z0 + 1.9, 16.5, 4.9, zc - 0.05, D.blind, { r: 0 }); bx(G, 16.47, 5.05, z0 + 1.6, 16.5, 7.73, zc - 0.05, D.blind, { r: 0 });
  bx(G, 11.52, 1.6, z0 + 1.8, 13.3, 1.63, zc - 0.05, D.blind, { r: 0 });
  // wall TV on the black north wall
  bx(G, 13.7, 8.43, z0 + 1.25, 15.5, 8.475, z0 + 2.27, M.tv, { r: 0.008 });
  { const sc = new THREE.PlaneGeometry(1.76, 0.98); sc.rotateY(Math.PI); sc.translate(14.6, z0 + 1.76, -8.428); put(G, sc, M.screen, { cast: false }); }
  // two back-to-back clusters of sit-stand desks: dark timber tops, black frames, dual monitors on arms, pedestals, mesh chairs, a bin
  const mc = meshChair();
  const cluster = (cx, y0, n) => { const w = 1.4, d = 0.72;
    for (let i = 0; i < n; i++) for (const side of [-1, 1]) { const dy0 = y0 + i * w + 0.02, dy1 = dy0 + w - 0.04, xA = side < 0 ? cx - d : cx, xB = xA + d, mid = (dy0 + dy1) / 2, edge = side < 0 ? xA : xB;
      bx(G, xA, dy0, z0 + 0.72, xB, dy1, z0 + 0.75, D.oakDark, { r: 0.004 });
      for (const ly of [dy0 + 0.1, dy1 - 0.1]) { bx(G, (xA + xB) / 2 - 0.03, ly - 0.03, z0, (xA + xB) / 2 + 0.03, ly + 0.03, z0 + 0.72, M.steel_black, { r: 0 }); bx(G, xA + 0.05, ly - 0.03, z0, xB - 0.05, ly + 0.03, z0 + 0.03, M.steel_black, { r: 0 }); }
      const mx = side < 0 ? cx - 0.16 : cx + 0.16;
      for (const oy of [-0.3, 0.3]) { bx(G, mx - 0.012, mid + oy - 0.28, z0 + 0.98, mx + 0.012, mid + oy + 0.28, z0 + 1.31, M.tv, { r: 0.004 });
        const sc = new THREE.PlaneGeometry(0.54, 0.31); sc.rotateY(side < 0 ? -Math.PI / 2 : Math.PI / 2); sc.translate(mx + (side < 0 ? -0.013 : 0.013), z0 + 1.145, -(mid + oy)); put(G, sc, rnd() > 0.4 ? M.work[Math.floor(rnd() * 3)] : M.screen, { cast: false }); }
      bx(G, mx - 0.02, mid - 0.02, z0 + 0.75, mx + 0.02, mid + 0.02, z0 + 1.0, M.steel_black, { r: 0 }); bx(G, mx - 0.03, mid - 0.32, z0 + 1.0, mx + 0.03, mid + 0.32, z0 + 1.03, M.steel_black, { r: 0 });
      bx(G, edge - side * 0.3 - 0.07, mid - 0.22, z0 + 0.75, edge - side * 0.3 + 0.07, mid + 0.22, z0 + 0.765, M.table_black, { r: 0.003 });
      const px = side < 0 ? xA + 0.02 : xB - 0.52; bx(G, px, dy0 + 0.08, z0, px + 0.5, dy0 + 0.3, z0 + 0.45, D.black, { r: 0.01 });
      place(mc, G, edge + side * 0.45, mid, z0, yawToward(-side, 0)); } };
  cluster(14.95, 2.0, 4);
  { const b = new THREE.CylinderGeometry(0.15, 0.13, 0.36, 20, 1, true); b.translate(16.15, z0 + 0.18, -8.0); put(G, b, D.bin); }
  // tall timber-topped bench along the west edge with drafting stools
  bx(G, 11.14, 1.9, z0, 11.56, 5.8, z0 + 1.02, D.black, { r: 0.006 }); bx(G, 11.11, 1.88, z0 + 1.02, 11.6, 5.82, z0 + 1.06, D.oak, { r: 0.006 });   // moved onto the front open area carpet
  { const st = new THREE.Group(), add = (geo, m) => { const o = new THREE.Mesh(geo, m); o.castShadow = o.receiveShadow = true; st.add(o); return o; };
    for (let k = 0; k < 5; k++) { const a = k * Math.PI * 2 / 5, arm = add(new THREE.BoxGeometry(0.3, 0.03, 0.04), M.steel_black); arm.position.set(Math.cos(a) * 0.15, 0.06, Math.sin(a) * 0.15); arm.rotation.y = -a; }
    add(new THREE.CylinderGeometry(0.025, 0.03, 0.62, 12), M.metal).position.y = 0.37; const ring = add(new THREE.TorusGeometry(0.2, 0.01, 8, 32), M.metal); ring.rotation.x = Math.PI / 2; ring.position.y = 0.38;
    add(new RoundedBoxGeometry(0.46, 0.08, 0.44, 3, 0.03), M.chair).position.y = 0.72;
    const bk = add(new RoundedBoxGeometry(0.44, 0.42, 0.03, 2, 0.012), M.mesh_back); bk.position.set(0, 1.0, 0.23);
    for (const y of [2.6, 3.8, 5.0]) { const s2 = st.clone(); s2.position.copy(P(11.98, y, z0)); s2.rotation.y = yawToward(-1, 0); G.add(s2); } }
  // warm linear pendants, downlights, hanging IMAGINE./DOMINATE. signs
  for (const [ya, yb] of [[2.2, 4.6], [5.0, 7.4]]) { const x = 14.95; bx(G, x - 0.035, ya, zc - 0.62, x + 0.035, yb, zc - 0.57, M.steel_black, { r: 0.004, layer: 'ceiling', cast: false }); bx(G, x - 0.025, ya + 0.02, zc - 0.625, x + 0.025, yb - 0.02, zc - 0.62, M.led, { r: 0, layer: 'ceiling', cast: false });
    hangWire(G, x, ya + 0.3, zc - 0.57, zc); hangWire(G, x, yb - 0.3, zc - 0.57, zc); }
  { const geos = []; for (const [x, y] of [[13.2, 2.4], [15.8, 2.4], [13.2, 5.0], [15.8, 5.0], [13.2, 7.8], [15.8, 7.8]]) { const c = new THREE.CylinderGeometry(0.045, 0.045, 0.01, 16); c.translate(x, zc - 0.02, -y); geos.push(c.ni()); }
    put(G, mergeGeometries(geos), M.led_cool, { cast: false, layer: 'ceiling' });
    const l = new THREE.PointLight(0xffe2bd, 5, 7, 2); l.position.copy(P(14.75, 5.0, zc - 0.8)); G.add(l); layers.ceiling.push(l); }
  const sTex = (a, b) => { const c = cv(256, 384), x = c.getContext('2d'); x.fillStyle = '#111214'; x.fillRect(0, 0, 256, 384); x.fillStyle = '#f2f1ee';
    x.font = '800 38px Archivo, Arial, sans-serif'; x.fillText(a, 22, 66); x.font = '500 12px "IBM Plex Mono", monospace'; x.fillText('BY AIIMS', 24, 86); x.font = 'italic 600 34px Georgia, serif'; x.fillText(b, 90, 340);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return std({ map: t, roughness: 0.6 }); };
  for (const [a, b, x, y] of [['IMAGINE.', 'Design', 12.95, 7.3], ['DOMINATE.', 'SEO', 12.95, 6.5]]) { const m = sTex(a, b), g = new THREE.BoxGeometry(0.42, 0.5, 0.42); g.translate(x, zc - 0.45, -y); put(G, g, [m, m, D.black, D.black, m, m], { layer: 'ceiling', cast: false }); hangWire(G, x, y, zc - 0.2, zc); }
}

// ================================================================== EAST OPEN AREA (upper floor) - herringbone office with black walls
{
  const G = space('East office', 'UF'), z0 = UFZ, zc = UFZ + 2.98;
  patch(G, 10.9, 12.12, 16.52, 21.28, z0 + 0.004, M.chevron);
  patch(G, 9.33, 12.12, 10.9, 20.1, z0 + 0.004, M.tile_light);
  patch(G, 15.1, 12.12, 16.52, 21.28, z0 + 0.007, M.carpet);
  // black walls: stair wall (with mural), east facade inner face, kitchen partition
  lining(G, 'x', 12.11, 12.14, 16.53, z0, zc, [], M.black_panel);
  { const mu = new THREE.PlaneGeometry(3.4, 2.3); mu.rotateY(Math.PI); mu.translate(14.35, z0 + 1.6, -12.13); put(G, mu, M.mural, { cast: false }); }
  const wins = DATA.windows.filter(w => w.f === 'UF' && w.a[0] > 16 && Math.max(w.a[1], w.b[1]) > 12 && Math.min(w.a[1], w.b[1]) < 21.3)
    .map(w => [Math.min(w.a[1], w.b[1]), Math.max(w.a[1], w.b[1]), UFZ + w.sill, UFZ + w.head]);
  lining(G, 'y', 16.518, 12.12, 21.28, z0, zc, wins, M.black_panel);
  lining(G, 'x', 21.27, 13.65, 16.53, z0, zc, [], M.black_panel);
  // sit-stand desks: dark oak tops, black frames, dual monitors, pedestals, mesh chairs
  const mc = meshChair();
  const desk = (x, cy, side) => {   // side -1: desk south of the spine, user sits south facing north; side +1: mirrored
    const d = 0.75, w = 1.4, y0 = side < 0 ? cy - d : cy, y1 = y0 + d, edge = side < 0 ? y0 : y1, spine = side < 0 ? y1 : y0;
    bx(G, x - w / 2, y0, z0 + 0.72, x + w / 2, y1, z0 + 0.75, M.door, { r: 0.004 });
    for (const sx of [-w / 2 + 0.12, w / 2 - 0.12]) { bx(G, x + sx - 0.035, (y0 + y1) / 2 - 0.035, z0 + 0.02, x + sx + 0.035, (y0 + y1) / 2 + 0.035, z0 + 0.72, M.steel_black, { r: 0 });
      bx(G, x + sx - 0.035, y0 + 0.05, z0, x + sx + 0.035, y1 - 0.05, z0 + 0.03, M.steel_black, { r: 0 }); }
    const py0 = side < 0 ? y0 + 0.2 : y1 - 0.6; bx(G, x + 0.18, py0, z0, x + 0.58, py0 + 0.4, z0 + 0.6, M.table_black, { r: 0.01 });
    const my = spine + (side < 0 ? -0.15 : 0.15);
    for (const dx of [-0.29, 0.29]) { bx(G, x + dx - 0.27, my - 0.012, z0 + 0.93, x + dx + 0.27, my + 0.012, z0 + 1.26, M.tv, { r: 0.004 });
      const sc = new THREE.PlaneGeometry(0.52, 0.3); if (side > 0) sc.rotateY(Math.PI); sc.translate(x + dx, z0 + 1.095, -(my + (side < 0 ? -0.013 : 0.013))); put(G, sc, M.work[Math.floor(rnd() * 3)], { cast: false }); }
    bx(G, x - 0.015, my - 0.015, z0 + 0.75, x + 0.015, my + 0.015, z0 + 1.0, M.steel_black, { r: 0 });
    const ky = side < 0 ? y0 + 0.2 : y1 - 0.34; bx(G, x - 0.22, ky, z0 + 0.75, x + 0.22, ky + 0.14, z0 + 0.765, M.table_black, { r: 0.003 });
    place(mc, G, x - 0.1, edge - side * -0.42, z0, yawToward(0, -side));
  };
  for (const cy of [14.55, 18.15]) for (const x of [11.9, 13.35, 14.8]) { desk(x, cy, -1); desk(x, cy, 1); }
  // black linear pendants and downlights
  for (const cy of [14.55, 18.15]) for (const dy of [-0.6, 0.6]) { const y = cy + dy; bx(G, 11.2, y - 0.035, zc - 0.6, 15.5, y + 0.035, zc - 0.55, M.steel_black, { r: 0.005, layer: 'ceiling', cast: false });
    bx(G, 11.22, y - 0.02, zc - 0.605, 15.48, y + 0.02, zc - 0.6, M.led, { r: 0, layer: 'ceiling', cast: false }); hangWire(G, 11.6, y, zc - 0.55, zc); hangWire(G, 15.1, y, zc - 0.55, zc); }
  { const geos = []; for (let x = 11.4; x < 16.3; x += 1.2) for (let y = 12.8; y < 21; y += 1.4) { const c = new THREE.CylinderGeometry(0.045, 0.045, 0.01, 16); c.translate(x, zc - 0.03, -y); geos.push(c.ni()); }
    put(G, mergeGeometries(geos), M.led_cool, { cast: false, layer: 'ceiling' }); }
  bx(G, 10.05, 12.4, zc - 0.03, 10.12, 19.9, zc - 0.015, M.led_cool, { r: 0, layer: 'ceiling', cast: false });
  // hanging signs
  for (const [k, x, y] of [[0, 12.3, 16.3], [1, 14.2, 16.3], [2, 15.9, 19.8]]) { const g = new RoundedBoxGeometry(0.46, 0.46, 0.12, 2, 0.01); g.translate(x, zc - 0.62, -y);
    put(G, g, [M.table_black, M.table_black, M.table_black, M.table_black, M.hang[k], M.hang[k]], { layer: 'ceiling', cast: false }); hangWire(G, x, y, zc - 0.39, zc); }
  { const l = new THREE.PointLight(0xfff3e2, 8, 10, 2); l.position.copy(P(13.4, 16.3, zc - 0.7)); G.add(l); layers.ceiling.push(l); }
  // storage wall with open shelving at the north end
  bx(G, 13.7, 20.8, z0, 16.4, 21.25, z0 + 2.1, M.table_black, { r: 0.01 });
  for (let k = 0; k < 3; k++) bx(G, 13.75 + k * 0.9, 20.75, z0 + 1.5, 14.55 + k * 0.9, 20.8, z0 + 1.52, M.shelf, { r: 0 });
}
// the new rooms receive shadows; walls cast
Object.values(SP).forEach(g => g.traverse(o => { if (o.isMesh && !o.material.transparent) o.receiveShadow = true; }));

// ================================================================== SITE / EXTERIOR (street photo): pavers, neighbour, sign tower, canopy, trees, AIIMS Jimny
const site = new THREE.Group(); site.name = 'Site'; scene.add(site);
{
  // --- textures
  const pavTex = (base, jitter, size = 512) => { const n = fbm(size, 8, 4), cols = []; for (let k = 0; k < 64; k++) cols.push(1 + (rnd() - 0.5) * jitter);
    const c = hex(base); return paint(size, (x, y, i) => { const row = Math.floor(y / size * 16), off = (row % 2) * 0.5, u = (x / size * 8 + off) % 8, col = Math.floor(u);
      const fu = u - col, fv = (y / size * 16) % 1, joint = fu < 0.05 || fv < 0.1; const k = joint ? 0.62 : cols[(row * 8 + col) % 64] * (0.92 + n[i] * 0.16);
      return [c[0] * k, c[1] * k, c[2] * k]; }); };
  S.pavGrey = tex(pavTex(0xa9a7a2, 0.14), 1.6, 1.6);      // 200 x 100 pavers in stretcher bond
  S.pavBrick = tex(pavTex(0xa8664a, 0.2), 1.6, 1.6);
  { const size = 512, n = fbm(size, 4, 5), st = fbm(size, 16, 2); S.tilt = tex(paint(size, (x, y, i) => {
      const joint = (x % 171) < 3; const streak = Math.max(0, st[(x % size)] - 0.55) * 1.6 * (1 - y / size); const k = (joint ? 0.72 : 0.9 + n[i] * 0.12) - streak * 0.25;
      return [214 * k, 211 * k, 202 * k]; }), 9, 10); }
  const signTex = (w, h, draw) => { const c = cv(w, h), ctx = c.getContext('2d'); draw(ctx, w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
  const aiims = (ctx, x, y, size, color = '#f5f4f0') => { ctx.fillStyle = color; ctx.font = `900 ${size}px Archivo, "Arial Black", Arial, sans-serif`; ctx.textBaseline = 'middle'; ctx.fillText('AIIMS', x, y); };
  S.signMain = signTex(512, 192, (ctx, w, h) => { ctx.fillStyle = '#101112'; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = '#e9e8e4'; ctx.lineWidth = 8; ctx.strokeRect(10, 10, w - 20, h - 20); ctx.textAlign = 'center'; aiims(ctx, w / 2, h / 2 + 6, 118); });
  S.signMotto = signTex(512, 192, (ctx, w, h) => { ctx.fillStyle = '#101112'; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = '#d9d8d4'; ctx.lineWidth = 5; ctx.strokeRect(8, 8, w - 16, h - 16);
    ctx.fillStyle = '#f5f4f0'; ctx.textAlign = 'center'; ctx.font = '800 62px Archivo, Arial, sans-serif'; ctx.fillText('BE FEARLESS', w / 2, 82); ctx.fillText('TOGETHER', w / 2, 150); });
  S.sign2010 = signTex(256, 128, (ctx, w, h) => { ctx.fillStyle = '#101112'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#f5f4f0'; ctx.textAlign = 'center'; ctx.font = '800 70px Archivo, Arial, sans-serif'; ctx.fillText('2010', w / 2, 92); });
  S.fascia = signTex(1024, 96, (ctx, w, h) => { ctx.fillStyle = '#1b1c1e'; ctx.fillRect(0, 0, w, h); ctx.textAlign = 'right'; aiims(ctx, w - 30, h / 2 + 4, 70); });
  S.number = signTex(128, 128, (ctx, w, h) => { ctx.fillStyle = '#1b1c1e'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#f5f4f0'; ctx.textAlign = 'center'; ctx.font = '700 96px Archivo, Arial, sans-serif'; ctx.fillText('9', 64, 100); });
  S.shared = signTex(128, 192, (ctx, w, h) => { ctx.fillStyle = '#fbfbf8'; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = '#111'; ctx.lineWidth = 5; ctx.strokeRect(5, 5, w - 10, h - 10);
    ctx.beginPath(); ctx.arc(64, 58, 38, 0, Math.PI * 2); ctx.strokeStyle = '#d42a26'; ctx.lineWidth = 9; ctx.stroke(); ctx.fillStyle = '#111'; ctx.textAlign = 'center'; ctx.font = '800 38px Arial'; ctx.fillText('10', 64, 72);
    ctx.font = '800 22px Arial'; ctx.fillText('SHARED', 64, 132); ctx.fillText('ZONE', 64, 160); });
}
const MS = {
  pavGrey: std({ map: S.pavGrey, roughness: 0.9, envMapIntensity: 0.5 }),
  pavBrick: std({ map: S.pavBrick, roughness: 0.9, envMapIntensity: 0.5 }),
  tilt: std({ map: S.tilt, roughness: 0.85 }),
  green: std({ color: 0x2f6a3f, roughness: 0.5, metalness: 0.4 }),
  signMain: std({ map: S.signMain, roughness: 0.5 }), signMotto: std({ map: S.signMotto, roughness: 0.5 }), sign2010: std({ map: S.sign2010, roughness: 0.5 }),
  fascia: std({ map: S.fascia, roughness: 0.5 }), number: std({ map: S.number, roughness: 0.5 }), shared: std({ map: S.shared, roughness: 0.5 }),
  steel: std({ color: 0x232426, roughness: 0.5, metalness: 0.5 }),
  soffit: std({ color: 0xffffff, map: T.batten, roughness: 0.7 }),
  foliage: std({ map: T.leaf, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.7, color: 0xc8d8b8 }),
  lamp: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.1, 1.9) }),
};
{
  // --- paving: grey pavers across the car park, clay-brick band along the frontage
  const brick = [[-2.4, -6.5], [20, -6.5], [20, 1.55], [9.6, 1.55], [9.6, 0], [-2.4, 0]];
  const hole = [[-2.4, -6.5], [20, -6.5], [20, 1.55], [16.84, 1.55], [16.84, 25.86], [0, 25.86], [0, 0], [-2.4, 0]];
  const poly = (pts, sh = new THREE.Shape()) => { sh.moveTo(...pts[0]); pts.slice(1).forEach(p => sh.lineTo(...p)); sh.closePath(); return sh; };
  const outer = poly([[-26, -40], [52, -40], [52, 44], [-26, 44]]); outer.holes.push(poly(hole.slice().reverse(), new THREE.Path()));
  const g1 = new THREE.ShapeGeometry(outer); g1.rotateX(-Math.PI / 2); put(site, g1, MS.pavGrey, { cast: false });
  const g2 = new THREE.ShapeGeometry(poly(brick)); g2.rotateX(-Math.PI / 2); g2.translate(0, 0.004, 0); put(site, g2, MS.pavBrick, { cast: false });
  // --- neighbouring tilt-up warehouse with green trim (west)
  bx(site, -22, 1.4, 0, -0.7, 40, 9.8, MS.tilt, { r: 0 });
  bx(site, -22.1, 1.3, 9.55, -0.6, 40, 9.85, MS.green, { r: 0 }); bx(site, -22.15, 1.25, 0, -21.9, 1.5, 9.85, MS.green, { r: 0 }); bx(site, -0.85, 1.25, 0, -0.6, 1.5, 9.85, MS.green, { r: 0 });
  // --- black sign tower at the front-left corner
  bx(site, -2.3, -0.9, 0, 0.05, 1.8, 9.2, M.charcoal, { r: 0.01 });
  const face = (mat, x0, x1, z0, z1) => { const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0); g.translate((x0 + x1) / 2, (z0 + z1) / 2, 0.915); put(site, g, mat, { cast: false }); };
  face(MS.signMain, -2.05, -0.2, 7.0, 7.75);
  face(MS.signMotto, -2.15, -0.1, 4.3, 5.05); face(MS.sign2010, -1.5, -0.75, 2.1, 2.45);
  // --- downpipes, address number, entry planters
  for (const [x, y] of [[9.42, -0.06], [16.72, 1.46], [0.12, -0.06]]) { const p = new THREE.CylinderGeometry(0.05, 0.05, 7.6, 12); p.translate(x, 3.8, -y); put(site, p, MS.steel); }
  { const n = new THREE.PlaneGeometry(0.3, 0.3); n.translate(12.95, 2.6, -1.395); put(site, n, MS.number, { cast: false }); }
  // --- steel canopy over the parking (east), AIIMS on the fascia
  { const X0 = 16.9, X1 = 31.5, Y0 = -5.0, Y1 = 22.0, zb = 6.55, zt = 7.55;
    bx(site, X0, Y0, zt - 0.15, X1, Y1, zt, MS.steel, { r: 0 });
    bx(site, X0, Y0 - 0.25, zb, X1 + 0.25, Y0, zt + 0.15, MS.steel, { r: 0 }); bx(site, X1, Y0, zb, X1 + 0.25, Y1, zt + 0.15, MS.steel, { r: 0 });
    { const f = new THREE.PlaneGeometry(X1 + 0.25 - X0, zt + 0.15 - zb); f.translate((X0 + X1 + 0.25) / 2, (zb + zt + 0.15) / 2, -(Y0 - 0.252)); put(site, f, MS.fascia, { cast: false }); }
    for (let y = Y0 + 0.6; y < Y1; y += 0.9) bx(site, X0, y - 0.06, zt - 0.32, X1, y + 0.06, zt - 0.15, MS.soffit, { r: 0 });
    for (const x of [21.8, 26.7]) bx(site, x - 0.15, Y0, zb + 0.2, x + 0.15, Y1, zt - 0.15, MS.steel, { r: 0 });
    for (const y of [Y0 + 0.4, 8.5, Y1 - 0.4]) bx(site, X1 - 0.45, y - 0.2, 0, X1 - 0.05, y + 0.2, zb + 0.2, MS.steel, { r: 0.01 });
    for (let x = 19.3; x < X1; x += 4.8) for (let y = Y0 + 2.5; y < Y1; y += 5.5) { const d = new THREE.CylinderGeometry(0.16, 0.16, 0.06, 16); d.translate(x, zt - 0.36, -y); put(site, d, MS.lamp, { cast: false }); } }
  // --- street light, shared-zone sign
  { const p = new THREE.CylinderGeometry(0.06, 0.09, 6.2, 12); p.translate(-3.8, 3.1, 5.2); put(site, p, MS.steel);
    bx(site, -4.3, -5.35, 6.0, -3.2, -5.05, 6.25, MS.steel, { r: 0.02 }); bx(site, -4.25, -5.33, 5.97, -3.25, -5.07, 6.0, MS.lamp, { r: 0, cast: false });
    const s = new THREE.CylinderGeometry(0.03, 0.03, 2.4, 8); s.translate(-2.9, 1.2, 2.9); put(site, s, MS.steel);
    const sg = new THREE.PlaneGeometry(0.4, 0.6); sg.translate(-2.9, 2.1, 2.93); put(site, sg, MS.shared, { cast: false }); }
  // --- trees: street trees at the frontage, a stand of gums behind the canopy
  const tree = (x, y, h, r, n) => { const t = new THREE.CylinderGeometry(0.06 * h / 4, 0.1 * h / 4, h * 0.6, 8); t.translate(x, h * 0.3, -y); put(site, t, M.bark);
    const lv = []; for (let k = 0; k < n * 2; k++) leafCluster(x + (rnd() - 0.5) * r * 1.4, y + (rnd() - 0.5) * r * 1.4, h * (0.6 + rnd() * 0.4), r * (0.35 + rnd() * 0.2), lv, { n: 36, w: 1.9, h: 0.55, up: 0.0, spread: 1.0 });
    put(site, mergeGeometries(lv), MS.foliage); };
  tree(-1.4, -2.2, 3.6, 1.2, 5); tree(9.9, 0.6, 2.4, 0.6, 3); tree(16.2, 0.9, 2.2, 0.5, 3);
  for (const [x, y, h] of [[35, -6, 9], [38, 0, 11], [36, 7, 8.5], [40, 12, 10], [37, 18, 9], [42, -2, 12], [41, 24, 9]]) tree(x, y, h, h * 0.42, 6);
  // low planter bed at the tower
  bx(site, -2.6, -3.0, 0, -0.2, -1.2, 0.35, M.charcoal, { r: 0.02 });
}

// --- AIIMS Suzuki Jimny (5-door) in black with the AIIMS livery
function makeJimny() {
  const car = new THREE.Group(); car.name = 'AIIMS Jimny';
  const paint = std({ color: 0x0e0f10, roughness: 0.22, metalness: 0.6, envMapIntensity: 1.2 });
  const matte = std({ color: 0x161718, roughness: 0.8 });
  const glassC = std({ color: 0x2a3440, roughness: 0.04, metalness: 0.75, envMapIntensity: 2.0 });
  const rubber = std({ color: 0x151515, roughness: 0.95 });
  const rimM = std({ color: 0x2c2d2f, roughness: 0.35, metalness: 0.7 });
  const chrome = std({ color: 0xdadada, roughness: 0.1, metalness: 1 });
  const lampM = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.3, 1.3, 1.25) });
  const amber = std({ color: 0xe0801c, roughness: 0.3, emissive: 0x552200 });
  const redL = std({ color: 0x9a1512, roughness: 0.3, emissive: 0x300000 });
  const add = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; car.add(m); return m; };
  const L = 3.48, W = 1.645, ax = 1.08, WB = 2.25;  // 3-door Jimny: 3.48 m long, 2.25 m wheelbase, front axle at +x
  add(new RoundedBoxGeometry(L - 0.2, 0.77, W - 0.06, 4, 0.06), paint, 0, 0.835, 0);        // lower body (tall, boxy Jimny sides)
  add(new RoundedBoxGeometry(2.26, 0.6, W - 0.14, 4, 0.05), paint, -0.5, 1.52, 0);         // cabin
  add(new RoundedBoxGeometry(1.0, 0.05, W - 0.12, 3, 0.02), paint, 1.1, 1.215, 0);           // bonnet top
  // glazing (near-vertical Jimny windscreen and side glass)
  { const ws = new THREE.PlaneGeometry(W - 0.26, 0.5); ws.rotateY(Math.PI / 2); ws.rotateZ(0.12); add(ws, glassC, 0.63, 1.49, 0); }
  for (const sz of [1, -1]) { const zz = sz * (W / 2 - 0.068);
    for (const [x0, x1] of [[-0.36, 0.46], [-1.3, -0.72]]) { const g = new THREE.PlaneGeometry(x1 - x0, 0.46); if (sz < 0) g.rotateY(Math.PI); add(g, glassC, (x0 + x1) / 2, 1.49, zz + sz * 0.002); }
    // fender flares and side step
    for (const x of [ax, ax - WB]) { const f = new THREE.TorusGeometry(0.41, 0.045, 6, 24, Math.PI); f.scale(1, 1, 1.8); add(f, matte, x, 0.345, sz * (W / 2 + 0.03)); }
    add(new RoundedBoxGeometry(0.8, 0.05, 0.1, 2, 0.02), matte, -0.05, 0.4, sz * (W / 2 - 0.03));
    // mirror
    add(new RoundedBoxGeometry(0.14, 0.11, 0.1, 2, 0.03), paint, 0.5, 1.3, sz * (W / 2 + 0.06));
    // livery decal
    const dg = new THREE.PlaneGeometry(2.95 * 0.7, 0.58 * 0.7); if (sz < 0) dg.rotateY(Math.PI); add(dg, decalSide, -0.07, 1.02, sz * (W / 2 - 0.028));
  }
  // wheels
  for (const x of [ax, ax - WB]) for (const sz of [1, -1]) {
    const w = new THREE.Group(); w.position.set(x, 0.345, sz * (W / 2 - 0.02)); car.add(w);
    const tyre = new THREE.Mesh(new THREE.CylinderGeometry(0.345, 0.345, 0.2, 32), rubber); tyre.rotation.x = Math.PI / 2; tyre.castShadow = true; w.add(tyre);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.205, 24), rimM); rim.rotation.x = Math.PI / 2; w.add(rim);
    for (let k = 0; k < 5; k++) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.19, 0.02), matte); s.position.z = sz * 0.104; s.rotation.z = k * Math.PI * 2 / 5; s.position.x = Math.sin(k * Math.PI * 2 / 5) * 0.09; s.position.y = Math.cos(k * Math.PI * 2 / 5) * 0.09; w.add(s); }
  }
  // spare wheel on the tailgate
  { const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.2, 28), rubber); sp.rotation.z = Math.PI / 2; sp.position.set(-L / 2 - 0.05, 1.05, 0); sp.castShadow = true; car.add(sp); }
  // front: five-slot grille, round lamps, bumper
  const fx = L / 2 - 0.1;
  add(new RoundedBoxGeometry(0.04, 0.3, 0.72, 2, 0.01), matte, fx + 0.02, 0.97, 0);
  for (let k = -2; k <= 2; k++) add(new THREE.BoxGeometry(0.02, 0.24, 0.07), glassC, fx + 0.045, 0.97, k * 0.13);
  for (const sz of [1, -1]) { const hl = new THREE.CylinderGeometry(0.1, 0.1, 0.03, 24); hl.rotateZ(Math.PI / 2); add(hl, lampM, fx + 0.03, 0.99, sz * 0.58);
    const ring = new THREE.TorusGeometry(0.105, 0.012, 8, 24); ring.rotateY(Math.PI / 2); add(ring, chrome, fx + 0.045, 0.99, sz * 0.58);
    add(new THREE.BoxGeometry(0.03, 0.05, 0.12), amber, fx + 0.03, 0.82, sz * 0.62); add(new THREE.BoxGeometry(0.03, 0.14, 0.08), redL, -L / 2 + 0.08, 1.1, sz * 0.72); }
  add(new RoundedBoxGeometry(0.22, 0.24, W + 0.02, 3, 0.05), matte, fx + 0.03, 0.62, 0);
  add(new RoundedBoxGeometry(0.2, 0.22, W + 0.02, 3, 0.05), matte, -L / 2 + 0.06, 0.6, 0);
  { const pl = new THREE.PlaneGeometry(0.34, 0.1); pl.rotateY(Math.PI / 2); add(pl, plateM, fx + 0.145, 0.64, 0.3); }
  // bonnet roundel, roof light bar and rails
  { const h = new THREE.PlaneGeometry(0.72, 0.36); h.rotateX(-Math.PI / 2); h.rotateY(-Math.PI / 2); add(h, decalHood, 1.1, 1.242, 0); }
  add(new RoundedBoxGeometry(0.12, 0.06, 1.2, 2, 0.02), matte, 0.45, 1.85, 0); add(new RoundedBoxGeometry(0.1, 0.03, 1.15, 1, 0.01), lampM, 0.515, 1.85, 0);
  for (const sz of [1, -1]) add(new RoundedBoxGeometry(1.95, 0.04, 0.05, 2, 0.015), matte, -0.52, 1.84, sz * 0.66);
  return car;
}
const decalSide = (() => { const c = cv(1024, 200), ctx = c.getContext('2d'); ctx.clearRect(0, 0, 1024, 200);
  ctx.fillStyle = '#f7f6f2'; ctx.font = '900 150px Archivo, "Arial Black", Arial, sans-serif'; ctx.textBaseline = 'alphabetic'; ctx.fillText('AIIMS', 90, 138);
  ctx.fillStyle = '#c4332b'; ctx.font = '800 38px Archivo, Arial, sans-serif'; ctx.fillText('DREAM UP. GROW. THRIVE.', 95, 188); ctx.fillStyle = '#f7f6f2'; ctx.font = '600 26px Archivo, Arial'; ctx.fillText('.com.au', 612, 138);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.3, metalness: 0.2, polygonOffset: true, polygonOffsetFactor: -2 }); })();
const decalHood = (() => { const c = cv(256, 128), ctx = c.getContext('2d'); ctx.fillStyle = '#f7f6f2'; ctx.beginPath(); ctx.ellipse(128, 64, 124, 58, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#0e0f10'; ctx.font = '900 52px Archivo, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('AIIMS', 128, 68);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.3, polygonOffset: true, polygonOffsetFactor: -2 }); })();
const plateM = (() => { const c = cv(256, 76), ctx = c.getContext('2d'); ctx.fillStyle = '#f4f4f0'; ctx.fillRect(0, 0, 256, 76); ctx.strokeStyle = '#111'; ctx.lineWidth = 4; ctx.strokeRect(3, 3, 250, 70);
  ctx.fillStyle = '#111'; ctx.font = '700 44px Arial'; ctx.textAlign = 'center'; ctx.fillText('AIIMS', 128, 54); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return std({ map: t, roughness: 0.4 }); })();
// four fleet Jimnys in an echelon row, all at the same angle so the side livery faces the street
for (let k = 0; k < 4; k++) { const j = makeJimny(); j.position.copy(P(0.8 + k * 4.6, -7.8, 0.004)); j.rotation.y = -2.62; site.add(j); }

// linear LED pendants over the workstations (walk views)
{ const geos = { GF: [], UF: [] }, wires = { GF: [], UF: [] };
  for (const [f, x, y, len] of [['GF', 3.2, 3.9, 2.6], ['GF', 7.2, 3.9, 2.6], ]) {
    const z = f === 'UF' ? UFZ + 2.55 : 3.0; const g = new THREE.BoxGeometry(len, 0.012, 0.05); g.translate(x, z - 0.03, -y); geos[f].push(g.ni());
    const h = new THREE.BoxGeometry(len, 0.05, 0.06); h.translate(x, z, -y); wires[f].push(h.ni());
    for (const dx of [-len / 2 + 0.2, len / 2 - 0.2]) { const w = new THREE.BoxGeometry(0.003, (f === 'UF' ? UFZ + 2.97 : 4.18) - z, 0.003); w.translate(x + dx, z + ((f === 'UF' ? UFZ + 2.97 : 4.18) - z) / 2, -y); wires[f].push(w.ni()); } }
  for (const f of ['GF', 'UF']) { if (!geos[f].length) continue; addMesh(mergeGeometries(geos[f]), M.led_cool, f, 'ceiling', { cast: false }); addMesh(projectUV(mergeGeometries(wires[f])), M.steel_black, f, 'ceiling', { cast: false }); }
}
layers.ceiling.forEach(m => m.visible = false);

// ------------------------------------------------------------------ post-processing
let composer, gtao, bloom;
function buildComposer() {
  const w = stage.clientWidth || 800, h = stage.clientHeight || 600;
  const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 });
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  gtao = new GTAOPass(scene, camera, w, h);
  gtao.output = GTAOPass.OUTPUT.Default; gtao.blendIntensity = 0.9;
  gtao.updateGtaoMaterial({ radius: 0.5, distanceExponent: 1.5, thickness: 1.5, scale: 1.1, samples: 16, distanceFallOff: 1 });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, radiusExponent: 1, rings: 2, samples: 16 });
  const origRender = gtao.render.bind(gtao);
  gtao.render = (...a) => { const hidden = []; scene.traverse(o => { if (o.isMesh && o.visible && (o.material.transparent || o === sky)) { o.visible = false; hidden.push(o); } }); origRender(...a); hidden.forEach(o => o.visible = true); };
  composer.addPass(gtao);
  bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.28, 0.5, 1.0); composer.addPass(bloom);
  composer.addPass(new OutputPass());
}
buildComposer();

// ------------------------------------------------------------------ labels
DATA.labels.push({ floor: 'UF', text: 'Design', point: [14.6, 4.6, 4.49] });
DATA.labels.push({ floor: 'UF', text: 'Common Area', point: [7.6, 7.3, 4.49] });
const LBL = DATA.labels.map(l => { const el = document.createElement('div'); el.className = 'lbl';
  el.textContent = l.text.replace(' / deck hypothesis', '').replace('Entry / foyer', 'Entry lounge'); labelsEl.appendChild(el);
  return { el, floor: l.floor, p: new THREE.Vector3(l.point[0], (l.floor === 'UF' ? UFZ : 0) + 0.9, -l.point[1]) }; });

// ------------------------------------------------------------------ views / state
const state = { view: 'ext', walkFloor: 'GF', fit: true, lbl: true, stair: true, fac: true, roof: true, cur: true, hq: true, explode: 0, explodeTarget: 0 };
if (window.__noHQ) { state.hq = false; document.getElementById('l-hq').checked = false; }
const controls = new OrbitControls(camera, renderer.domElement);
window.__cam = { camera, controls };
controls.enableDamping = true; controls.dampingFactor = 0.08; controls.maxPolarAngle = Math.PI * 0.495; controls.minDistance = 2; controls.maxDistance = 120;
const PRESETS = {
  ext: { pos: [5.5, 2.8, 37], tgt: [12.5, 3.8, -2], hint: 'Click anywhere to jump there · drag to orbit · scroll to zoom', chip: 'Exterior' },
  gf: { pos: [CX + 17, 22, 13], tgt: [CX, 0, CZ], hint: 'Upper floor hidden · drag to orbit, scroll to zoom', chip: 'Ground floor' },
  uf: { pos: [CX - 15, 26, 14], tgt: [CX, UFZ, CZ], hint: 'Roof hidden · drag to orbit, scroll to zoom', chip: 'Upper floor' },
  exp: { pos: [CX + 30, 26, 22], tgt: [CX, 5, CZ], hint: 'Upper floor lifted 6 m for inspection only', chip: 'Exploded' },
  top: { pos: [CX, 46, CZ + 0.01], tgt: [CX, 0, CZ], hint: 'Plan view · use Ground or Upper to switch storey', chip: 'Plan' },
};
let tween = null;
function flyTo(pos, tgt, dur = 900) {
  const to = { p: new THREE.Vector3(...pos), t: new THREE.Vector3(...tgt) };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { camera.position.copy(to.p); controls.target.copy(to.t); return; }
  tween = { from: { p: camera.position.clone(), t: controls.target.clone() }, to, t0: performance.now(), dur };
}
const walk = { yaw: 0, pitch: 0, keys: {}, pos: new THREE.Vector3() };
const WALK_START = { GF: { p: [11.9, 1.0], yaw: 0, pitch: -0.05, eye: 1.65 }, UF: { p: [12.0, 5.2], yaw: 0.75, pitch: -0.05, eye: 1.65, f: 'UF' },
  'sp-walk': { p: [12.4, 5.9], yaw: 0.17, pitch: 0.06, eye: 1.5, name: 'Entry lounge · walk-through' },
  'sp-window': { p: [14.05, 17.6], yaw: Math.PI + 0.05, pitch: -0.05, eye: 1.55, name: 'Warehouse · podcast window' },
  'sp-kynan': { p: [8.6, 18.9], yaw: Math.PI / 2 + 0.1, pitch: 0.06, eye: 1.55, name: 'Warehouse · Kynan' },
  'sp-lounge': { p: [11.6, 2.35], yaw: -0.62, pitch: 0.06, eye: 1.45, name: 'Entry lounge' },
  'sp-court': { p: [6.75, 10.45], yaw: -0.12, pitch: 0.1, eye: 1.3, f: 'UF', name: 'Courtyard' },
  'sp-ware': { p: [16.2, 20.3], yaw: Math.PI / 2 + 0.5, pitch: 0.06, eye: 1.5, name: 'Warehouse' },
  'sp-photo': { p: [8.6, 21.4], yaw: 0.78, pitch: 0.02, eye: 1.5, name: 'Storage · photo area' },
  'sp-studio': { p: [10.1, 21.35], yaw: 0, pitch: -0.04, eye: 1.4, name: 'Storage · podcast set' },
  'sp-desks': { p: [12.4, 21.45], yaw: -0.72, pitch: 0.04, eye: 1.45, name: 'Storage · black desks' },
  'sp-common': { p: [12.1, 6.4], yaw: 0.8, pitch: -0.02, eye: 1.5, f: 'UF', name: 'Common Area' },
  'sp-front': { p: [11.4, 7.4], yaw: Math.PI / 2 + 0.45, pitch: -0.12, eye: 1.6, f: 'UF', name: 'Front open area' },
  'sp-design': { p: [13.45, 8.3], yaw: -2.5, pitch: -0.2, eye: 1.7, f: 'UF', name: 'Design' },
  'sp-kitchen': { p: [12.4, 20.5], yaw: 0.55, pitch: 0.02, eye: 1.4, f: 'UF', name: 'Kitchen' },
  'sp-dining': { p: [12.75, 21.6], yaw: -0.8, pitch: 0.02, eye: 1.3, f: 'UF', name: 'Kitchen · dining nook' },
  'sp-office': { p: [10.5, 20.5], yaw: -2.77, pitch: -0.06, eye: 1.55, f: 'UF', name: 'East open area' } };
function enterWalk(key) {
  const s = WALK_START[key], fl = s.f || 'GF'; state.walkFloor = fl;
  walk.pos.set(s.p[0], (fl === 'UF' ? UFZ : 0) + s.eye, -s.p[1]); walk.yaw = s.yaw; walk.pitch = s.pitch;
  controls.enabled = false; tween = null;
}
let dragging = false, lx = 0, ly = 0;
const cvs = renderer.domElement;
cvs.addEventListener('pointerdown', e => { if (!isWalk()) return; dragging = true; lx = e.clientX; ly = e.clientY; cvs.setPointerCapture(e.pointerId); });
cvs.addEventListener('pointermove', e => { if (!dragging) return; walk.yaw -= (e.clientX - lx) * 0.004; walk.pitch = Math.max(-1.2, Math.min(1.2, walk.pitch - (e.clientY - ly) * 0.004)); lx = e.clientX; ly = e.clientY; });
cvs.addEventListener('pointerup', () => dragging = false);
cvs.addEventListener('wheel', e => { if (!isWalk()) return; e.preventDefault(); walk.imp = (walk.imp || 0) - Math.sign(e.deltaY) * 0.6; }, { passive: false });
addEventListener('keydown', e => { if (isWalk() && !window.__baristaActive && !window.__menuOpen) { walk.keys[e.key.toLowerCase()] = true; if (e.key.startsWith('Arrow')) e.preventDefault(); } });
addEventListener('keyup', e => { walk.keys[e.key.toLowerCase()] = false; });
document.querySelectorAll('#pad button').forEach(b => { const k = b.dataset.k;
  b.addEventListener('pointerdown', e => { e.preventDefault(); walk.keys['pad_' + k] = true; });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => b.addEventListener(ev, () => walk.keys['pad_' + k] = false)); });
const isWalk = () => state.view === 'walk' || state.view.startsWith('sp-');

function setView(v) {
  state.view = v;
  document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
  document.getElementById('walkfloor').hidden = v !== 'walk';
  document.getElementById('pad').classList.toggle('on', isWalk());
  state.explodeTarget = v === 'exp' ? 6 : 0;
  if (v === 'walk') { enterWalk(state.walkFloor); hint.textContent = 'Click the floor to jump there · drag to look · W A S D to move'; chip.textContent = state.walkFloor === 'GF' ? 'Walk · Ground' : 'Walk · Upper'; }
  else if (v.startsWith('sp-')) { enterWalk(v); hint.textContent = 'Click the floor to jump there · drag to look · W A S D to move'; chip.textContent = WALK_START[v].name; }
  else { controls.enabled = true; const p = PRESETS[v]; flyTo(p.pos, p.tgt); hint.textContent = p.hint; chip.textContent = p.chip; }
  refresh();
}
function refresh() {
  const v = state.view, walking = isWalk();
  floorGroups.UF.visible = !(v === 'gf' || (v === 'top' && state.topFloor === 'GF'));
  layers.roof.forEach(m => m.visible = (state.roof && v === 'ext') || walking);
  layers.ceiling.forEach(m => m.visible = walking);
  layers.fitout.forEach(m => m.visible = state.fit);
  layers.stair.forEach(m => m.visible = state.stair);
  layers.facade.forEach(m => m.visible = state.fac);
  layers.curtain.forEach(m => m.visible = state.cur);
  hemi.intensity = walking ? 0.55 : 0.35;
}
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => {
  if (b.dataset.view === 'top') state.topFloor = state.view === 'gf' ? 'GF' : (state.topFloor || 'UF');
  setView(b.dataset.view); }));
document.querySelectorAll('#walkfloor button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('#walkfloor button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); state.walkFloor = b.dataset.f; setView('walk'); }));
const bind = (id, key) => document.getElementById(id).addEventListener('change', e => { state[key] = e.target.checked; refresh(); });
bind('l-fit', 'fit'); bind('l-lbl', 'lbl'); bind('l-stair', 'stair'); bind('l-fac', 'fac'); bind('l-roof', 'roof'); bind('l-cur', 'cur'); bind('l-hq', 'hq');

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight; if (!w || !h) return;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  composer.setSize(w, h); composer.setPixelRatio(Math.min(devicePixelRatio, 2));
}
new ResizeObserver(resize).observe(stage);

// ------------------------------------------------------------------ loop
const tmp = new THREE.Vector3(); let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (tween) { const k = Math.min(1, (now - tween.t0) / tween.dur), e = k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    camera.position.lerpVectors(tween.from.p, tween.to.p, e); controls.target.lerpVectors(tween.from.t, tween.to.t, e); if (k >= 1) tween = null; }
  state.explode += (state.explodeTarget - state.explode) * Math.min(1, dt * 5); floorGroups.UF.position.y = state.explode;
  if (window.__hopTick) window.__hopTick(now);
  if (isWalk()) {
    const K = walk.keys, sp = (K['shift'] ? 3.0 : 1.4) * dt;
    const fwd = (K['w'] || K['arrowup'] || K['pad_f'] ? 1 : 0) - (K['s'] || K['arrowdown'] || K['pad_b'] ? 1 : 0), str = (K['d'] ? 1 : 0) - (K['a'] ? 1 : 0);
    walk.yaw += ((K['arrowleft'] || K['pad_l'] ? 1 : 0) - (K['arrowright'] || K['pad_r'] ? 1 : 0)) * dt * 1.5;
    const imp = walk.imp || 0; walk.imp = imp * 0.85; const f = fwd * sp + imp * dt * 4;
    walk.pos.x += -Math.sin(walk.yaw) * f + Math.cos(walk.yaw) * str * sp; walk.pos.z += -Math.cos(walk.yaw) * f - Math.sin(walk.yaw) * str * sp;
    walk.pos.x = Math.max(-3, Math.min(31, walk.pos.x)); walk.pos.z = Math.max(-25.4, Math.min(12, walk.pos.z));
    camera.position.copy(walk.pos);
    tmp.set(-Math.sin(walk.yaw) * Math.cos(walk.pitch), Math.sin(walk.pitch), -Math.cos(walk.yaw) * Math.cos(walk.pitch)).add(walk.pos); camera.lookAt(tmp);
    camera.fov = 60;
  } else { camera.fov = 40; controls.update(); }
  if (window.__kynanTick) window.__kynanTick(now);
  if (window.__baristaTick) window.__baristaTick(now, dt);
  if (window.__pbrTick) window.__pbrTick(now, dt);
  camera.updateProjectionMatrix();
  if (state.hq) composer.render(dt); else renderer.render(scene, camera);
  const w = stage.clientWidth, h = stage.clientHeight;
  for (const Lb of LBL) {
    let vis = state.lbl && (Lb.floor === 'GF' ? true : floorGroups.UF.visible);
    if (vis && Lb.floor === 'GF' && floorGroups.UF.visible && state.view !== 'exp' && !isWalk()) vis = false;
    if (vis && isWalk() && Lb.floor !== state.walkFloor) vis = false;
    if (vis && state.view === 'ext') vis = false;
    if (vis && state.view.startsWith('sp-')) vis = false;
    tmp.copy(Lb.p); if (Lb.floor === 'UF') tmp.y += floorGroups.UF.position.y; const dist = camera.position.distanceTo(tmp); tmp.project(camera);
    if (!vis || tmp.z > 1 || Math.abs(tmp.x) > 1.05 || Math.abs(tmp.y) > 1.05 || (isWalk() && dist > 10)) { Lb.el.style.display = 'none'; continue; }
    Lb.el.style.display = 'block'; Lb.el.style.left = ((tmp.x + 1) / 2 * w) + 'px'; Lb.el.style.top = ((1 - tmp.y) / 2 * h) + 'px';
  }
  if (!window.__paused) requestAnimationFrame(frame);
}
resize(); camera.position.set(...PRESETS.ext.pos); controls.target.set(...PRESETS.ext.tgt); refresh();
document.getElementById('loading').hidden = true;
requestAnimationFrame(frame);
// Deep links: index.html#sp-kitchen opens a space; an embedding page can postMessage({ aiimsView: 'sp-kitchen' }).
const openView = v => { const b = document.querySelector(`[data-view="${CSS.escape(v || '')}"]`); if (b) b.click(); };
addEventListener('hashchange', () => openView(decodeURIComponent(location.hash.slice(1))));
addEventListener('message', e => { if (e.data && typeof e.data.aiimsView === 'string') openView(e.data.aiimsView); });
if (location.hash) openView(decodeURIComponent(location.hash.slice(1)));
if (parent !== window) parent.postMessage({ aiimsReady: true }, '*');
window.__setView = setView;
window.__renderOnce = (n = 1) => { if (tween) { camera.position.copy(tween.to.p); controls.target.copy(tween.to.t); tween = null; } for (let k = 0; k < n; k++) { state.explode = state.explodeTarget; frame(performance.now()); } };
window.__pose = (x, y, z, yaw, pitch) => { walk.pos.set(x, z, -y); walk.yaw = yaw; walk.pitch = pitch; };


// ---- left-click anywhere to jump there (enters walk view at that spot)
{
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let hop = null;
  window.__jumpTo = (e) => {
    if (window.__baristaActive) return;
    const rc = renderer.domElement.getBoundingClientRect(); ndc.set(((e.clientX - rc.left) / rc.width) * 2 - 1, -((e.clientY - rc.top) / rc.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(scene.children, true).filter(h => h.object.visible && h.object !== sky && !(h.object.material && h.object.material.transparent) && isShown(h.object));
    if (!hits.length) return;
    const h = hits[0], n = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
    const p = h.point.clone();
    if (n.y < 0.6) p.addScaledVector(ray.ray.direction, -0.45);          // clicked a wall or object: stop just in front of it
    const upper = p.y > UFZ - 0.3 && floorGroups.UF.visible && state.explode < 0.5;
    const floorY = upper ? UFZ : 0;
    if (p.y > floorY + 2.2 && !(n.y > 0.6)) return;                        // ignore clicks high on walls/ceilings
    const target = new THREE.Vector3(p.x, floorY + 1.6, p.z);
    const fl = upper ? 'UF' : 'GF';
    const wasWalk = isWalk();
    if (!isWalk()) { const dir = new THREE.Vector3(); camera.getWorldDirection(dir); state.walkFloor = fl; setView('walk'); walk.yaw = Math.atan2(-dir.x, -dir.z); walk.pitch = -0.05; walk.pos.copy(camera.position); }
    else if (fl !== state.walkFloor) { state.walkFloor = fl; }
    if (wasWalk) { const d = new THREE.Vector3(target.x - walk.pos.x, 0, target.z - walk.pos.z), L = d.length(), MAX = 2.5;
      if (L > MAX) target.set(walk.pos.x + d.x / L * MAX, target.y, walk.pos.z + d.z / L * MAX); }
    hop = { from: walk.pos.clone(), to: target, t0: performance.now(), dur: matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 450 };
    chip.textContent = fl === 'GF' ? 'Walk · Ground' : 'Walk · Upper';
    const mk = document.getElementById('jumpmark'); mk.hidden = false; mk.style.left = (e.clientX - rc.left) + 'px'; mk.style.top = (e.clientY - rc.top) + 'px';
    mk.classList.remove('on'); void mk.offsetWidth; mk.classList.add('on'); setTimeout(() => mk.hidden = true, 600);
  };
  function isShown(o) { for (let q = o; q; q = q.parent) if (!q.visible) return false; return true; }
  window.__hopTick = (now) => { if (!hop) return; const k = Math.min(1, (now - hop.t0) / hop.dur), e2 = 1 - Math.pow(1 - k, 3);
    walk.pos.lerpVectors(hop.from, hop.to, e2); walk.pos.y += Math.sin(k * Math.PI) * 0.08; if (k >= 1) hop = null; };
}

// ================================================================== BARISTA MODE: click the espresso machine, pick latte art, make a coffee in first person
{
  const NB = 0.92, GY = 9.27, GX = 11.03;                    // right group head (plan x/y), bench height
  const V = (x, y, z) => P(x, y, z);
  const ss = t => t * t * (3 - 2 * t), cl = (a, b, t) => Math.max(a, Math.min(b, t));
  // keyframe helpers: keys = [[u, value], ...]; value is number or [x, y, z] (plan coords)
  const kf = (u, keys) => { if (u <= keys[0][0]) return keys[0][1]; for (let i = 1; i < keys.length; i++) { const [u1, v1] = keys[i], [u0, v0] = keys[i - 1];
      if (u <= u1) { const t = ss((u - u0) / Math.max(1e-6, u1 - u0)); return Array.isArray(v0) ? v0.map((a, j) => a + (v1[j] - a) * t) : v0 + (v1 - v0) * t; } } return keys[keys.length - 1][1]; };
  const kv = (u, keys) => { const a = kf(u, keys); return V(a[0], a[1], a[2]); };
  const chrome = std({ color: 0xdedede, roughness: 0.14, metalness: 1 }), black = std({ color: 0x141414, roughness: 0.5 });
  const persist = new THREE.Group(); persist.name = 'Coffee station props'; floorGroups.GF.add(persist);
  const live = new THREE.Group(); live.name = 'Barista live'; scene.add(live);
  const add = (parent, geo, mat, cast = true) => { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = true; parent.add(m); return m; };

  // ---- grinder on the bench beside the machine, tamping mat, tamper
  const grinder = new THREE.Group(); persist.add(grinder);
  { const body = std({ color: 0x202224, roughness: 0.35, metalness: 0.5 });
    const b = add(grinder, new RoundedBoxGeometry(0.2, 0.38, 0.24, 3, 0.02), body); b.position.copy(V(10.85, 7.73, NB + 0.19));
    const hop = add(grinder, new THREE.CylinderGeometry(0.085, 0.05, 0.18, 24, 1, true), M.glass); hop.position.copy(V(10.85, 7.73, NB + 0.47));
    const beans = add(grinder, new THREE.CylinderGeometry(0.07, 0.048, 0.1, 20), std({ color: 0x3b2314, roughness: 0.8 })); beans.position.copy(V(10.85, 7.73, NB + 0.43));
    const ch2 = add(grinder, new THREE.BoxGeometry(0.06, 0.04, 0.05), body); ch2.position.copy(V(10.98, 7.73, NB + 0.29));
    for (const dy of [-0.03, 0.03]) { const fk = add(grinder, new THREE.BoxGeometry(0.1, 0.01, 0.012), chrome); fk.position.copy(V(11.01, 7.73 + dy, NB + 0.185)); }
    const btn = add(grinder, new THREE.CylinderGeometry(0.012, 0.012, 0.01, 14), std({ color: 0xb8231c, roughness: 0.4 })); btn.rotation.z = Math.PI / 2; btn.position.copy(V(10.955, 7.65, NB + 0.32)); }
  const tamper = new THREE.Group(); persist.add(tamper);
  { add(tamper, new THREE.CylinderGeometry(0.029, 0.029, 0.018, 24), chrome).position.y = 0.009;
    add(tamper, new THREE.CylinderGeometry(0.01, 0.014, 0.05, 12), chrome).position.y = 0.043;
    add(tamper, new THREE.CylinderGeometry(0.022, 0.018, 0.05, 18), std({ color: 0x5b3a22, roughness: 0.5 })).position.y = 0.09;
    add(tamper, new THREE.SphereGeometry(0.022, 16, 10), std({ color: 0x5b3a22, roughness: 0.5 })).position.y = 0.115; }
  const TAMP_REST = [11.2, 9.9, NB + 0.012];

  // ---- portafilter (origin = basket centre, handle along local +x)
  const pf = new THREE.Group(); persist.add(pf);
  { add(pf, new THREE.CylinderGeometry(0.038, 0.034, 0.03, 28), chrome);
    const inner = add(pf, new THREE.CylinderGeometry(0.033, 0.033, 0.002, 24), std({ color: 0x8c8c8c, roughness: 0.4, metalness: 0.8 }), false); inner.position.y = 0.0;
    for (const a of [Math.PI / 2, -Math.PI / 2]) { const e = add(pf, new THREE.BoxGeometry(0.02, 0.008, 0.012), chrome); e.position.set(0, 0.012, Math.sin(a) * 0.042); }
    const neck = add(pf, new THREE.CylinderGeometry(0.009, 0.011, 0.04, 10), chrome); neck.rotation.z = Math.PI / 2; neck.position.set(0.055, -0.004, 0);
    const hd = add(pf, new THREE.CylinderGeometry(0.013, 0.011, 0.12, 14), black); hd.rotation.z = Math.PI / 2; hd.position.set(0.135, -0.008, 0);
    for (const dz of [-0.008, 0.008]) { const sp = add(pf, new THREE.CylinderGeometry(0.004, 0.006, 0.02, 8), chrome); sp.position.set(0, -0.025, dz); } }
  const grounds = add(pf, new THREE.CylinderGeometry(0.033, 0.033, 0.016, 24), std({ color: 0x4a2c18, roughness: 0.95 }), false); grounds.position.y = 0.006; grounds.scale.y = 0.01;
  const mound = add(pf, new THREE.SphereGeometry(0.033, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), grounds.material, false); mound.position.y = 0.014; mound.scale.set(1, 0.01, 1);
  const GL = 8.88, PF_LOCK = [GX, GL, 1.2], PF_FORK = [11.02, 7.73, NB + 0.17], PF_TAMP = [11.42, 8.55, NB + 0.24];

  // ---- cup (origin = base) with liquid surface that carries the crema / latte art
  const cup = new THREE.Group(); persist.add(cup);
  const ceramic = std({ color: 0xf6f4f0, roughness: 0.2 });
  { const prof = [[0.0, 0.0], [0.03, 0.0], [0.033, 0.004], [0.044, 0.07], [0.047, 0.074], [0.042, 0.074], [0.04, 0.068], [0.029, 0.008], [0.0, 0.008]].map(([r, y]) => new THREE.Vector2(r, y));
    add(cup, new THREE.LatheGeometry(prof, 40), ceramic);
    const h = add(cup, new THREE.TorusGeometry(0.018, 0.005, 8, 20, Math.PI * 1.3), ceramic); h.position.set(0.05, 0.038, 0); h.rotation.z = -Math.PI * 0.65; }
  const artCv = cv(256, 256), artCtx = artCv.getContext('2d'), artTex = new THREE.CanvasTexture(artCv); artTex.colorSpace = THREE.SRGBColorSpace;
  const liquid = add(cup, new THREE.CircleGeometry(1, 48), std({ map: artTex, roughness: 0.25, envMapIntensity: 0.6 }), false); liquid.rotation.set(-Math.PI / 2, 0, Math.PI / 2 + 0.6); liquid.visible = false;
  const setLevel = (h) => { liquid.visible = h > 0.0005; const r = 0.029 + (0.041 - 0.029) * cl(0, 1, (h) / 0.062); liquid.scale.set(r, r, 1); liquid.position.y = 0.008 + h; };
  const CUP_TRAY = [GX, GL, NB + 0.065], CUP_REST = CUP_TRAY;

  // ---- milk pitcher (origin = base, spout toward local +z, handle toward local -z)
  const pitcher = new THREE.Group(); persist.add(pitcher);
  { const prof = [[0.0, 0.0], [0.04, 0.0], [0.043, 0.06], [0.04, 0.1], [0.044, 0.12], [0.041, 0.12], [0.037, 0.1], [0.04, 0.06], [0.037, 0.004], [0, 0.004]].map(([r, y]) => new THREE.Vector2(r, y));
    add(pitcher, new THREE.LatheGeometry(prof, 36), chrome);
    const sp = add(pitcher, new THREE.ConeGeometry(0.014, 0.03, 10, 1, true), chrome); sp.rotation.x = Math.PI / 2; sp.position.set(0, 0.116, 0.05);
    const hd = add(pitcher, new THREE.TorusGeometry(0.03, 0.006, 8, 18, Math.PI), chrome); hd.rotation.y = Math.PI / 2; hd.rotation.z = -Math.PI / 2; hd.position.set(0, 0.07, -0.044); }
  const milk = add(pitcher, new THREE.CircleGeometry(1, 32), std({ color: 0xf2efe6, roughness: 0.6 }), false); milk.rotation.x = -Math.PI / 2; milk.visible = false;
  const setMilk = (h, froth) => { milk.visible = h > 0.001; const r = 0.038; milk.scale.set(r, r, 1); milk.position.y = 0.004 + h; milk.material.color.setRGB(0.93 + froth * 0.05, 0.91 + froth * 0.06, 0.86 + froth * 0.1); milk.material.roughness = 0.6 - froth * 0.35; };
  const PIT_REST = [11.06, 9.78, NB + 0.004];

  // ---- live-only bits: hands, carton, streams, particles
  const skin = std({ color: 0xc48d6c, roughness: 0.55 }), knit = std({ color: 0x232426, normalMap: T.weaveN, roughness: 0.95 });
  const makeHand = (left) => { const g = new THREE.Group(); const s = left ? -1 : 1;
    add(g, new RoundedBoxGeometry(0.075, 0.026, 0.085, 3, 0.012), skin, false);
    [0.05, 0.056, 0.053, 0.044].forEach((L, i) => { const f2 = add(g, new THREE.CapsuleGeometry(0.0085, L, 4, 8), skin, false); f2.rotation.x = Math.PI / 2 + 0.55; f2.position.set(s * (-0.027 + i * 0.018), -0.012, 0.058 + L * 0.3); });
    const th = add(g, new THREE.CapsuleGeometry(0.01, 0.038, 4, 8), skin, false); th.rotation.set(Math.PI / 2, 0, s * 0.8); th.position.set(s * -0.046, -0.006, 0.022);
    const sl = add(g, new THREE.CylinderGeometry(0.042, 0.05, 0.5, 20, 1, true), knit, false); sl.rotation.x = Math.PI / 2; sl.position.set(0, 0.004, -0.3); sl.material.side = THREE.DoubleSide;
    const cf = add(g, new THREE.CylinderGeometry(0.043, 0.043, 0.04, 20), knit, false); cf.rotation.x = Math.PI / 2; cf.position.set(0, 0.004, -0.06);
    const wr = add(g, new THREE.CylinderGeometry(0.03, 0.032, 0.05, 16), skin, false); wr.rotation.x = Math.PI / 2; wr.position.set(0, 0.002, -0.04);
    g.visible = false; live.add(g); return { g, pos: new THREE.Vector3(), on: false }; };
  const hands = { L: makeHand(true), R: makeHand(false) };
  const carton = new THREE.Group(); live.add(carton); carton.visible = false;
  { const c = cv(128, 256), x = c.getContext('2d'); x.fillStyle = '#f7f7f4'; x.fillRect(0, 0, 128, 256); x.fillStyle = '#1f5fbf'; x.fillRect(0, 90, 128, 80); x.fillStyle = '#fff'; x.font = '800 30px Archivo, Arial'; x.textAlign = 'center'; x.fillText('MILK', 64, 142);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; const m = std({ map: t, roughness: 0.6 });
    const b = add(carton, new THREE.BoxGeometry(0.07, 0.2, 0.07), m, false); b.position.y = 0.1;
    const top = add(carton, new THREE.ConeGeometry(0.05, 0.04, 4), std({ color: 0xf7f7f4, roughness: 0.6 }), false); top.rotation.y = Math.PI / 4; top.position.y = 0.22;
    const cap = add(carton, new THREE.CylinderGeometry(0.012, 0.012, 0.012, 12), std({ color: 0x1f5fbf, roughness: 0.4 }), false); cap.position.set(0, 0.215, 0.02); }
  const stream = (color, opacity = 1) => { const m = add(live, new THREE.CylinderGeometry(1, 1, 1, 10, 1, true), new THREE.MeshStandardMaterial({ color, roughness: 0.3, transparent: opacity < 1, opacity }), false); m.visible = false; return m; };
  const espStream = stream(0x4a2511), milkStream = stream(0xf3f0e8), cartonStream = stream(0xf6f4ee);
  const setStream = (m, a, b, r) => { if (!a) { m.visible = false; return; } m.visible = true; const d = b.clone().sub(a), L = d.length(); m.position.copy(a).addScaledVector(d, 0.5); m.scale.set(r, L, r);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); };
  const particles = (n, color, size, opacity) => { const g = new THREE.BufferGeometry(), arr = new Float32Array(n * 3); g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const p = new THREE.Points(g, new THREE.PointsMaterial({ color, size, transparent: true, opacity, depthWrite: false, sizeAttenuation: true })); p.visible = false; p.userData.seed = Array.from({ length: n }, () => [Math.random(), Math.random(), Math.random()]); live.add(p); return p; };
  const groundsFx = particles(120, 0x3a2312, 0.006, 1), steamFx = particles(160, 0xffffff, 0.03, 0.35);

  // ---- latte art drawing (crema base + milk art revealed by progress)
  let artKind = 'swan';
  function drawArt(mix, prog) {
    const x = artCtx, c = 128;
    // golden crema with a darker rim and fine speckle
    const gr = x.createRadialGradient(c, c, 8, c, c, 128); gr.addColorStop(0, '#c8955c'); gr.addColorStop(0.7, '#b07a43'); gr.addColorStop(0.92, '#8a5428'); gr.addColorStop(1, '#5e3416');
    x.fillStyle = gr; x.fillRect(0, 0, 256, 256);
    if (!drawArt.sp) { drawArt.sp = []; for (let k = 0; k < 900; k++) drawArt.sp.push([Math.random() * 256, Math.random() * 256, Math.random()]); }
    for (const [px, py, v] of drawArt.sp) { x.fillStyle = v > 0.5 ? 'rgba(90,50,20,.18)' : 'rgba(235,200,150,.15)'; x.fillRect(px, py, 1.5, 1.5); }
    if (mix > 0) { x.fillStyle = `rgba(200,150,95,${mix * 0.3})`; x.beginPath(); x.arc(c, c, 118, 0, 7); x.fill(); }
    if (prog <= 0) { artTex.needsUpdate = true; return; }
    x.save(); x.beginPath(); x.arc(c, 205, 30 + prog * 230, 0, 7); x.clip();
    const milk = '#fbf5ea', crema = 'rgba(176,122,67,.95)';
    x.fillStyle = milk; x.strokeStyle = milk; x.lineCap = 'round'; x.lineJoin = 'round';
    if (artKind === 'heart') {
      // layered rosetta heart: wide heart, nested wavy layers rising to the top, small heart above, stem pulled through
      const heart = (cx, cy, sc) => { x.beginPath(); for (let k = 0; k <= 64; k++) { const t = k / 64 * Math.PI * 2, hx = 16 * Math.pow(Math.sin(t), 3), hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
          const px = cx + hx * sc, py = cy - hy * sc; k ? x.lineTo(px, py) : x.moveTo(px, py); } x.closePath(); };
      x.fillStyle = milk; heart(c + 6, 150, 5.3); x.fill();
      x.strokeStyle = crema; x.lineWidth = 3;
      for (let k = 1; k <= 6; k++) { const sc = 5.3 * (1 - k * 0.13); heart(c + 6, 150 - k * 7.5, sc); x.stroke(); }
      x.fillStyle = milk; heart(c - 22, 70, 1.25); x.fill(); x.strokeStyle = crema; x.lineWidth = 2; heart(c - 22, 70, 1.25); x.stroke();
      x.strokeStyle = crema; x.lineWidth = 3.5; x.beginPath(); x.moveTo(c - 18, 82); x.quadraticCurveTo(c + 2, 150, c + 18, 206); x.stroke();
    } else {
      // swan: rippled bowl at the base, feathered wing rising on the right, neck curving up on the left to a small head
      x.beginPath(); x.ellipse(c, 140, 84, 76, 0, 0.12, Math.PI - 0.12); x.ellipse(c, 140, 70, 26, 0, Math.PI - 0.2, 0.2, true); x.closePath(); x.fill();
      x.strokeStyle = crema; x.lineWidth = 2.4;
      for (let k = 1; k <= 6; k++) { const t = k / 7; x.beginPath(); x.ellipse(c, 140, 84 - (84 - 70) * t, 76 - (76 - 26) * t, 0, 0.18, Math.PI - 0.18); x.stroke(); }
      // wing
      x.fillStyle = milk; x.beginPath(); x.moveTo(c - 18, 160); x.bezierCurveTo(c - 10, 110, c + 4, 70, c + 22, 48); x.bezierCurveTo(c + 46, 70, c + 66, 120, c + 64, 160); x.closePath(); x.fill();
      x.lineWidth = 2.4; for (let k = 0; k < 9; k++) { const y = 70 + k * 11; x.beginPath(); x.moveTo(c + 2 + k * 0.6, y); x.quadraticCurveTo(c + 30, y + 3, c + 58 - Math.max(0, 6 - k) * 3, y + 14); x.stroke(); }
      // neck and heart-shaped head
      x.strokeStyle = milk; x.lineCap = 'round';
      x.lineWidth = 16; x.beginPath(); x.moveTo(c - 2, 172); x.bezierCurveTo(c - 50, 160, c - 46, 100, c - 32, 66); x.stroke();
      x.lineWidth = 10; x.beginPath(); x.moveTo(c - 32, 70); x.quadraticCurveTo(c - 30, 52, c - 20, 48); x.stroke();
      x.fillStyle = milk; x.beginPath(); x.ellipse(c - 18, 48, 9, 7, 0.3, 0, 7); x.fill();
      x.lineWidth = 3.5; x.beginPath(); x.moveTo(c - 13, 54); x.lineTo(c - 12, 70); x.stroke();
    }
    x.restore(); artTex.needsUpdate = true;
  }

  window.__artDbg = (k, m, p) => { artKind = k; drawArt(m, p); return artCv.toDataURL(); }; window.__artCv = artCv;
  // ---- poses
  const place = (o, a) => o.position.copy(V(a[0], a[1], a[2]));
  function resetProps() { place(pf, PF_LOCK); pf.rotation.set(0, 0, 0); grounds.scale.y = 0.01; mound.scale.set(1, 0.01, 1); grounds.material.color.set(0x4a2c18);
    place(tamper, TAMP_REST); tamper.rotation.set(0, 0, 0); place(cup, CUP_REST); cup.rotation.set(0, 0, 0); setLevel(0); drawArt(0, 0);
    place(pitcher, PIT_REST); pitcher.rotation.set(0, 0, 0); setMilk(0, 0); grinder.position.set(0, 0, 0); }
  resetProps();

  // ---- step timeline
  const W = (o, lx, ly, lz) => o.localToWorld(new THREE.Vector3(lx, ly, lz));
  const STEPS = [
    { t: 'Grind and tamp', d: 'Left hand: unlock the portafilter, dose it under the grinder and hold it steady. Right hand: pick up the tamper, press straight down and twist.', dur: 14,
      at: [12.15, 8.6, 1.62], look: [11.15, 8.3, NB + 0.2],
      run(u) {
        place(pf, kf(u, [[0, PF_LOCK], [0.06, PF_LOCK], [0.14, [11.08, 8.92, 1.1]], [0.26, PF_FORK], [0.5, PF_FORK], [0.6, PF_TAMP]]));
        pf.rotation.set(0, kf(u, [[0, 0], [0.06, -0.7], [0.16, -0.4], [0.26, 0], [0.5, 0], [0.6, -0.5]]), 0);
        grip('L', W(pf, 0.15, 0, 0), 0);
        const g = cl(0, 1, (u - 0.28) / 0.2); grounds.scale.y = Math.max(0.01, g); mound.scale.set(1, Math.max(0.01, ss(g) * 0.55), 1);
        fx(groundsFx, u > 0.28 && u < 0.48, (sd, i, a2) => { const k = (sd[0] + performance.now() / 600) % 1; a2[i] = 11.015 + (sd[1] - 0.5) * 0.02; a2[i + 1] = NB + 0.27 - k * 0.08; a2[i + 2] = -7.73 + (sd[2] - 0.5) * 0.02; });
        grinder.position.set(u > 0.28 && u < 0.48 ? (Math.random() - 0.5) * 0.0015 : 0, 0, 0);
        const T = PF_TAMP;
        place(tamper, kf(u, [[0.5, TAMP_REST], [0.6, [11.3, 9.4, NB + 0.35]], [0.66, [T[0], T[1], T[2] + 0.12]], [0.72, [T[0], T[1], T[2] + 0.012]], [0.84, [T[0], T[1], T[2] + 0.012]], [0.9, [T[0], T[1], T[2] + 0.13]], [1, TAMP_REST]]));
        tamper.rotation.y = kf(u, [[0.74, 0], [0.84, 1.3]]);
        grip('R', u > 0.48 && u < 0.98 ? W(tamper, 0, 0.11, 0) : null, 0, true);
        if (u > 0.7) { const k = ss(cl(0, 1, (u - 0.7) / 0.05)); mound.scale.y = 0.55 * (1 - k) + 0.01; grounds.scale.y = 1 - 0.25 * k; grounds.material.color.lerpColors(new THREE.Color(0x4a2c18), new THREE.Color(0x2e1a0d), k); } } },
    { t: 'Brew and steam', d: 'Left hand: lock the portafilter into the machine and start the shot. Right hand: hold the milk pitcher under the steam wand and froth until silky.', dur: 14, timer: true,
      at: [12.2, 9.15, 1.62], look: [11.1, 9.15, NB + 0.22],
      run(u) {
        place(pf, kf(u, [[0, PF_TAMP], [0.16, [11.08, 8.92, 1.1]], [0.26, PF_LOCK]])); pf.rotation.set(0, kf(u, [[0, -0.5], [0.16, -0.7], [0.26, -0.7], [0.34, 0]]), 0);
        if (u < 0.34) grip('L', W(pf, 0.15, 0, 0), 0); else if (u < 0.46) grip('L', V(11.19, 8.8, NB + 0.46), -1.5); else grip('L', null);
        const on = u > 0.44 && u < 0.95, lvl = 0.024 * ss(cl(0, 1, (u - 0.46) / 0.48)); setLevel(lvl); drawArt(0, 0);
        setStream(espStream, on ? W(pf, 0, -0.035, 0) : null, W(cup, 0, 0.008 + lvl, 0), u > 0.9 ? 0.0012 : 0.0022);
        this.secs = Math.min(28, Math.max(0, (u - 0.44) / 0.5 * 28));
        const WAND = [11.12, 9.49, NB + 0.1];
        place(pitcher, kf(u, [[0, PIT_REST], [0.1, [11.3, 9.65, NB + 0.2]], [0.2, WAND], [0.9, WAND], [1, [11.3, 9.45, NB + 0.12]]]));
        const steam = u > 0.22 && u < 0.88; pitcher.rotation.set(steam ? Math.sin(u * 90) * 0.02 : 0, 0, steam ? 0.1 : 0);
        grip('R', W(pitcher, 0, 0.07, -0.05), Math.PI / 2);
        setMilk(0.05 + 0.025 * ss(cl(0, 1, (u - 0.22) / 0.66)), ss(cl(0, 1, (u - 0.22) / 0.66)));
        const rim = W(pitcher, 0, 0.12, 0);
        fx(steamFx, steam, (sd, i, a2) => { const k = (sd[0] + performance.now() / 1400) % 1; a2[i] = rim.x + (sd[1] - 0.5) * 0.08 * (1 + k); a2[i + 1] = rim.y + k * 0.35; a2[i + 2] = rim.z + (sd[2] - 0.5) * 0.08 * (1 + k); }); } },
    { t: 'Pour the latte art', d: '', dur: 13,
      at: [12.05, 9.0, 1.62], look: [11.48, 9.0, NB + 0.33],
      run(u) { const CUPH = [11.48, 8.94, NB + 0.34], PITH = [11.48, 9.1, NB + 0.48];
        place(cup, kf(u, [[0, CUP_TRAY], [0.1, [11.3, 8.86, NB + 0.15]], [0.2, CUPH], [0.86, CUPH], [1, [11.72, 8.96, NB + 0.48]]]));
        cup.rotation.set(kf(u, [[0.2, 0], [0.26, -0.38], [0.6, -0.3], [0.82, 0]]), -0.6, 0);
        grip('L', W(cup, 0.055, 0.04, 0), Math.PI / 2);
        place(pitcher, kf(u, [[0, [11.3, 9.45, NB + 0.12]], [0.2, PITH], [0.5, PITH], [0.62, [11.48, 9.04, NB + 0.4]], [0.82, [11.48, 9.04, NB + 0.4]], [0.92, [11.3, 9.6, NB + 0.12]]]));
        pitcher.rotation.set(kf(u, [[0.2, 0], [0.28, 1.05], [0.55, 1.15], [0.62, 1.35], [0.8, 1.45], [0.9, 0]]), 0, 0);
        grip('R', u < 0.94 ? W(pitcher, 0, 0.07, -0.05) : null, Math.PI / 2);
        const lvl = 0.024 + 0.04 * ss(cl(0, 1, (u - 0.28) / 0.52)); setLevel(lvl); setMilk(Math.max(0.01, 0.075 * (1 - ss(cl(0, 1, (u - 0.28) / 0.54)))), 1);
        drawArt(ss(cl(0, 1, (u - 0.28) / 0.25)), cl(0, 1, (u - 0.52) / 0.3));
        setStream(milkStream, u > 0.28 && u < 0.82 ? W(pitcher, 0, 0.118, 0.06) : null, W(cup, 0, 0.008 + lvl, 0), u > 0.55 ? 0.0035 : 0.0028);
        this.cam = u > 0.86 ? ss((u - 0.86) / 0.14) : 0; } },
  ];
  function fx(p, on, fn) { p.visible = on; if (!on) return; const a = p.geometry.attributes.position.array; p.userData.seed.forEach((s, j) => fn(s, j * 3, a)); p.geometry.attributes.position.needsUpdate = true; }
  const want = { L: null, R: null };
  function grip(side, pt, roll = 0, top = false) { want[side] = pt ? { pt, roll, top } : null; }

  // ---- overlay + choice menu
  const ov = document.getElementById('vr'), cm = document.getElementById('cmenu');
  const el = id => document.getElementById(id);
  let active = false, stepI = 0, t0 = 0, prevLbl = true, done = false;
  const CAM = V(12.2, 9.25, 1.63), camPos = new THREE.Vector3(), look = new THREE.Vector3(), lookT = new THREE.Vector3();
  function start(kind) {
    artKind = kind; cm.hidden = true; resetProps(); active = true; window.__baristaActive = true; done = false; stepI = 0; t0 = performance.now();
    if (!isWalk()) { state.walkFloor = 'GF'; setView('walk'); } prevLbl = state.lbl; state.lbl = false;
    hint.hidden = true; document.getElementById('pad').classList.remove('on'); chip.textContent = 'Barista · ' + (kind === 'swan' ? 'Swan' : 'Love heart');
    ov.hidden = false; el('vr-end').hidden = true; el('vr-card').hidden = false; look.copy(V(...STEPS[0].look)); camPos.copy(V(...STEPS[0].at)); walk.pos.copy(CAM);
    hands.L.pos.copy(CAM).add(new THREE.Vector3(0, -0.6, 0)); hands.R.pos.copy(hands.L.pos);
  }
  function stop() { active = false; window.__baristaActive = false; ov.hidden = true; hint.hidden = false; state.lbl = prevLbl; live.children.forEach(o => o.visible = false); resetProps();
    walk.pos.copy(CAM); walk.yaw = Math.PI / 2; walk.pitch = -0.25; setView('walk'); }
  window.__startBarista = start;
  el('vr-exit').addEventListener('click', stop); el('vr-done').addEventListener('click', stop); el('vr-again').addEventListener('click', () => { stop(); openMenu(); });
  addEventListener('keydown', e => { if (e.key === 'Escape') { if (active) stop(); cm.hidden = true; } if (!cm.hidden && (e.key === '1' || e.key === '2')) start(e.key === '1' ? 'swan' : 'heart'); });
  cm.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.art) start(b.dataset.art); else cm.hidden = true; });
  function openMenu(e) { cm.hidden = false; const rc = stage.getBoundingClientRect();
    if (e) { cm.style.left = Math.max(12, Math.min(e.clientX - rc.left + 12, rc.width - cm.offsetWidth - 12)) + 'px'; cm.style.top = Math.max(12, Math.min(e.clientY - rc.top + 12, rc.height - cm.offsetHeight - 12)) + 'px'; }
    else { cm.style.left = (rc.width - cm.offsetWidth) / 2 + 'px'; cm.style.top = (rc.height - cm.offsetHeight) / 2 + 'px'; } cm.querySelector('button').focus(); }
  // picking: machine body, grinder or cups
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const pickMeshes = () => { const a = (window.__coffeeMeshes || []).slice(); persist.traverse(o => { if (o.isMesh) a.push(o); }); return a; };
  window.__pickOther = (e) => { if (active) return true;
    const rc = renderer.domElement.getBoundingClientRect(); ndc.set(((e.clientX - rc.left) / rc.width) * 2 - 1, -((e.clientY - rc.top) / rc.height) * 2 + 1); ray.setFromCamera(ndc, camera);
    const all = ray.intersectObjects(scene.children, true).filter(h => h.object.visible && !(h.object.material && h.object.material.transparent));
    const hit = all.length && pickMeshes().includes(all[0].object);
    if (hit) { openMenu(e); return true; } if (!cm.hidden) { cm.hidden = true; return true; } return false; };
  window.__hoverCoffee = (e) => { if (active) return false; const rc = renderer.domElement.getBoundingClientRect(); ndc.set(((e.clientX - rc.left) / rc.width) * 2 - 1, -((e.clientY - rc.top) / rc.height) * 2 + 1); ray.setFromCamera(ndc, camera);
    const all = ray.intersectObjects(scene.children, true).filter(h => h.object.visible && !(h.object.material && h.object.material.transparent)); return all.length > 0 && pickMeshes().includes(all[0].object); };

  // ---- per-frame
  const tmpQ = new THREE.Vector3();
  window.__baristaTick = (now, dt) => {
    if (!active) return;
    let t = (now - t0) / 1000, i = 0; while (i < STEPS.length - 1 && t > STEPS[i].dur) { t -= STEPS[i].dur; i++; }
    const S = STEPS[i], u = cl(0, 1, t / S.dur); want.L = want.R = null;
    if (i !== stepI) stepI = i;
    S.run(u);
    // HUD
    el('vr-step').textContent = `Step ${i + 1} of ${STEPS.length}`; el('vr-title').textContent = S.t;
    el('vr-desc').textContent = S.d || `Left hand: lift the cup and tilt it. Right hand: pour from height to blend, then drop the pitcher close and draw your ${artKind === 'swan' ? 'swan' : 'love heart'}.`;
    el('vr-bar').style.width = ((STEPS.slice(0, i).reduce((a, s) => a + s.dur, 0) + t) / STEPS.reduce((a, s) => a + s.dur, 0) * 100).toFixed(1) + '%';
    el('vr-timer').hidden = !S.timer; if (S.timer) el('vr-timer').textContent = (S.secs || 0).toFixed(0).padStart(2, '0') + ' s';
    const fin = i === STEPS.length - 1 && u >= 1; if (fin && !done) { done = true; el('vr-card').hidden = true; el('vr-end').hidden = false; el('vr-endtitle').textContent = `Your ${artKind === 'swan' ? 'swan' : 'love heart'} latte is ready`; }
    // camera: first person, gentle head sway, eases between look targets
    lookT.copy(V(...S.look)); if (S.cam) lookT.lerp(cup.getWorldPosition(new THREE.Vector3()), S.cam);
    look.lerp(lookT, 1 - Math.exp(-dt * 3));
    const sway = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1;
    camPos.lerp(V(...S.at), 1 - Math.exp(-dt * 2.5));
    camera.position.copy(camPos).add(new THREE.Vector3(Math.sin(now / 1900) * 0.006 * sway, Math.sin(now / 1300) * 0.005 * sway, 0));
    if (S.cam) camera.position.lerp(V(11.95, 8.96, 1.58), S.cam);
    camera.lookAt(look); camera.fov = 62; walk.pos.copy(CAM);
    if (window.__camDbg) { const c = cup.getWorldPosition(new THREE.Vector3()); camera.position.set(c.x, c.y + 0.25, c.z + 0.001); camera.lookAt(c); }
    // hands follow grips; sleeves trail back toward the viewer
    for (const k of ['L', 'R']) { const h = hands[k], w = want[k];
      if (!w) { h.on = false; tmpQ.copy(camera.position).add(new THREE.Vector3(0, -0.55, k === 'L' ? 0.25 : -0.25)); h.pos.lerp(tmpQ, 1 - Math.exp(-dt * 6)); h.g.visible = h.pos.y > camera.position.y - 0.5; }
      else { const right = new THREE.Vector3().crossVectors(camera.getWorldDirection(new THREE.Vector3()), camera.up).normalize();
        const shoulder = camera.position.clone().addScaledVector(camera.up, -0.42).addScaledVector(right, k === 'L' ? -0.24 : 0.24);
        const back = shoulder.sub(w.pt).normalize(); const target = w.pt.clone().addScaledVector(back, w.top ? 0.02 : 0.055);
        if (w.top) target.y += 0.03; h.pos.lerp(target, 1 - Math.exp(-dt * (h.on ? 18 : 9))); h.on = true; h.g.visible = true; }
      h.g.position.copy(h.pos); const aim = w ? w.pt : h.pos.clone().add(camera.getWorldDirection(new THREE.Vector3())); h.g.lookAt(aim); if (w) h.g.rotateZ((k === 'L' ? -1 : 1) * w.roll); }
  };
}

// GLB export hook (used offline to produce the downloadable model)
window.__exportGLB = () => new Promise((res, rej) => {
  Object.entries(M).forEach(([k, m]) => { if (m && m.isMaterial && !m.name) m.name = k; });
  if (window.__dribble) { window.__dribble.ball.position.y = window.__dribble.top; window.__dribble.ball.scale.set(1, 1, 1); }
  const prev = { v: state.view }; sky.visible = false; ground.visible = false; road.visible = false;
  floorGroups.UF.visible = true; floorGroups.UF.position.y = 0;
  new GLTFExporter().parse([floorGroups.GF, floorGroups.UF, site], (buf) => {
    sky.visible = ground.visible = road.visible = true; refresh();
    const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode.apply(null, b.subarray(i, i + 32768)); res(btoa(s)); },
    rej, { binary: true, onlyVisible: true, maxTextureSize: window.__glbTex || 512 });
});

// ================================================================== PHOTOREAL RENDERING UPGRADE (materials, HDR lighting, post) - geometry and navigation untouched
{
  const MAXA = renderer.capabilities.getMaxAnisotropy();
  // ---------- periodic value noise (tileable) ----------
  const hash = (ix, iy, s) => { let h = (ix * 374761393 + iy * 668265263 + s * 1442695041) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967295; };
  const vnoise = (x, y, px, py, s) => { const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy; const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const x0 = ((ix % px) + px) % px, x1 = (x0 + 1) % px, y0 = ((iy % py) + py) % py, y1 = (y0 + 1) % py;
    const a = hash(x0, y0, s), b = hash(x1, y0, s), c = hash(x0, y1, s), d = hash(x1, y1, s); return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy; };
  const fbmP = (u, v, fx, fy, oct, s, g = 0.5) => { let sum = 0, amp = 1, tot = 0; for (let o = 0; o < oct; o++) { const m = 1 << o; sum += amp * vnoise(u * fx * m, v * fy * m, fx * m, fy * m, s + o * 17); tot += amp; amp *= g; } return sum / tot; };
  const ss = (a, b, t) => { t = Math.max(0, Math.min(1, (t - a) / (b - a))); return t * t * (3 - 2 * t); };
  // ---------- buffers -> canvases ----------
  const toCanvas = (W, H, fn) => { const c = cv(W, H), x = c.getContext('2d'), im = x.createImageData(W, H), d = im.data;
    for (let y = 0; y < H; y++) for (let i = 0; i < W; i++) { const k = (y * W + i) * 4, p = fn(i, y, y * W + i); d[k] = p[0]; d[k + 1] = p[1]; d[k + 2] = p[2]; d[k + 3] = 255; } x.putImageData(im, 0, 0); return c; };
  const normalCanvas = (h, W, H, str) => toCanvas(W, H, (x, y) => { const s = (xx, yy) => h[((yy + H) % H) * W + ((xx + W) % W)];
    const dx = (s(x + 1, y) - s(x - 1, y)) * str, dy = (s(x, y + 1) - s(x, y - 1)) * str, l = Math.hypot(dx, dy, 1); return [(-dx / l * 0.5 + 0.5) * 255, (dy / l * 0.5 + 0.5) * 255, (1 / l * 0.5 + 0.5) * 255]; });
  const greyCanvas = (r, W, H) => toCanvas(W, H, (x, y, i) => { const v = Math.max(0, Math.min(255, r[i] * 255)); return [v, v, v]; });
  const swapImage = (t, c) => { if (!t) return; t.image = c; t.anisotropy = MAXA; t.needsUpdate = true; };
  const companion = (t, c) => { const n = new THREE.CanvasTexture(c); n.wrapS = n.wrapT = THREE.RepeatWrapping; n.repeat.copy(t.repeat); n.offset.copy(t.offset); n.anisotropy = MAXA; n.colorSpace = THREE.NoColorSpace; return n; };
  const lin = (a, b, t) => a + (b - a) * t;

  // ---------- wood: domain-warped growth rings, medullary flecks, pores ----------
  function wood(W, H, o) {   // grain runs along +v (texture y) unless o.alongU
    const col = new Uint8ClampedArray(W * H * 3), hgt = new Float32Array(W * H), rgh = new Float32Array(W * H), s = o.seed || 3;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; let a = x / W, b = y / H; if (o.alongU) { const t = a; a = b; b = t; }
      const warp = fbmP(a, b, 3, 1, 4, s) - 0.5, tone = fbmP(a, b, 6, 2, 3, s + 5), streak = fbmP(a, b, 48, 2, 2, s + 9);
      const ring = a * o.rings + warp * o.warp + fbmP(a, b, 12, 1, 2, s + 3) * 0.6; const t = ring - Math.floor(ring);
      const late = ss(0.55, 0.92, t) * (1 - ss(0.92, 1.0, t));
      const pore = ss(0.66, 0.86, fbmP(a, b, 220, 5, 2, s + 11)), fleck = ss(0.82, 0.95, fbmP(a, b, 40, 6, 2, s + 13));
      const k = Math.max(0, Math.min(1, late * o.contrast + (tone - 0.5) * 0.55 + (streak - 0.5) * 0.25));
      const dim = 1 - pore * 0.22 + fleck * 0.06;
      col[i * 3] = lin(o.c1[0], o.c2[0], k) * dim; col[i * 3 + 1] = lin(o.c1[1], o.c2[1], k) * dim; col[i * 3 + 2] = lin(o.c1[2], o.c2[2], k) * dim;
      hgt[i] = late * 0.35 - pore * 0.9 + streak * 0.15; rgh[i] = o.r0 + pore * 0.18 - late * 0.06 + (tone - 0.5) * 0.08; }
    return { c: toCanvas(W, H, (x, y, i) => [col[i * 3], col[i * 3 + 1], col[i * 3 + 2]]), n: normalCanvas(hgt, W, H, o.bump || 1.2), r: greyCanvas(rgh, W, H) };
  }
  // ---------- honed Calacatta-style marble ----------
  function marble(W, H, o) {
    const col = new Uint8ClampedArray(W * H * 3), hgt = new Float32Array(W * H), rgh = new Float32Array(W * H), s = o.seed || 7;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x, u = x / W, v = y / H;
      const n1 = fbmP(u, v, 3, 3, 6, s), n2 = fbmP(u, v, 5, 5, 5, s + 4), cloud = fbmP(u, v, 2, 2, 4, s + 8);
      const v1 = Math.pow(1 - Math.abs(Math.sin(Math.PI * 2 * (u + v * 1) + n1 * 7)), 22), v2 = Math.pow(1 - Math.abs(Math.sin(Math.PI * 2 * (2 * u - v) + n2 * 6)), 60) * 0.55;
      const v3 = Math.pow(1 - Math.abs(Math.sin(Math.PI * 2 * (3 * u + 2 * v) + n1 * 9 + n2 * 3)), 140) * 0.35, vein = Math.min(1, v1 + v2 + v3);
      const base = 0.93 + (cloud - 0.5) * 0.08;
      col[i * 3] = lin(240 * base, 150, vein * 0.8); col[i * 3 + 1] = lin(239 * base, 150, vein * 0.8); col[i * 3 + 2] = lin(236 * base, 150, vein * 0.8);
      hgt[i] = -vein * 0.25 + cloud * 0.05; rgh[i] = 0.16 + vein * 0.1 + (cloud - 0.5) * 0.04; }
    return { c: toCanvas(W, H, (x, y, i) => [col[i * 3], col[i * 3 + 1], col[i * 3 + 2]]), n: normalCanvas(hgt, W, H, 0.6), r: greyCanvas(rgh, W, H) };
  }
  // ---------- large-format porcelain (texture spans 2 x 2 tiles) ----------
  function porcelain(S, o) {
    const col = new Uint8ClampedArray(S * S * 3), hgt = new Float32Array(S * S), rgh = new Float32Array(S * S), sh = [0.97, 1.03, 1.0, 0.95], s = o.seed || 21;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const i = y * S + x, u = x / S, v = y / S, tx = Math.floor(u * 2), ty = Math.floor(v * 2), gx = (u * 2) % 1, gy = (v * 2) % 1;
      const gw = 0.0016, gh = 0.0032, eg = Math.min(gx, 1 - gx) / gw, eh = Math.min(gy, 1 - gy) / gh, grout = eg < 1 || eh < 1, bevel = Math.min(1, Math.min(eg, eh) / 2.5);
      const cloud = fbmP(u, v, 4, 4, 5, s), speck = fbmP(u, v, 300, 300, 1, s + 3), fine = fbmP(u, v, 90, 90, 2, s + 6);
      const vn = fbmP(u, v, 3, 3, 5, s + 9), vein = Math.pow(1 - Math.abs(Math.sin(Math.PI * 2 * (u * 2 + v) + vn * 8)), 40) * 0.5 + Math.pow(1 - Math.abs(Math.sin(Math.PI * 2 * (u - v * 3) + vn * 6)), 90) * 0.3;
      const k = sh[ty * 2 + tx] * (0.9 + cloud * 0.18 + (fine - 0.5) * 0.08 + vein * 0.45) * (speck > 0.86 ? 1.15 : speck < 0.1 ? 0.9 : 1);
      if (grout) { col[i * 3] = 38; col[i * 3 + 1] = 37; col[i * 3 + 2] = 36; hgt[i] = -1; rgh[i] = 0.9; }
      else { col[i * 3] = o.c[0] * k; col[i * 3 + 1] = o.c[1] * k; col[i * 3 + 2] = o.c[2] * k; hgt[i] = -0.6 * (1 - bevel) + fine * 0.04; rgh[i] = o.r0 + (cloud - 0.5) * 0.12 + (fine - 0.5) * 0.06; } }
    return { c: toCanvas(S, S, (x, y, i) => [col[i * 3], col[i * 3 + 1], col[i * 3 + 2]]), n: normalCanvas(hgt, S, S, 3), r: greyCanvas(rgh, S, S) };
  }
  // ---------- micro surfaces: matte paint, loop-pile / woven textile, boucle ----------
  const field = (S, fn) => { const h = new Float32Array(S * S); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) h[y * S + x] = fn(x / S, y / S); return h; };
  const paintH = field(512, (u, v) => fbmP(u, v, 64, 64, 3, 31) * 0.7 + fbmP(u, v, 8, 8, 3, 33) * 0.3);
  const paintN = normalCanvas(paintH, 512, 512, 0.9), paintR = greyCanvas(paintH.map(h => 0.8 + (h - 0.5) * 0.12), 512, 512);
  const weaveH = field(512, (u, v) => { const a = Math.sin(u * Math.PI * 2 * 64), b = Math.sin(v * Math.PI * 2 * 64); return (a * b > 0 ? Math.abs(a) : Math.abs(b)) * 0.6 + fbmP(u, v, 32, 32, 2, 41) * 0.4; });
  const boucleH = field(512, (u, v) => { const n = fbmP(u, v, 48, 48, 3, 51, 0.7); return Math.pow(n, 1.6) + ss(0.7, 0.9, fbmP(u, v, 96, 96, 1, 53)) * 0.4; });

  { const lh = field(512, (u, v) => Math.pow(fbmP(u, v, 40, 40, 2, 61), 1.5) * 0.8 + fbmP(u, v, 160, 160, 1, 63) * 0.2);
    const ln = new THREE.CanvasTexture(normalCanvas(lh, 512, 512, 1.4)); ln.wrapS = ln.wrapT = THREE.RepeatWrapping; ln.repeat.set(2, 2); ln.colorSpace = THREE.NoColorSpace; ln.anisotropy = MAXA;
    const lr = new THREE.CanvasTexture(greyCanvas(lh.map(h => 0.42 + (h - 0.5) * 0.25), 512, 512)); lr.wrapS = lr.wrapT = THREE.RepeatWrapping; lr.repeat.set(2, 2); lr.colorSpace = THREE.NoColorSpace;
    M.leather_tan.normalMap = ln; M.leather_tan.normalScale.set(0.5, 0.5); M.leather_tan.roughnessMap = lr; M.leather_tan.roughness = 1; M.leather_tan.needsUpdate = true; }
  // ---------- regenerate the shared texture images in place ----------
  const sets = new Map();
  const upd = (t, set) => { if (!t) return; swapImage(t, set.c); sets.set(t, { n: companion(t, set.n), r: companion(t, set.r) }); };
  upd(T.oak, wood(1024, 1024, { c1: [204, 165, 118], c2: [150, 108, 66], rings: 26, warp: 3.2, contrast: 0.75, r0: 0.5 }));
  upd(T.oakDark, wood(1024, 1024, { c1: [128, 98, 70], c2: [82, 60, 40], rings: 30, warp: 3.5, contrast: 0.7, r0: 0.52, seed: 5 }));
  upd(T.batten, wood(512, 1024, { c1: [214, 166, 112], c2: [160, 112, 66], rings: 9, warp: 2.4, contrast: 0.8, r0: 0.55, seed: 9, bump: 1.6 }));
  upd(T.deck, wood(1024, 1024, { c1: [150, 112, 78], c2: [104, 76, 52], rings: 18, warp: 3, contrast: 0.7, r0: 0.7, seed: 13, alongU: true }));
  upd(T.marble, marble(1024, 1024, {}));
  // oak plank floor: planks along u, 6 rows, staggered butt joints, per-board tone
  { const W = 2048, H = 2048, base = wood(W, H, { c1: [206, 160, 108], c2: [150, 104, 62], rings: 60, warp: 4, contrast: 0.65, r0: 0.42, seed: 17, alongU: true });
    const ctx = base.c.getContext('2d'), nctx = base.n.getContext('2d'), rctx = base.r.getContext('2d');
    for (let r = 0; r < 6; r++) { const off = ((r * 0.37) % 1) * W, y0 = r * H / 6; for (let k = -1; k < 3; k++) { const x0 = off + k * W / 2;
        ctx.fillStyle = `rgba(${hash(r, k, 3) > 0.5 ? '255,235,210' : '60,40,25'},${0.04 + hash(r, k, 7) * 0.07})`; ctx.fillRect(x0, y0, W / 2, H / 6);
        for (const c2 of [ctx, nctx]) { c2.fillStyle = c2 === ctx ? 'rgba(40,26,14,.75)' : 'rgb(128,128,90)'; c2.fillRect(x0 - 1, y0, 3, H / 6); }
        rctx.fillStyle = 'rgb(200,200,200)'; rctx.fillRect(x0 - 1, y0, 3, H / 6); }
      for (const c2 of [ctx, nctx]) { c2.fillStyle = c2 === ctx ? 'rgba(40,26,14,.8)' : 'rgb(128,90,128)'; c2.fillRect(0, y0, W, 3); } rctx.fillRect(0, y0, W, 3); }
    upd(T.planks, base); }
  // porcelain floor tiles
  { const p = porcelain(2048, { c: [60, 59, 58], r0: 0.28 }); swapImage(T.tile, p.c); swapImage(T.tileR, p.r); sets.set(T.tile, { n: companion(T.tile, p.n), r: T.tileR }); }
  // chevron oak (design-agnostic re-sample of the existing herringbone layout)
  if (typeof S !== 'undefined' && S.chevron) { const W = 1024, wd = wood(W, W, { c1: [212, 162, 104], c2: [160, 108, 60], rings: 40, warp: 3, contrast: 0.6, r0: 0.42, seed: 23 });
    const src = wd.c.getContext('2d').getImageData(0, 0, W, W).data, srcN = wd.n.getContext('2d').getImageData(0, 0, W, W).data;
    const outC = new Uint8ClampedArray(W * W * 3), outN = new Uint8ClampedArray(W * W * 3), rg = new Float32Array(W * W);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) { const X = x / W * 1.2, Y = y / W * 1.2, c = Math.floor(X / 0.3), fx = X - c * 0.3, vv = Y + (c % 2 === 0 ? fx : 0.3 - fx), idx = Math.floor(vv / 0.1), fr = vv / 0.1 - idx;
      const seam = fr < 0.03 || fx < 0.004, su = ((fx / 0.3) * 0.25 + hash(idx, c, 1) * 0.75) % 1, sv = ((fr) * 0.1 + hash(c, idx, 2) * 0.9) % 1;
      const si = (Math.floor(sv * W) * W + Math.floor(su * W)) * 4, i = y * W + x, tone = 0.9 + hash(idx, c % 2, 4) * 0.18;
      for (let k = 0; k < 3; k++) { outC[i * 3 + k] = src[si + k] * tone * (seam ? 0.55 : 1); outN[i * 3 + k] = seam ? (k === 2 ? 200 : 128) : srcN[si + k]; } rg[i] = seam ? 0.85 : 0.42 + (src[si] / 255 - 0.6) * 0.1; }
    swapImage(S.chevron, toCanvas(W, W, (x, y, i) => [outC[i * 3], outC[i * 3 + 1], outC[i * 3 + 2]]));
    sets.set(S.chevron, { n: companion(S.chevron, toCanvas(W, W, (x, y, i) => [outN[i * 3], outN[i * 3 + 1], outN[i * 3 + 2]])), r: companion(S.chevron, greyCanvas(rg, W, W)) }); }
  swapImage(T.weaveN, normalCanvas(weaveH, 512, 512, 2.2)); swapImage(T.boucleN, normalCanvas(boucleH, 512, 512, 3.5));
  const paintNT = new THREE.CanvasTexture(paintN), paintRT = new THREE.CanvasTexture(paintR);
  for (const t of [paintNT, paintRT]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / 0.6, 1 / 0.6); t.anisotropy = MAXA; }

  // ---------- material pass ----------
  const lum = c => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const PHYS_KEYS = ['color', 'map', 'normalMap', 'normalScale', 'roughness', 'roughnessMap', 'metalness', 'metalnessMap', 'envMapIntensity', 'side', 'transparent', 'opacity', 'alphaTest', 'emissive', 'emissiveIntensity', 'emissiveMap', 'polygonOffset', 'polygonOffsetFactor', 'polygonOffsetUnits', 'depthWrite', 'aoMap', 'name'];
  const physCache = new Map(), physSet = new Set();
  const toPhysical = (m, extra) => { if (physCache.has(m)) return physCache.get(m); const p = new THREE.MeshPhysicalMaterial();
    for (const k of PHYS_KEYS) if (m[k] !== undefined) p[k] = (m[k] && m[k].isColor) || (m[k] && m[k].isVector2) ? m[k].clone() : m[k]; Object.assign(p, extra); physCache.set(m, p); physSet.add(p); return p; };
  const seen = new Set();
  const upgrade = (m) => {
    if (!m || !m.isMeshStandardMaterial || physSet.has(m)) return m;
    if (!seen.has(m)) { seen.add(m);
      for (const k of ['map', 'normalMap', 'roughnessMap']) if (m[k]) { m[k].anisotropy = MAXA; m[k].needsUpdate = true; }
      const set = m.map && sets.get(m.map);
      if (set) { if (!m.normalMap || m.normalMap === T.renderN) m.normalMap = set.n; m.normalScale = new THREE.Vector2(0.9, 0.9); m.roughnessMap = set.r; m.roughness = 1; }
      if (m.map === T.tile) m.normalScale = new THREE.Vector2(0.6, 0.6);
      // dark matte paint and black joinery (photo: eggshell black, not glossy)
      if (!m.map && !m.transparent && m.metalness < 0.3 && m.roughness >= 0.5 && lum(m.color) < 0.03 && !m.emissiveMap) { m.normalMap = paintNT; m.normalScale = new THREE.Vector2(0.35, 0.35); m.roughnessMap = paintRT; m.roughness = 1.05; }
      // painted plaster walls: same micro texture, lighter touch
      if (m.map === T.plaster) { m.normalMap = paintNT; m.normalScale = new THREE.Vector2(0.25, 0.25); m.roughnessMap = paintRT; m.roughness = 1.1; }
      if (!m.transparent && !m.emissiveMap) m.envMapIntensity = m.metalness > 0.5 ? 1.0 : 0.85;
    }
    // upholstery: cloth sheen; marble / stone: honed finish with a thin clear coat
    if ((m.normalMap === T.boucleN || m.normalMap === T.weaveN) && m.roughness >= 0.85 && !m.transparent) return toPhysical(m, { sheen: 0.7, sheenRoughness: 0.75, sheenColor: m.color.clone().lerp(new THREE.Color(1, 1, 1), 0.35), roughness: 0.95 });
    if (m.map === T.marble) return toPhysical(m, { clearcoat: 0.25, clearcoatRoughness: 0.2 });
    if (!m.map && !m.transparent && m.metalness < 0.2 && m.roughness < 0.3 && lum(m.color) > 0.6) return toPhysical(m, { clearcoat: 0.2, clearcoatRoughness: 0.25 });   // white stone tops, ceramics
    return m;
  };
  scene.traverse(o => { if (!o.isMesh) return; o.material = Array.isArray(o.material) ? o.material.map(upgrade) : upgrade(o.material); });
  const allMats = new Set(); scene.traverse(o => { if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m && m.isMeshStandardMaterial) { allMats.add(m); m.userData.env0 = m.envMapIntensity; } }); });
  const setEnvScale = k => allMats.forEach(m => m.envMapIntensity = (m.userData.env0 ?? 1) * k);
  window.__pbr = { setEnvScale, probe: false, bloom: () => bloom, vig: null };

  // ---------- HDR environment (CC0 interior HDRI, embedded) + PMREM ----------
  let baseEnv = scene.environment;
  try { const bin = atob(window.__HDR_B64 || ''), buf = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    const ld = new RGBELoader(); ld.setDataType(THREE.HalfFloatType); const d = ld.parse(buf.buffer);
    const t = new THREE.DataTexture(d.data, d.width, d.height, THREE.RGBAFormat, d.type); t.colorSpace = THREE.LinearSRGBColorSpace; t.flipY = true; t.magFilter = t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; t.mapping = THREE.EquirectangularReflectionMapping; t.needsUpdate = true;
    baseEnv = pmrem.fromEquirectangular(t).texture; scene.environment = baseEnv; t.dispose(); } catch (e) { console.warn('HDR env unavailable', e); }

  // ---------- warm recessed downlights: 3000 K emitters + a pool of real spot lights following the viewer ----------
  M.led_cool.color.setRGB(1.0, 0.82, 0.62).multiplyScalar(5.5);
  const downs = [];
  { const cells = new Map();
    scene.traverse(o => { if (!o.isMesh || o.material !== M.led_cool) return; o.updateWorldMatrix(true, false); const p = o.geometry.attributes.position, v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); const key = Math.round(v.x / 0.15) + ',' + Math.round(v.z / 0.15) + ',' + Math.round(v.y / 0.1);
        let c = cells.get(key); if (!c) cells.set(key, c = { n: 0, min: v.clone(), max: v.clone() }); c.n++; c.min.min(v); c.max.max(v); } });
    for (const c of cells.values()) { const ex = c.max.x - c.min.x, ez = c.max.z - c.min.z, ey = c.max.y - c.min.y;
      if (c.n >= 60 && ex > 0.06 && ex < 0.14 && ez > 0.06 && ez < 0.14 && ey < 0.03) downs.push(new THREE.Vector3((c.min.x + c.max.x) / 2, c.min.y - 0.02, (c.min.z + c.max.z) / 2)); } }
  window.__pbr.downs = downs;
  const pool = []; for (let k = 0; k < 10; k++) { const s = new THREE.SpotLight(0xffdcb8, 0, 7.5, 0.72, 1.0, 2); s.visible = false; scene.add(s, s.target); pool.push(s); }
  let lastAssign = 0;
  const assignPool = (now) => { if (now - lastAssign < 400) return; lastAssign = now; const walking = isWalk(), cp = camera.position;
    const near = walking ? downs.filter(d => d.y > cp.y && d.y - cp.y < 2.6 && Math.abs(d.x - cp.x) < 12 && Math.abs(d.z - cp.z) < 12).sort((a, b) => a.distanceToSquared(cp) - b.distanceToSquared(cp)) : [];
    pool.forEach((s, k) => { const d = near[k]; s.visible = !!d; s.intensity = d ? 11 : 0; if (d) { s.position.copy(d); s.target.position.set(d.x, d.y - 3, d.z); s.target.updateMatrixWorld(); } }); };

  // ---------- soft indirect light: local irradiance/reflection probe rendered at the viewer ----------
  const cubeRT = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType }), cubeCam = new THREE.CubeCamera(0.05, 60, cubeRT); scene.add(cubeCam);
  let probeEnv = null, probePos = new THREE.Vector3(1e9, 0, 0), probeAt = 0, wasWalk = false;
  const updateProbe = (now) => {
    const walking = isWalk() && !window.__exporting && window.__pbr.probe;
    if (!walking) { if (wasWalk) { scene.environment = baseEnv; wasWalk = false; } return; }
    if (wasWalk && camera.position.distanceTo(probePos) < 1.2 && now - probeAt < 4000) return;
    if (now - probeAt < 350) return;
    probeAt = now; probePos.copy(camera.position); wasWalk = true;
    const vis = []; scene.traverse(o => { if (o.isMesh && o.visible && o.material && o.material.transparent) { o.visible = false; vis.push(o); } });
    const prevTM = renderer.toneMapping; renderer.toneMapping = THREE.NoToneMapping; scene.environment = baseEnv;
    cubeCam.position.copy(camera.position); cubeCam.update(renderer, scene); renderer.toneMapping = prevTM; vis.forEach(o => o.visible = true);
    const next = pmrem.fromCubemap(cubeRT.texture).texture; if (probeEnv) probeEnv.dispose(); probeEnv = next; scene.environment = probeEnv; };

  // ---------- lights, exposure and post ----------
  hemi.color.set(0xf1ece4); hemi.groundColor.set(0x5a5148);
  sun.color.set(0xfff0dc);
  gtao.blendIntensity = 1.0;
  gtao.updateGtaoMaterial({ radius: 0.7, distanceExponent: 2, thickness: 1.2, scale: 1.0, samples: 16, distanceFallOff: 1 });
  bloom.strength = 0.16; bloom.radius = 0.35; bloom.threshold = 1.0;
  { const vig = new ShaderPass(VignetteShader); vig.uniforms.offset.value = 0.55; vig.uniforms.darkness.value = 1.0; composer.insertPass(vig, composer.passes.length - 1); }
  composer.setPixelRatio(Math.min(devicePixelRatio, 2));
  window.__pbrTick = (now, dt) => {
    const walking = isWalk();
    const target = walking ? 1.08 : 0.95; renderer.toneMappingExposure += (target - renderer.toneMappingExposure) * Math.min(1, dt * 3);
    hemi.intensity = walking ? 0.22 : 0.35;
    assignPool(now); updateProbe(now);
  };
}

// ================================================================== MENU (hamburger + overlay)
{
  const btn = document.getElementById('menubtn'), menu = document.getElementById('menu'), closeBtn = menu.querySelector('.m__x');
  const scrim = document.createElement('div'); scrim.className = 'm-scrim'; document.body.appendChild(scrim);
  const tabs = [...menu.querySelectorAll('[role="tab"]')];
  const isOpen = () => menu.classList.contains('is-open');
  const focusables = () => [...menu.querySelectorAll('button, input, [tabindex]:not([tabindex="-1"])')].filter(e => !e.closest('[hidden]') && e.offsetParent !== null);
  function open() {
    window.__menuOpen = true; for (const k in walk.keys) walk.keys[k] = false;
    menu.classList.add('is-open'); scrim.classList.add('on'); menu.setAttribute('aria-hidden', 'false'); btn.setAttribute('aria-expanded', 'true');
    setTimeout(() => closeBtn.focus(), 30);
  }
  function close(returnFocus = true) {
    if (!isOpen()) return;
    window.__menuOpen = false;
    menu.classList.remove('is-open'); scrim.classList.remove('on'); menu.setAttribute('aria-hidden', 'true'); btn.setAttribute('aria-expanded', 'false');
    if (returnFocus) btn.focus({ preventScroll: true });
  }
  function selectTab(t, focus) {
    tabs.forEach(x => { const on = x === t; x.setAttribute('aria-selected', String(on)); x.tabIndex = on ? 0 : -1; document.getElementById(x.getAttribute('aria-controls')).hidden = !on; });
    if (focus) t.focus();
    menu.querySelector('.m__body').scrollTop = 0;
  }
  btn.addEventListener('click', () => (isOpen() ? close() : open()));
  closeBtn.addEventListener('click', () => close());
  scrim.addEventListener('click', () => close());
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => selectTab(t));
    t.addEventListener('keydown', e => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (d) { e.preventDefault(); selectTab(tabs[(i + d + tabs.length) % tabs.length], true); }
    });
  });
  // picking a place to go takes you straight there
  menu.querySelectorAll('[data-view], #walkfloor button').forEach(b => b.addEventListener('click', () => setTimeout(() => close(false), 120)));
  document.addEventListener('keydown', e => {
    if (!isOpen()) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === 'Tab') {
      const f = focusables(); if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }, true);
  // hide the menu button during the first-person barista mode (its Exit button sits top-right)
  const vr = document.getElementById('vr');
  if (vr) new MutationObserver(() => { btn.hidden = !vr.hidden; if (!vr.hidden) close(false); }).observe(vr, { attributes: true, attributeFilter: ['hidden'] });
}
