import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/* ------------------------------------------------------------------
 * SCZ幻卡工坊 · 全息闪卡实时渲染
 * 四层合成（主体/背景/文字/线稿）+ 视差 + 镭射光谱 + Voronoi 星光，
 * 思路致敬 EverettFish/holo-card-studio（MIT）。
 * 本页卡片几何为程序化生成：圆角卡体 + 正背面 + 鎏金描边，无需 GLB。
 * ------------------------------------------------------------------ */

const stage = document.querySelector('#stage');
const loading = document.querySelector('#loading');
const $ = (id) => document.getElementById(id);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const CARD_W = 6, CARD_H = 9, CARD_R = 0.42, CARD_T = 0.07;

let renderer, composer, root, uniforms, config;
let auto = false, flipped = false, dragging = false;
let targetX = 0.03, targetY = -0.14, targetZoom = 1;
let rotationX = targetX, rotationY = targetY;
let last = { x: 0, y: 0 }, lastTime = 0, elapsed = 0;

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-5, 5, 5.65, -5.65, 0.1, 100);
camera.position.set(0, 0, 20);
camera.lookAt(0, 0, 0);

/* ---------------- shaders ---------------- */

const vertex = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const shared = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform float uFoil;
uniform float uScale;
uniform float uDepth;
uniform float uBgDepth;
uniform float uSafeScale;
uniform vec2 uSafeOffset;
uniform vec3 uView;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
vec3 spectrum(float t) {
  t = fract(t);
  vec3 pink = vec3(1.0, 0.32, 0.62);
  vec3 yellow = vec3(1.0, 0.85, 0.32);
  vec3 blue = vec3(0.22, 0.62, 1.0);
  if (t < 0.35) return mix(pink, yellow, t / 0.35);
  if (t < 0.7) return mix(yellow, blue, (t - 0.35) / 0.35);
  return mix(blue, vec3(1.0), (t - 0.7) / 0.3);
}
vec3 overlay(vec3 b, vec3 f) {
  return mix(2.0 * b * f, 1.0 - 2.0 * (1.0 - b) * (1.0 - f), step(vec3(0.5), b));
}
float inside(vec2 p) {
  return step(0.0, p.x) * step(0.0, p.y) * step(p.x, 1.0) * step(p.y, 1.0);
}
/* 以卡面为基准的视角相关视差：缩放 + 视线投影偏移 */
vec2 parallax(vec2 p, float s, float d) {
  return (p - 0.5) * s + 0.5 + uView.xy / max(abs(uView.z), 0.35) * d * 0.14;
}
/* 镭射条纹：相位随视角流动 */
float wave(vec2 p) {
  vec2 a = p + uView.xy * 2.4;
  return 0.5 + 0.5 * sin((a.x * 0.848 - a.y * 0.530) * 6.283 * 0.55 + 7.0 * noise(a * 1.5));
}
/* Sparse twinkling Voronoi starlight */
float star(vec2 p) {
  vec2 q = p * 105.0, id = floor(q), f = fract(q);
  float first = 9.0, second = 9.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = vec2(hash(id + g), hash(id + g + 43.3));
      float d = length(g + o - f);
      if (d < first) { second = first; first = d; }
      else { second = min(second, d); }
    }
  }
  float edge = 1.0 - smoothstep(0.01, 0.035, second - first);
  float sparse = step(0.90, hash(id + 8.8));
  float twinkle = pow(0.5 + 0.5 * sin(uTime * 1.8 + hash(id) * 30.0 + uView.x * 27.0 + uView.y * 21.0), 6.0);
  return edge * sparse * twinkle;
}
`;

const frontFragment = shared + /* glsl */`
uniform sampler2D tSubject;
uniform sampler2D tBackground;
uniform sampler2D tText;
uniform sampler2D tLine;
void main() {
  vec2 uv = vUv;
  vec2 su = parallax(uv, uScale, uDepth) * uSafeScale + uSafeOffset;
  vec2 bu = parallax(uv, 1.0, uBgDepth);
  vec4 sub = texture2D(tSubject, clamp(su, 0.0, 1.0));
  sub.a *= inside(su);
  vec3 bg = texture2D(tBackground, clamp(bu, 0.0, 1.0)).rgb;
  float w = wave(uv);
  vec3 foil = spectrum(w * 0.8 + noise(uv * 5.0) * 0.12);
  vec3 subject = mix(sub.rgb, overlay(sub.rgb, foil), uFoil * 0.28);
  bg = mix(bg, overlay(bg, foil), uFoil * 0.36);
  vec3 col = mix(bg, subject, sub.a);
  /* View-swept rainbow sheen */
  float sweep = pow(max(0.0, sin((uv.x * 0.83 + uv.y * 0.35 + uView.x * 1.8 + uView.y * 0.9) * 6.283)), 12.0);
  col += foil * sweep * uFoil * 0.28;
  /* Line-art breathing light: masked to the subject, rides the sheen */
  float line = 1.0 - smoothstep(0.06, 0.25, texture2D(tLine, clamp(su, 0.0, 1.0)).r);
  col += vec3(1.0, 0.94, 0.78) * line * inside(su) * sub.a * sweep * uFoil * 0.22;
  /* Background starfield */
  col += vec3(0.66, 0.86, 1.0) * star(bu) * uFoil * 0.65 * (1.0 - sub.a * 0.7);
  /* Type layer pinned to the surface */
  vec4 text = texture2D(tText, uv);
  col = mix(col, text.rgb, text.a);
  gl_FragColor = vec4(pow(max(col, vec3(0.0)), vec3(2.2)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const edgeFragment = shared + /* glsl */`
void main() {
  vec3 col = mix(vec3(0.55, 0.34, 0.10), spectrum(wave(vUv)), 0.65 + uFoil * 0.2);
  gl_FragColor = vec4(col * 0.8 + 0.14, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const frameFragment = shared + /* glsl */`
void main() {
  vec3 gold = vec3(0.79, 0.63, 0.38);
  vec3 foil = spectrum(wave(vUv) * 0.9 + 0.15);
  float glint = pow(max(0.0, sin((vUv.x * 0.9 + vUv.y * 0.4 + uView.x * 2.0 + uView.y) * 6.283)), 8.0);
  vec3 col = mix(gold, overlay(gold, foil), 0.35 + uFoil * 0.35) + foil * glint * uFoil * 0.5;
  gl_FragColor = vec4(pow(max(col, vec3(0.0)), vec3(2.2)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const backFragment = shared + /* glsl */`
uniform sampler2D tBack;
void main() {
  vec4 art = texture2D(tBack, vUv);
  vec2 p = vUv - 0.5;
  float filigree = 0.5 + 0.5 * sin(length(p * vec2(1.0, 1.5)) * 100.0 + noise(p * 15.0) * 4.0);
  vec3 col = mix(vec3(0.035, 0.030, 0.070), vec3(0.100, 0.075, 0.140), filigree * 0.35);
  float border = step(0.465, max(abs(p.x), abs(p.y)));
  col = mix(col, spectrum(wave(vUv)) * 0.55, border);
  col += spectrum(wave(vUv)) * uFoil * 0.08;
  col = mix(col, art.rgb, art.a);
  gl_FragColor = vec4(pow(max(col, vec3(0.0)), vec3(2.2)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/* ---------------- procedural card geometry ---------------- */

function traceRoundRect(path, w, h, r) {
  const x = -w / 2, y = -h / 2;
  path.moveTo(x + r, y);
  path.lineTo(x + w - r, y);
  path.quadraticCurveTo(x + w, y, x + w, y + r);
  path.lineTo(x + w, y + h - r);
  path.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  path.lineTo(x + r, y + h);
  path.quadraticCurveTo(x, y + h, x, y + h - r);
  path.lineTo(x, y + r);
  path.quadraticCurveTo(x, y, x + r, y);
  return path;
}

function remapUV(geometry) {
  const pos = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i,
      (pos.getX(i) + CARD_W / 2) / CARD_W,
      (pos.getY(i) + CARD_H / 2) / CARD_H);
  }
  uv.needsUpdate = true;
  return geometry;
}

function cardShape() {
  return traceRoundRect(new THREE.Shape(), CARD_W, CARD_H, CARD_R);
}

function buildCard(frontMat, edgeMat, backMat, frameMat) {
  const group = new THREE.Group();
  // 圆角卡体（含侧边），盖面藏于正背面之下
  const bodyGeo = new THREE.ExtrudeGeometry(cardShape(), {
    depth: CARD_T, bevelEnabled: false, curveSegments: 24,
  });
  bodyGeo.translate(0, 0, -CARD_T / 2);
  group.add(new THREE.Mesh(bodyGeo, edgeMat));
  // 正背面（同一份几何，背面整体转 180°，UV 不需镜像）
  const faceGeo = remapUV(new THREE.ShapeGeometry(cardShape(), 24));
  const front = new THREE.Mesh(faceGeo, frontMat);
  front.position.z = CARD_T / 2 + 0.002;
  group.add(front);
  const back = new THREE.Mesh(faceGeo, backMat);
  back.rotation.y = Math.PI;
  back.position.z = -(CARD_T / 2 + 0.002);
  group.add(back);
  // 鎏金描边框（正背各一）
  const frameShape = cardShape();
  frameShape.holes.push(traceRoundRect(new THREE.Path(), CARD_W - 0.26, CARD_H - 0.26, CARD_R - 0.13));
  const frameGeo = remapUV(new THREE.ShapeGeometry(frameShape, 24));
  const frameF = new THREE.Mesh(frameGeo, frameMat);
  frameF.position.z = CARD_T / 2 + 0.004;
  group.add(frameF);
  const frameB = new THREE.Mesh(frameGeo, frameMat);
  frameB.rotation.y = Math.PI;
  frameB.position.z = -(CARD_T / 2 + 0.004);
  group.add(frameB);
  return group;
}

/* 卡背图案：Canvas 程序绘制 */
function backTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 1536;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 1024, 1536);
  const gold = '#c9a86a', goldSoft = '#dbc18b', faint = '#a09a8f';
  ctx.strokeStyle = gold; ctx.lineWidth = 2;
  ctx.strokeRect(74, 74, 876, 1388);
  ctx.strokeRect(88, 88, 848, 1360);
  ctx.save();
  ctx.translate(512, 640); ctx.rotate(Math.PI / 4);
  ctx.strokeRect(-210, -210, 420, 420);
  ctx.strokeRect(-194, -194, 388, 388);
  ctx.restore();
  // 菱形四角小雷纹
  ctx.save();
  ctx.translate(512, 640); ctx.fillStyle = gold;
  for (const [dx, dy] of [[0, -268], [0, 268], [-268, 0], [268, 0]]) {
    ctx.save(); ctx.translate(dx, dy); ctx.rotate(Math.PI / 4);
    ctx.fillRect(-9, -9, 18, 18); ctx.restore();
  }
  ctx.restore();
  const serif = '"Kaiti SC","KaiTi","STKaiti","Noto Serif SC",serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = goldSoft;
  ctx.font = `166px ${serif}`;
  ctx.fillText('樱', 512, 700);
  ctx.font = `30px ${serif}`;
  ctx.fillText(config.collection || 'SCZ 全息典藏', 512, 1050);
  ctx.font = '20px Georgia, serif';
  ctx.fillStyle = faint;
  ctx.fillText('SCZ HOLO ATELIER', 512, 1114);
  ctx.fillText(config.edition || 'No.001', 512, 1310);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/* ---------------- boot ---------------- */

async function init() {
  config = await fetch('./card-config.json').then((r) => {
    if (!r.ok) throw Error('找不到卡牌配置');
    return r.json();
  });
  document.title = `${config.title} · SCZ幻卡工坊`;
  for (const [id, key] of Object.entries({
    'card-title': 'title', collection: 'collection', subtitle: 'subtitle',
    description: 'description', tagline: 'tagline', technique: 'technique', edition: 'edition',
  })) {
    if (config[key]) $(id).textContent = config[key];
  }

  renderer = new THREE.WebGLRenderer({
    antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance',
  });
  renderer.setClearColor(0x000000, 1);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  stage.append(renderer.domElement);

  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(720, 1000), 0.18, 0.35, 1.0));
  composer.addPass(new OutputPass());

  const loader = new THREE.TextureLoader();
  const names = ['subject', 'background', 'text', 'lineart'];
  const textures = await Promise.all(names.map((n) => loader.loadAsync(config.assets[n])));
  textures.forEach((t) => {
    t.colorSpace = THREE.NoColorSpace;
    t.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
  });

  const prm = config.parameters || {};
  uniforms = {
    tSubject: { value: textures[0] },
    tBackground: { value: textures[1] },
    tText: { value: textures[2] },
    tLine: { value: textures[3] },
    tBack: { value: backTexture() },
    uTime: { value: 0 },
    uView: { value: new THREE.Vector3(0, 0, 1) },
    uFoil: { value: prm.foil ?? 0.65 },
    uScale: { value: prm.subjectScale ?? 1.25 },
    uDepth: { value: prm.subjectDepth ?? 0.4 },
    uBgDepth: { value: prm.backgroundDepth ?? -0.25 },
    uSafeScale: { value: config.safeArea?.scale ?? 1.0 },
    uSafeOffset: { value: new THREE.Vector2(...(config.safeArea?.offset ?? [0, 0])) },
  };

  const frontMat = new THREE.ShaderMaterial({ uniforms, vertexShader: vertex, fragmentShader: frontFragment });
  const edgeMat = new THREE.ShaderMaterial({ uniforms, vertexShader: vertex, fragmentShader: edgeFragment });
  const backMat = new THREE.ShaderMaterial({ uniforms, vertexShader: vertex, fragmentShader: backFragment });
  const frameMat = new THREE.ShaderMaterial({ uniforms, vertexShader: vertex, fragmentShader: frameFragment });

  root = buildCard(frontMat, edgeMat, backMat, frameMat);
  scene.add(root);

  setupControls();
  new ResizeObserver(resize).observe(stage);
  resize();
  loading.remove();
  window.__holo = { ready: true, config, renderer, root, uniforms, reset };
  renderer.setAnimationLoop(animate);
}

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  if (!w || !h || !renderer) return;
  const aspect = w / h;
  const halfH = 5.65 / targetZoom;
  camera.left = -halfH * aspect;
  camera.right = halfH * aspect;
  camera.top = halfH;
  camera.bottom = -halfH;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
}

function setAuto(value) {
  auto = value;
  $('auto').setAttribute('aria-pressed', String(auto));
  $('auto').innerHTML = auto ? '<span>Ⅱ</span> 暂停赏卡' : '<span>▷</span> 自动赏卡';
}

function reset() {
  targetX = 0.03; targetY = -0.14; targetZoom = 1;
  flipped = false; setAuto(false);
  $('view-label').textContent = 'FRONT · 正面';
  $('flip').innerHTML = '翻看背面 <span>↻</span>';
  resize();
}

function flip() {
  flipped = !flipped;
  setAuto(false);
  targetY = flipped ? Math.PI : 0;
  targetX = 0;
  $('flip').innerHTML = flipped ? '回到正面 <span>↻</span>' : '翻看背面 <span>↻</span>';
  $('view-label').textContent = flipped ? 'BACK · 背面' : 'FRONT · 正面';
}

function setupControls() {
  for (const [id, name, label] of [
    ['foil', 'uFoil', 'foil-value'], ['depth', 'uDepth', 'depth-value'],
  ]) {
    const input = $(id);
    input.value = uniforms[name].value;
    const update = () => {
      uniforms[name].value = Number(input.value);
      $(label).value = id === 'foil'
        ? `${Math.round(input.value * 100)}%`
        : Number(input.value).toFixed(2);
    };
    input.addEventListener('input', update);
    update();
  }
  // 主体缩放：zoom 语义，往右 = 人更大（100% = 配置中性点，画面与之前默认一致）
  const scaleBase = uniforms.uScale.value;
  const scaleInput = $('scale');
  const updateScale = () => {
    const zoom = Number(scaleInput.value);
    uniforms.uScale.value = scaleBase / zoom;
    $('scale-value').value = `${Math.round(zoom * 100)}%`;
  };
  scaleInput.addEventListener('input', updateScale);
  updateScale();
  // 背景深度：往右 = 更深（滑杆取正值，写入 shader 时取负）
  const bgInput = $('bg-depth');
  bgInput.value = Math.abs(uniforms.uBgDepth.value);
  const updateBg = () => {
    const v = Number(bgInput.value);
    uniforms.uBgDepth.value = -v;
    $('bg-depth-value').value = v.toFixed(2);
  };
  bgInput.addEventListener('input', updateBg);
  updateBg();
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    dragging = true; setAuto(false);
    last = { x: e.clientX, y: e.clientY };
    stage.setPointerCapture(e.pointerId);
    stage.focus({ preventScroll: true });
  });
  stage.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const base = flipped ? Math.PI : 0;
    targetY = THREE.MathUtils.clamp(targetY + (e.clientX - last.x) * 0.006, base - 0.65, base + 0.65);
    targetX = THREE.MathUtils.clamp(targetX + (e.clientY - last.y) * 0.005, -0.43, 0.43);
    last = { x: e.clientX, y: e.clientY };
  });
  const up = () => { dragging = false; };
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);
  stage.addEventListener('lostpointercapture', up);
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    targetZoom = THREE.MathUtils.clamp(targetZoom - e.deltaY * 0.001, 0.82, 1.18);
    resize();
  }, { passive: false });
  stage.addEventListener('keydown', (e) => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'f', 'F', 'r', 'R'].includes(e.key)) {
      e.preventDefault(); setAuto(false);
    }
    const base = flipped ? Math.PI : 0;
    if (e.key === 'ArrowLeft') targetY -= 0.07;
    if (e.key === 'ArrowRight') targetY += 0.07;
    if (e.key === 'ArrowUp') targetX -= 0.06;
    if (e.key === 'ArrowDown') targetX += 0.06;
    if (e.key.toLowerCase() === 'f') flip();
    if (e.key.toLowerCase() === 'r') reset();
    targetY = THREE.MathUtils.clamp(targetY, base - 0.65, base + 0.65);
    targetX = THREE.MathUtils.clamp(targetX, -0.43, 0.43);
  });
  $('auto').onclick = () => { if (flipped) flip(); setAuto(!auto); };
  $('flip').onclick = flip;
  $('reset').onclick = reset;
  $('save').onclick = () => {
    try {
      composer.render();
      const a = document.createElement('a');
      a.download = `${config.title || 'card'}-holographic.png`;
      a.href = renderer.domElement.toDataURL('image/png');
      a.click();
    } catch {
      $('save').textContent = '保存失败，请重试';
    }
  };
  $('details').onclick = $('soundless').onclick = () => $('about').showModal();
  $('about').querySelector('.close').onclick = () => $('about').close();
}

const _inv = new THREE.Matrix4();
function animate(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.1) || 0;
  lastTime = now;
  if (!document.hidden) elapsed += dt;
  if (auto) {
    targetY = Math.sin(elapsed * 0.65) * 0.38;
    targetX = Math.sin(elapsed * 0.85) * 0.12;
  }
  const ease = reduced ? 1 : 1 - Math.exp(-dt * 8);
  rotationX += (targetX - rotationX) * ease;
  rotationY += (targetY - rotationY) * ease;
  root.rotation.set(rotationX, rotationY, 0);
  root.updateMatrixWorld(true);
  // 以卡面根节点为基准帧求视角向量（Y-up 转换后的局部轴不可直接用）
  uniforms.uView.value.copy(camera.position).applyMatrix4(_inv.copy(root.matrixWorld).invert()).normalize();
  uniforms.uTime.value = reduced && !auto ? 0 : elapsed;
  composer.render();
}

init().catch((error) => {
  console.error(error);
  loading.textContent = `卡牌暂时无法加载。\n${error.message}\n请通过本地服务打开网页，并确认素材已生成。`;
  loading.setAttribute('role', 'alert');
  window.__holo = { ready: false, error: error.message };
});
