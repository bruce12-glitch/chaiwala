/* ══════════════════════════════════════════════════════════════════════════
   CHAIWALA — world.js
   The Three.js world: procedural kulhad, tea shader, GPU steam, instanced
   spices, a scroll-driven camera journey and post-processing.
   ══════════════════════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import { EffectComposer }   from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }       from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass }  from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass }       from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass }       from 'three/addons/postprocessing/OutputPass.js';

/* ─── palette (mirrors the CSS tokens) ───────────────────────────────── */
const C = {
  ink:      0x0A0705,
  ink2:     0x140D09,
  tea:      0xE8A33D,
  teaHi:    0xF5C169,
  teaDeep:  0x8A4A1C,
  clay:     0xC1622F,
  cream:    0xF3E6D0,
  cardamom: 0x7A8B4F,
  wood:     0x2A1A11,
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp  = (a, b, t) => a + (b - a) * t;
const rand  = (a, b) => a + Math.random() * (b - a);

/* Colours used to clear the canvas. WebGLBackground converts these from the
   linear working space into the output colour space before handing them to
   gl.clearColor, so a plain sRGB Color is already correct here. */
const INK_CLEAR   = new THREE.Color(0x0A0705);
const PANEL_CLEAR = new THREE.Color(0x140D09);   // == --panel

/* the tea surface sits just inside the inner wall of the kulhad */
const LIQUID_R = 0.450;

/* A soft radial blob used as a contact shadow, so the cup sits on a surface
   instead of floating in front of it. */
let _shadowTex = null;
function contactShadowTexture(){
  if (_shadowTex) return _shadowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0.00, 'rgba(0,0,0,0.92)');
  g.addColorStop(0.42, 'rgba(0,0,0,0.46)');
  g.addColorStop(0.72, 'rgba(0,0,0,0.14)');
  g.addColorStop(1.00, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  _shadowTex = new THREE.CanvasTexture(c);
  _shadowTex.colorSpace = THREE.SRGBColorSpace;
  return _shadowTex;
}

function makeContactShadow(size = 1.75, y = 0.006){
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({
      map: contactShadowTexture(), transparent: true,
      depthWrite: false, opacity: 0.95, fog: false,
    })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = y;
  return m;
}

/* shared uniform — one write updates every injected shader */
const uTime = { value: 0 };

/* ══════════════════════════════════════════════════════════════════════
   GEOMETRY FACTORIES
   ══════════════════════════════════════════════════════════════════ */

/* A kulhad: the earthen clay cup chai is poured into. The profile is an
   S-curve with a flared rim, not a straight cone. */
function makeKulhadGeometry(){
  const V2 = THREE.Vector2;
  const profile = [
    [0.000, 0.000], [0.300, 0.000], [0.345, 0.030], [0.385, 0.100],
    [0.418, 0.220], [0.442, 0.360], [0.458, 0.520], [0.468, 0.680],
    [0.474, 0.820], [0.482, 0.910], [0.500, 0.980], [0.512, 1.000],
    [0.488, 1.012],                                          // rim lip
    [0.470, 0.960], [0.452, 0.820], [0.440, 0.680], [0.430, 0.520],
    [0.414, 0.360], [0.386, 0.220], [0.352, 0.100], [0.305, 0.055],
    [0.150, 0.048], [0.001, 0.045],                          // inner floor
  ].map(p => new V2(p[0], p[1]));

  const g = new THREE.LatheGeometry(profile, 72);
  g.computeVertexNormals();
  return g;
}

/* Star anise: an 8-point extruded star. */
function makeStarAniseGeometry(){
  const shape = new THREE.Shape();
  const pts = 8, outer = 0.46, inner = 0.115;
  for (let i = 0; i < pts * 2; i++){
    const a = (i / (pts * 2)) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? outer : inner;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y);
  }
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: 0.10, bevelEnabled: true, bevelThickness: 0.035,
    bevelSize: 0.035, bevelSegments: 2, curveSegments: 3,
  });
  g.center();
  return g;
}

/* Cinnamon quill: a bent open tube. */
function makeCinnamonGeometry(){
  const g = new THREE.CylinderGeometry(0.072, 0.086, 0.86, 10, 6, true);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++){
    const y = pos.getY(i);
    const bend = Math.sin((y / 0.86 + 0.5) * Math.PI) * 0.075;
    pos.setX(i, pos.getX(i) + bend);
  }
  g.computeVertexNormals();
  return g;
}

/* Tea leaf: a flat blade, gently cupped. */
function makeLeafGeometry(){
  const s = new THREE.Shape();
  s.moveTo(0, -0.34);
  s.bezierCurveTo(0.20, -0.16, 0.24, 0.14, 0, 0.36);
  s.bezierCurveTo(-0.24, 0.14, -0.20, -0.16, 0, -0.34);
  const g = new THREE.ShapeGeometry(s, 10);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++){
    const x = pos.getX(i), y = pos.getY(i);
    pos.setZ(i, Math.cos(x * 5.2) * 0.055 - Math.abs(x) * 0.14 + (y * y) * 0.16);
  }
  g.computeVertexNormals();
  return g;
}

/* Clove: bud head on a tapered stem, as one lathe. */
function makeCloveGeometry(){
  const V2 = THREE.Vector2;
  const profile = [
    [0.000, 0.00], [0.040, 0.01], [0.058, 0.10], [0.052, 0.20],
    [0.048, 0.30], [0.070, 0.40], [0.112, 0.50], [0.132, 0.60],
    [0.118, 0.68], [0.072, 0.74], [0.030, 0.78], [0.000, 0.80],
  ].map(p => new V2(p[0], p[1]));
  return new THREE.LatheGeometry(profile, 10);
}

/* Cardamom pod: an ellipsoid pinched at the ends. */
function makeCardamomGeometry(){
  const g = new THREE.SphereGeometry(0.5, 14, 10);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++){
    v.fromBufferAttribute(pos, i);
    const taper = 1 - Math.pow(Math.abs(v.y) * 2, 2.4) * 0.62;
    const ridges = 1 + Math.sin(Math.atan2(v.z, v.x) * 5) * 0.055;
    pos.setXYZ(i, v.x * 0.30 * taper * ridges, v.y * 0.60, v.z * 0.30 * taper * ridges);
  }
  g.computeVertexNormals();
  return g;
}

/* Black peppercorn: a dimpled sphere. */
function makePepperGeometry(){
  const g = new THREE.SphereGeometry(0.5, 12, 9);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++){
    v.fromBufferAttribute(pos, i);
    const n = Math.sin(v.x * 34) * Math.cos(v.y * 31) * Math.sin(v.z * 37);
    const s = 0.115 * (1 + n * 0.22);
    pos.setXYZ(i, v.x * s * 2, v.y * s * 2, v.z * s * 2);
  }
  g.computeVertexNormals();
  return g;
}

/* ══════════════════════════════════════════════════════════════════════
   MATERIAL HELPERS
   ══════════════════════════════════════════════════════════════════ */

/* aPhase must exist for every vertex, so a non-instanced mesh gets a
   constant-per-vertex array while an InstancedMesh gets one per instance. */
function setPhase(geo, value, instanced = false){
  if (instanced){
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(new Float32Array([value]), 1));
  } else {
    const n = geo.attributes.position.count;
    geo.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(n).fill(value), 1));
  }
  return geo;
}

/* Injects a per-instance float attribute + shared time into any material. */
function addInstanceMotion(material, { bob = 0.14, spin = 0.12, tilt = 0.06 } = {}){
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.uniforms.uBob = { value: bob };
    shader.uniforms.uSpin = { value: spin };
    shader.uniforms.uTilt = { value: tilt };

    shader.vertexShader = shader.vertexShader
      .replace('void main() {', `
        attribute float aPhase;
        uniform float uTime;
        uniform float uBob;
        uniform float uSpin;
        uniform float uTilt;
        mat2 rot2(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
        void main() {
      `)
      .replace('#include <begin_vertex>', `
        #include <begin_vertex>
        float ph = aPhase * 6.2831853;
        transformed.xz = rot2(uTime * uSpin + ph) * transformed.xz;
        transformed.y += sin(uTime * 0.62 + ph * 2.4) * uBob;
        transformed.x += sin(uTime * 0.44 + ph * 1.7) * uBob * 0.8;
        transformed.z += cos(uTime * 0.51 + ph * 2.1) * uBob * 0.8;
        transformed.xz = rot2(sin(uTime * 0.3 + ph) * uTilt) * transformed.xz;
      `);
  };
  material.customProgramCacheKey = () => `motion_${bob}_${spin}_${tilt}`;
  return material;
}

/* Speckled clay: handmade terracotta, never uniform. */
function clayMaterial(color, roughness = 0.88){
  const m = new THREE.MeshStandardMaterial({
    color, roughness, metalness: 0.0,
    flatShading: false, side: THREE.DoubleSide,
  });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = 'varying vec3 vLPos;\n' + shader.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vLPos = position;');
    shader.fragmentShader = `
      varying vec3 vLPos;
      float h31(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
    ` + shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      // three scales of variation: fine grog, medium mottling, broad kiln patches
      float gFine = h31(floor(vLPos * 190.0));
      float gMid  = h31(floor(vLPos * 26.0));
      float gWide = h31(floor(vLPos * 6.0));
      diffuseColor.rgb *= 0.80 + gFine * 0.26;
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.16, 1.02, 0.86), gMid * 0.80);
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.86, 0.93, 1.02), gWide * 0.55);
      // form: the foot of the cup sits in its own shadow
      diffuseColor.rgb *= 0.78 + smoothstep(0.0, 0.95, vLPos.y) * 0.32;
      // the incised groove a potter's thumb leaves just under the rim
      float groove = smoothstep(0.842, 0.856, vLPos.y) * (1.0 - smoothstep(0.872, 0.886, vLPos.y));
      diffuseColor.rgb *= 1.0 - groove * 0.34;
    `);
  };
  return m;
}

/* Rough wood for the slab the kettle sits on. */
function woodMaterial(){
  const m = new THREE.MeshStandardMaterial({ color: C.wood, roughness: 0.94, metalness: 0.02 });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = 'varying vec3 vLPos;\n' + shader.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vLPos = position;');
    shader.fragmentShader = `
      varying vec3 vLPos;
      float h31(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
      float vnoise(vec3 p){
        vec3 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float n000 = h31(i), n100 = h31(i + vec3(1,0,0));
        float n010 = h31(i + vec3(0,1,0)), n110 = h31(i + vec3(1,1,0));
        float n001 = h31(i + vec3(0,0,1)), n101 = h31(i + vec3(1,0,1));
        float n011 = h31(i + vec3(0,1,1)), n111 = h31(i + vec3(1,1,1));
        return mix(mix(mix(n000,n100,f.x), mix(n010,n110,f.x), f.y),
                   mix(mix(n001,n101,f.x), mix(n011,n111,f.x), f.y), f.z);
      }
    ` + shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      float rings = vnoise(vec3(vLPos.x * 3.4, vLPos.y * 46.0, vLPos.z * 3.4));
      float knots = vnoise(vLPos * 9.0);
      diffuseColor.rgb *= 0.72 + rings * 0.55;
      diffuseColor.rgb *= 0.86 + knots * 0.28;
    `);
  };
  return m;
}

/* ══════════════════════════════════════════════════════════════════════
   SHADERS
   ══════════════════════════════════════════════════════════════════ */

const LIQUID_VERT = /* glsl */`
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vPos;
  void main(){
    vUv = uv;
    vec3 p = position;
    float r = length(p.xy);
    p.z += sin(r * 26.0 - uTime * 2.4) * 0.012 * (1.0 - r * 0.5);
    p.z += cos(r * 12.0 + uTime * 1.5) * 0.008;
    vPos = p;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const LIQUID_FRAG = /* glsl */`
  uniform float uTime;
  uniform vec3 uDeep;
  uniform vec3 uLight;
  uniform vec3 uFoam;
  varying vec2 vUv;
  varying vec3 vPos;

  float h21(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
  float vnoise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1,0)), f.x),
               mix(h21(i + vec2(0,1)), h21(i + vec2(1,1)), f.x), f.y);
  }

  void main(){
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;

    // slow swirling chai surface
    float swirl = vnoise(p * 3.4 + vec2(uTime * 0.09, -uTime * 0.07));
    swirl += vnoise(p * 7.1 - vec2(uTime * 0.05)) * 0.5;
    swirl /= 1.5;

    float depth = smoothstep(1.0, 0.0, r);
    vec3 col = mix(uDeep, uLight, clamp(depth * 0.72 + swirl * 0.34, 0.0, 1.0));

    // concentric ripples travelling outward
    float rings = sin(r * 34.0 - uTime * 2.6) * 0.5 + 0.5;
    col += rings * 0.045 * smoothstep(1.0, 0.25, r);

    // milk foam crown clinging to the rim
    float foam = smoothstep(0.80, 0.99, r) * (1.0 - smoothstep(0.985, 1.0, r));
    foam *= 0.7 + swirl * 0.6;
    col = mix(col, uFoam, clamp(foam * 1.25, 0.0, 1.0));

    // specular sheen from the lamp
    float sheen = pow(max(0.0, 1.0 - r), 5.0);
    col += sheen * 0.16;

    gl_FragColor = vec4(col, 1.0);
  }
`;

const PARTICLE_VERT = /* glsl */`
  attribute float aPhase;
  attribute float aScale;
  attribute float aSpeed;
  uniform float uTime;
  uniform float uRise;
  uniform float uSpread;
  uniform float uSwirl;
  uniform float uSize;
  uniform float uFadeIn;
  uniform float uFadeOut;
  varying float vAlpha;
  varying float vSeed;

  void main(){
    float t = fract(uTime * aSpeed + aPhase);
    vec3 p = position;

    float rise = t * uRise;
    float a = aPhase * 6.2831853 + t * uSwirl;
    float spread = uSpread * (0.10 + t * 0.92);
    p.x += cos(a) * spread;
    p.z += sin(a * 0.86) * spread;
    p.y += rise + sin(a * 1.9) * 0.06;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;

    float size = aScale * (1.0 + t * 2.6) * uSize;
    gl_PointSize = size * (320.0 / max(0.001, -mv.z));

    vAlpha = smoothstep(0.0, uFadeIn, t) * (1.0 - smoothstep(uFadeOut, 1.0, t));
    vSeed = aPhase;
  }
`;

const PARTICLE_FRAG = /* glsl */`
  uniform vec3 uColor;
  uniform float uIntensity;
  varying float vAlpha;
  varying float vSeed;

  void main(){
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.0, d);
    a = pow(a, 1.7);
    vec3 col = uColor * (0.82 + vSeed * 0.36);
    gl_FragColor = vec4(col, a * vAlpha * uIntensity);
  }
`;

const GROUND_VERT = /* glsl */`
  varying vec2 vUv;
  void main(){
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const GROUND_FRAG = /* glsl */`
  uniform float uTime;
  uniform vec3 uInner;
  uniform vec3 uOuter;
  varying vec2 vUv;

  float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1,0)), f.x),
               mix(h21(i + vec2(0,1)), h21(i + vec2(1,1)), f.x), f.y);
  }

  void main(){
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    float pool = smoothstep(0.62, 0.0, r);          // lamp pool of light
    float grain = vnoise(p * 90.0) * 0.5 + vnoise(p * 26.0) * 0.5;

    vec3 col = mix(uOuter, uInner, pool);
    col *= 0.80 + grain * 0.42;

    float alpha = (1.0 - smoothstep(0.16, 0.94, r)) * (0.18 + pool * 0.46);
    gl_FragColor = vec4(col, alpha);
  }
`;

const BACKDROP_VERT = /* glsl */`
  varying vec3 vDir;
  void main(){
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const BACKDROP_FRAG = /* glsl */`
  uniform float uTime;
  uniform vec3 uTop;
  uniform vec3 uBottom;
  uniform vec3 uWarm;
  varying vec3 vDir;

  float h31(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
  float vnoise(vec3 p){
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x),
                  mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y);
    float b = mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x),
                  mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y);
    return mix(a, b, f.z);
  }

  void main(){
    vec3 d = normalize(vDir);
    float h = d.y * 0.5 + 0.5;
    vec3 col = mix(uBottom, uTop, smoothstep(0.05, 0.95, h));

    // warm haze low on the horizon, like a kerosene lamp through smoke
    float haze = smoothstep(0.62, 0.06, abs(d.y)) * smoothstep(0.2, 1.0, d.z * 0.5 + 0.5);
    col += uWarm * haze * 0.26;

    // slow drifting smoke
    vec3 q = d * 2.6 + vec3(uTime * 0.018, uTime * 0.011, 0.0);
    float smoke = vnoise(q) * 0.6 + vnoise(q * 2.4) * 0.4;
    col += uWarm * smoke * 0.055;

    // subtle dither to kill banding
    col += (h31(d * 900.0) - 0.5) * 0.008;

    gl_FragColor = vec4(col, 1.0);
  }
`;

const POUR_VERT = /* glsl */`
  varying vec2 vUv;
  varying vec3 vPos;
  void main(){
    vUv = uv;
    vPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const POUR_FRAG = /* glsl */`
  uniform float uTime;
  uniform float uAlpha;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  varying vec2 vUv;
  varying vec3 vPos;

  float h21(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
  float vnoise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1,0)), f.x),
               mix(h21(i + vec2(0,1)), h21(i + vec2(1,1)), f.x), f.y);
  }

  void main(){
    float flow = vUv.y * 3.0 - uTime * 1.9;
    float streak = vnoise(vec2(vUv.x * 9.0, flow)) * 0.6 + vnoise(vec2(vUv.x * 22.0, flow * 1.6)) * 0.4;
    vec3 col = mix(uColorA, uColorB, streak);
    col += pow(streak, 3.0) * 0.5;

    float edge = smoothstep(0.0, 0.22, vUv.x) * smoothstep(1.0, 0.78, vUv.x);
    float ends = smoothstep(0.0, 0.10, vUv.y) * smoothstep(1.0, 0.72, vUv.y);
    gl_FragColor = vec4(col, edge * ends * 0.92 * uAlpha);
  }
`;

const GRADE_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uTime:    { value: 0 },
    uRes:     { value: new THREE.Vector2(1, 1) },
    uAberr:   { value: 0.0022 },
    uGrain:   { value: 0.030 },
    uVig:     { value: 1.0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec2 uRes;
    uniform float uAberr;
    uniform float uGrain;
    uniform float uVig;
    varying vec2 vUv;

    float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

    void main(){
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float r2 = dot(c, c);

      // lens: chromatic aberration that grows toward the corners
      float amt = uAberr * (0.35 + r2 * 4.2);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + c * amt).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - c * amt).b;

      // warm lift in the shadows, cool down the highlights
      col = mix(col, col * vec3(1.07, 0.975, 0.90), 0.65);
      col = mix(col, col * vec3(0.985, 0.995, 1.03), smoothstep(0.55, 1.0, dot(col, vec3(0.333))));

      // vignette
      float vig = smoothstep(1.15, 0.22, r2 * 2.05);
      col *= mix(1.0 - 0.42 * uVig, 1.0, vig);

      // animated film grain
      float g = h21(uv * uRes * 0.62 + fract(uTime * 1.7) * 143.0);
      col += (g - 0.5) * uGrain;

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

/* ══════════════════════════════════════════════════════════════════════
   BUILDERS
   ══════════════════════════════════════════════════════════════════ */

function makeSteamMaterial(color, intensity, count, opts = {}){
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime:      uTime,
      uColor:     { value: new THREE.Color(color) },
      uIntensity: { value: intensity },
      uRise:      { value: opts.rise ?? 2.8 },
      uSpread:    { value: opts.spread ?? 0.55 },
      uSwirl:     { value: opts.swirl ?? 4.2 },
      uSize:      { value: opts.size ?? 0.55 },
      uFadeIn:    { value: opts.fadeIn ?? 0.10 },
      uFadeOut:   { value: opts.fadeOut ?? 0.42 },
    },
    vertexShader: PARTICLE_VERT,
    fragmentShader: PARTICLE_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

function makeParticles({ count, radius, yMin, yMax, radiusJitter, speedRange, scaleRange, material }){
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const phase = new Float32Array(count);
  const scale = new Float32Array(count);
  const speed = new Float32Array(count);

  for (let i = 0; i < count; i++){
    const a = Math.random() * Math.PI * 2;
    const r = radius + (Math.random() - 0.5) * radiusJitter;
    pos[i * 3 + 0] = Math.cos(a) * r;
    pos[i * 3 + 1] = rand(yMin, yMax);
    pos[i * 3 + 2] = Math.sin(a) * r;
    phase[i] = Math.random();
    scale[i] = rand(scaleRange[0], scaleRange[1]);
    speed[i] = rand(speedRange[0], speedRange[1]);
  }

  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aPhase',   new THREE.BufferAttribute(phase, 1));
  geo.setAttribute('aScale',   new THREE.BufferAttribute(scale, 1));
  geo.setAttribute('aSpeed',   new THREE.BufferAttribute(speed, 1));

  return new THREE.Points(geo, material);
}

function makeLiquidMesh(radius, y, colors){
  const geo = new THREE.CircleGeometry(radius, 96);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime:  uTime,
      uDeep:  { value: new THREE.Color(colors.deep) },
      uLight: { value: new THREE.Color(colors.light) },
      uFoam:  { value: new THREE.Color(colors.foam) },
    },
    vertexShader: LIQUID_VERT,
    fragmentShader: LIQUID_FRAG,
    side: THREE.DoubleSide,
    transparent: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;
  return mesh;
}

/* ══════════════════════════════════════════════════════════════════════
   MAIN WORLD
   ══════════════════════════════════════════════════════════════════ */

export function createWorld({ canvas, stages = [] }){
  /* ── renderer ───────────────────────────────────────────────────── */
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.setClearColor(INK_CLEAR, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.autoClear = true;

  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(dpr);

  /* ── scene ──────────────────────────────────────────────────────── */
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(C.ink, 0.042);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 240);
  camera.position.set(0, 1.05, 4.4);

  /* ── backdrop ───────────────────────────────────────────────────── */
  const backdrop = new THREE.Mesh(
    new THREE.SphereGeometry(90, 40, 26),
    new THREE.ShaderMaterial({
      uniforms: {
        uTime:   uTime,
        uTop:    { value: new THREE.Color(0x1B1208) },
        uBottom: { value: new THREE.Color(0x050302) },
        uWarm:   { value: new THREE.Color(0xC1622F) },
      },
      vertexShader: BACKDROP_VERT,
      fragmentShader: BACKDROP_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    })
  );
  backdrop.frustumCulled = false;
  scene.add(backdrop);

  /* ── ground ─────────────────────────────────────────────────────── */
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(34, 72),
    new THREE.ShaderMaterial({
      uniforms: {
        uTime:   uTime,
        uInner:  { value: new THREE.Color(0x33200E) },
        uOuter:  { value: new THREE.Color(0x0A0705) },
      },
      vertexShader: GROUND_VERT,
      fragmentShader: GROUND_FRAG,
      transparent: true,
      depthWrite: false,
      fog: false,
    })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.34;
  scene.add(ground);

  /* ── the slab ───────────────────────────────────────────────────── */
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(7.2, 0.30, 4.8, 1, 1, 1),
    woodMaterial()
  );
  slab.position.y = -0.152;
  scene.add(slab);

  const slabEdge = new THREE.Mesh(
    new THREE.BoxGeometry(7.34, 0.06, 4.94),
    new THREE.MeshStandardMaterial({ color: 0x3A2413, roughness: 0.8, metalness: 0.05 })
  );
  slabEdge.position.y = -0.325;
  scene.add(slabEdge);

  /* ── the kulhad ─────────────────────────────────────────────────── */
  const cupGroup = new THREE.Group();
  scene.add(cupGroup);

  const cupGeo = makeKulhadGeometry();
  const cup = new THREE.Mesh(cupGeo, clayMaterial(0x8A4E2E, 0.96));
  cupGroup.add(cup);

  /* rim light-catcher: a thin glowing lip */
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.505, 0.0075, 8, 96),
    new THREE.MeshBasicMaterial({ color: 0xF0B464, transparent: true, opacity: 0.55 })
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 1.002;
  cupGroup.add(rim);

  const liquid = makeLiquidMesh(LIQUID_R, 0.872, {
    deep: 0x6B3410, light: 0xC98A3A, foam: 0xE8D2AE,
  });
  cupGroup.add(liquid);

  scene.add(makeContactShadow(2.1, 0.004));

  /* ── steam ──────────────────────────────────────────────────────── */
  const steam = makeParticles({
    count: 460, radius: 0.24, yMin: 0.9, yMax: 1.0, radiusJitter: 0.42,
    speedRange: [0.055, 0.13], scaleRange: [0.34, 0.92],
    material: makeSteamMaterial(0xF6DCB4, 0.055, 460, {
      rise: 2.4, spread: 0.95, swirl: 4.6, size: 0.62, fadeIn: 0.06, fadeOut: 0.30,
    }),
  });
  cupGroup.add(steam);

  const steamWide = makeParticles({
    count: 220, radius: 0.45, yMin: 1.0, yMax: 1.15, radiusJitter: 1.0,
    speedRange: [0.03, 0.07], scaleRange: [0.7, 1.8],
    material: makeSteamMaterial(0xD8A46A, 0.028, 220, {
      rise: 3.6, spread: 2.0, swirl: 2.6, size: 0.95, fadeIn: 0.12, fadeOut: 0.44,
    }),
  });
  cupGroup.add(steamWide);

  /* ── dust motes drifting through the light ──────────────────────── */
  const dust = makeParticles({
    count: 300, radius: 5.4, yMin: -0.2, yMax: 4.6, radiusJitter: 7.2,
    speedRange: [0.012, 0.035], scaleRange: [0.16, 0.52],
    material: makeSteamMaterial(0xE8B877, 0.28, 300, {
      rise: 1.4, spread: 0.4, swirl: 1.1, size: 0.5, fadeIn: 0.25, fadeOut: 0.75,
    }),
  });
  scene.add(dust);

  /* ── the pour ───────────────────────────────────────────────────── */
  const pourCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(1.25, 3.05, 0.35),
    new THREE.Vector3(1.05, 2.35, 0.28),
    new THREE.Vector3(0.62, 1.70, 0.16),
    new THREE.Vector3(0.22, 1.22, 0.05),
    new THREE.Vector3(0.02, 0.94, 0.0),
  ]);
  const pour = new THREE.Mesh(
    new THREE.TubeGeometry(pourCurve, 80, 0.042, 10, false),
    new THREE.ShaderMaterial({
      uniforms: {
        uTime:   uTime,
        uAlpha:  { value: 0 },
        uColorA: { value: new THREE.Color(0x8A4A1C) },
        uColorB: { value: new THREE.Color(0xF5C169) },
      },
      vertexShader: POUR_VERT,
      fragmentShader: POUR_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    })
  );
  pour.visible = false;
  scene.add(pour);

  /* ── the lamp (motivates the key light) ─────────────────────────── */
  const lampGroup = new THREE.Group();
  lampGroup.position.set(2.35, 3.5, 1.15);
  scene.add(lampGroup);

  const lampShade = new THREE.Mesh(
    new THREE.ConeGeometry(0.34, 0.42, 20, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x2C1B10, roughness: 0.55, metalness: 0.4, side: THREE.DoubleSide })
  );
  lampShade.position.y = 0.24;
  lampGroup.add(lampShade);

  const lampBulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.085, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xFFD9A0 })
  );
  lampGroup.add(lampBulb);

  const lampHalo = new THREE.Sprite(new THREE.SpriteMaterial({
    color: 0xFFB65C, transparent: true, opacity: 0.22,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  lampHalo.scale.setScalar(1.05);
  lampGroup.add(lampHalo);

  const lampCord = new THREE.Mesh(
    new THREE.CylinderGeometry(0.006, 0.006, 6, 6),
    new THREE.MeshBasicMaterial({ color: 0x1A120C })
  );
  lampCord.position.y = 3.2;
  lampGroup.add(lampCord);

  /* ── lights ─────────────────────────────────────────────────────── */
  scene.add(new THREE.HemisphereLight(0xE8A33D, 0x080503, 0.42));

  const keyLight = new THREE.PointLight(0xFFC98A, 18, 18, 2);
  keyLight.position.set(2.35, 3.25, 1.15);
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0xFF9A4D, 1.35);
  rimLight.position.set(-3.2, 2.6, -3.4);
  scene.add(rimLight);

  const fillLight = new THREE.PointLight(0x5C7FA8, 9, 16, 2);
  fillLight.position.set(-3.1, 1.4, -2.2);
  scene.add(fillLight);

  /* a soft glow inside the cup mouth so the tea reads as lit from within */
  const cupGlow = new THREE.PointLight(0xE8A33D, 0.55, 2.2, 2);
  cupGlow.position.set(0, 1.55, 0);
  scene.add(cupGlow);

  /* ── spices: instanced, GPU-animated ────────────────────────────── */
  const spiceGroup = new THREE.Group();
  scene.add(spiceGroup);

  /* Scales are set so the spices keep realistic proportions to the 1-unit
     kulhad — a cardamom pod really is about a fifth of a cup's height. */
  const spiceDefs = [
    { geo: makeCardamomGeometry(), color: 0x8B9A55, count: 42, s: [0.28, 0.52], motion: { bob: 0.16, spin: 0.14 } },
    { geo: makeStarAniseGeometry(), color: 0x4E2C13, count: 26, s: [0.30, 0.58], motion: { bob: 0.13, spin: 0.10 } },
    { geo: makeCinnamonGeometry(),  color: 0x8B5A2B, count: 22, s: [0.55, 0.95], motion: { bob: 0.11, spin: 0.16 } },
    { geo: makeLeafGeometry(),      color: 0x4C6B2C, count: 36, s: [0.45, 0.85], motion: { bob: 0.19, spin: 0.22 } },
    { geo: makeCloveGeometry(),     color: 0x3A2416, count: 32, s: [0.24, 0.46], motion: { bob: 0.14, spin: 0.12 } },
    { geo: makePepperGeometry(),    color: 0x2E241C, count: 38, s: [0.26, 0.55], motion: { bob: 0.17, spin: 0.18 } },
  ];

  const spiceMeshes = [];
  const dummy = new THREE.Object3D();

  for (const def of spiceDefs){
    const mat = new THREE.MeshStandardMaterial({
      color: def.color, roughness: 0.74, metalness: 0.04, side: THREE.DoubleSide,
    });
    addInstanceMotion(mat, def.motion);

    const mesh = new THREE.InstancedMesh(def.geo, mat, def.count);
    const phases = new Float32Array(def.count);

    for (let i = 0; i < def.count; i++){
      // a loose shell around the cup, biased inward, never inside the cup
      const r = 2.05 + Math.pow(Math.random(), 0.72) * 4.35;
      const a = Math.random() * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const y = rand(-0.15, 3.25);

      const s = rand(def.s[0], def.s[1]);
      dummy.position.set(x, y, z);
      dummy.rotation.set(rand(0, Math.PI * 2), rand(0, Math.PI * 2), rand(0, Math.PI * 2));
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      phases[i] = Math.random();
    }

    def.geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    spiceGroup.add(mesh);
    spiceMeshes.push(mesh);
  }

  /* ── a few foreground spices that frame the cup without blocking it ── */
  const heroSpices = new THREE.Group();
  scene.add(heroSpices);
  const heroDefs = [
    { geo: makeStarAniseGeometry(), color: 0x4E2C13, pos: [-2.15, 1.05, 2.45], s: 0.55 },
    { geo: makeCardamomGeometry(),  color: 0x8B9A55, pos: [ 2.35, 0.55, 2.20], s: 0.60 },
    { geo: makeLeafGeometry(),      color: 0x4C6B2C, pos: [-1.85, 2.15, 1.75], s: 0.75 },
    { geo: makeCinnamonGeometry(),  color: 0x8B5A2B, pos: [ 2.05, 2.35, 1.60], s: 0.85 },
  ];
  heroDefs.forEach((d, i) => {
    const m = new THREE.Mesh(d.geo, addInstanceMotion(
      new THREE.MeshStandardMaterial({ color: d.color, roughness: 0.72, side: THREE.DoubleSide }),
      { bob: 0.20, spin: 0.09, tilt: 0.08 }
    ));
    setPhase(m.geometry, i * 0.27, false);
    m.position.fromArray(d.pos);
    m.scale.setScalar(d.s);
    m.userData.base = m.position.clone();
    m.userData.ph = i * 1.7;
    heroSpices.add(m);
  });

  /* ══════════════════════════════════════════════════════════════════
     PRODUCT MINI-SCENES (rendered through DOM "portholes")
     ══════════════════════════════════════════════════════════════════ */
  const miniScene = new THREE.Scene();
  // a Color background makes three clear the scissor region for us (colour +
  // depth), with the correct output-colour-space conversion
  miniScene.background = PANEL_CLEAR;
  const miniCamera = new THREE.PerspectiveCamera(36, 1, 0.1, 60);

  miniScene.add(new THREE.HemisphereLight(0xE8A33D, 0x0A0705, 0.22));

  const miniKey = new THREE.PointLight(0xFFC98A, 4.5, 12, 2);
  miniKey.position.set(1.5, 2.3, 1.7);
  miniScene.add(miniKey);

  const miniRim = new THREE.DirectionalLight(0xFF8A3D, 0.70);
  miniRim.position.set(-2.2, 1.6, -2.0);
  miniScene.add(miniRim);

  const miniFill = new THREE.PointLight(0x6C90BC, 3.5, 10, 2);
  miniFill.position.set(-2.0, 0.9, 1.4);
  miniScene.add(miniFill);

  const miniMiniatures = [];
  const productDefs = [
    { liquid: { deep: 0x5A2A0C, light: 0xB87A2E, foam: 0xE8D2AE }, clay: 0x7A4526, spice: 0, spin: 0.30, tilt: 0.10 },
    { liquid: { deep: 0x7A4A16, light: 0xD9A34E, foam: 0xF0E2C6 }, clay: 0x6E3E22, spice: 1, spin: 0.18, tilt: 0.07 },
    { liquid: { deep: 0x6B2F08, light: 0xC98A3A, foam: 0xE4CBA2 }, clay: 0x86502E, spice: 4, spin: 0.36, tilt: 0.13 },
    { liquid: { deep: 0x4A2208, light: 0xA86A22, foam: 0xDCC49A }, clay: 0x6A3A1E, spice: 5, spin: 0.26, tilt: 0.09 },
    { liquid: { deep: 0x8A5218, light: 0xE8B65C, foam: 0xF3E6D0 }, clay: 0x7A4526, spice: 1, spin: 0.22, tilt: 0.08 },
    { liquid: { deep: 0x3A1A06, light: 0x8A4A1C, foam: 0xB08A55 }, clay: 0x734024, spice: 2, spin: 0.34, tilt: 0.12 },
  ];

  productDefs.forEach((def, i) => {
    const g = new THREE.Group();

    const cupMesh = new THREE.Mesh(cupGeo, clayMaterial(def.clay, 0.94));
    g.add(cupMesh);
    g.add(makeContactShadow(1.9, 0.004));

    const liq = makeLiquidMesh(LIQUID_R, 0.872, def.liquid);
    g.add(liq);

    // one spice drifting above the cup — its own geometry clone, because the
    // shared one carries per-instance data sized for the instanced field
    const sd = spiceDefs[def.spice];
    const sp = new THREE.Mesh(sd.geo.clone(), addInstanceMotion(
      new THREE.MeshStandardMaterial({ color: sd.color, roughness: 0.7, side: THREE.DoubleSide }),
      { bob: 0.14, spin: def.spin, tilt: def.tilt }
    ));
    setPhase(sp.geometry, i * 0.19, false);
    sp.position.set(0.58, 1.20, 0.18);
    sp.scale.setScalar(0.85);
    g.add(sp);

    g.visible = false;
    miniScene.add(g);
    miniMiniatures.push(g);
  });

  /* ══════════════════════════════════════════════════════════════════
     POST-PROCESSING
     ══════════════════════════════════════════════════════════════════ */
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(dpr);

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.46, 0.50, 0.84);
  composer.addPass(bloom);

  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  const gradePass = new ShaderPass(GRADE_SHADER);
  gradePass.renderToScreen = true;
  composer.addPass(gradePass);

  /* ══════════════════════════════════════════════════════════════════
     CAMERA JOURNEY
     ══════════════════════════════════════════════════════════════════ */
  const camPath = new THREE.CatmullRomCurve3([
    new THREE.Vector3( 0.00, 0.96, 3.45),   // 0.00 hero — the cup
    new THREE.Vector3( 0.55, 1.42, 5.10),   // 0.10
    new THREE.Vector3( 2.05, 1.95, 5.90),   // 0.22 story — pull back
    new THREE.Vector3( 3.55, 1.30, 4.55),   // 0.34 story — orbit
    new THREE.Vector3( 2.10, 2.55, 7.60),   // 0.46
    new THREE.Vector3(-1.10, 2.95, 9.40),   // 0.56 menu — wide
    new THREE.Vector3(-3.10, 1.05, 6.30),   // 0.68 process — dive
    new THREE.Vector3(-1.85, 0.42, 3.30),   // 0.76 process — low
    new THREE.Vector3( 0.95, 1.85, 5.60),   // 0.86 voices
    new THREE.Vector3( 0.30, 1.55, 4.60),   // 0.94
    new THREE.Vector3( 0.00, 1.30, 4.00),   // 1.00 footer
  ], false, 'catmullrom', 0.35);

  const lookPath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.00, 0.62, 0.00),
    new THREE.Vector3(0.05, 0.70, 0.00),
    new THREE.Vector3(0.10, 0.95, 0.00),
    new THREE.Vector3(0.00, 1.10, 0.00),
    new THREE.Vector3(0.00, 1.30, 0.00),
    new THREE.Vector3(0.00, 1.55, 0.00),
    new THREE.Vector3(-0.30, 1.10, 0.00),
    new THREE.Vector3(-0.10, 0.85, 0.00),
    new THREE.Vector3(0.15, 1.05, 0.00),
    new THREE.Vector3(0.05, 0.90, 0.00),
    new THREE.Vector3(0.00, 0.80, 0.00),
  ], false, 'catmullrom', 0.35);

  const camPos    = new THREE.Vector3().copy(camPath.getPointAt(0));
  const camTarget = new THREE.Vector3().copy(lookPath.getPointAt(0));
  const tmpPos    = new THREE.Vector3();
  const tmpLook   = new THREE.Vector3();
  const smoothLook = new THREE.Vector3().copy(camTarget);

  /* ══════════════════════════════════════════════════════════════════
     RESIZE
     ══════════════════════════════════════════════════════════════════ */
  let W = 1, H = 1;

  function resize(){
    W = window.innerWidth;
    H = window.innerHeight;
    renderer.setSize(W, H, false);
    composer.setSize(W, H);
    bloom.setSize(W, H);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    gradePass.uniforms.uRes.value.set(W, H);
    gradePass.uniforms.uVig.value = W < 700 ? 0.55 : 1.0;
  }
  resize();

  /* ══════════════════════════════════════════════════════════════════
     UPDATE
     ══════════════════════════════════════════════════════════════════ */
  let elapsed = 0;
  let frameCount = 0;
  let fpsAccum = 0;
  let fpsSamples = 0;
  let downgraded = false;

  function update(dt, state){
    elapsed += dt;
    uTime.value = elapsed;

    const p = clamp(state.progress, 0, 1);
    const mp = clamp(state.smoothProgress ?? p, 0, 1);

    /* — camera along the path, with mouse parallax — */
    camPath.getPointAt(mp, tmpPos);
    lookPath.getPointAt(mp, tmpLook);

    const mx = state.mouse.x;
    const my = state.mouse.y;
    const par = 0.34 + mp * 0.24;

    tmpPos.x += mx * par;
    tmpPos.y += -my * par * 0.72;
    tmpPos.z += Math.abs(mx) * 0.10;
    tmpLook.x += mx * 0.16;
    tmpLook.y += -my * 0.12;

    const follow = 1 - Math.pow(0.0016, dt);
    camPos.lerp(tmpPos, follow);
    smoothLook.lerp(tmpLook, follow);

    // breathing handheld float
    camera.position.copy(camPos);
    camera.position.y += Math.sin(elapsed * 0.55) * 0.026;
    camera.position.x += Math.cos(elapsed * 0.41) * 0.020;
    camera.lookAt(smoothLook);

    // subtle roll driven by scroll velocity
    camera.rotation.z += clamp((state.velocity || 0) * 0.006, -0.05, 0.05);

    /* — lamp flicker — */
    const flick = 0.86
      + Math.sin(elapsed * 11.3) * 0.05
      + Math.sin(elapsed * 27.7) * 0.035
      + Math.sin(elapsed * 3.1) * 0.05;
    keyLight.intensity = 18 * flick;
    lampBulb.material.color.setRGB(1, 0.82 * flick, 0.58 * flick);
    lampHalo.material.opacity = 0.18 * flick;
    lampHalo.scale.setScalar(1.05 + flick * 0.14);
    cupGlow.intensity = 0.55 * flick;

    /* — cup: slow drift + a nod toward the camera — */
    cupGroup.rotation.y = Math.sin(elapsed * 0.16) * 0.14 + mx * 0.10;
    cupGroup.position.y = Math.sin(elapsed * 0.5) * 0.018;
    rim.material.opacity = 0.42 + flick * 0.22;

    /* — steam reacts to where you are on the page — */
    const sMat = steam.material.uniforms;
    const sMatW = steamWide.material.uniforms;
    const chapterHeat = state.chapter === 1 ? 1.0 : 0.62;
    sMat.uIntensity.value = (0.055 + chapterHeat * 0.055) * flick;
    sMatW.uIntensity.value = (0.018 + chapterHeat * 0.018) * flick;
    sMat.uSpread.value = 0.92 + Math.sin(elapsed * 0.4) * 0.08;
    dust.material.uniforms.uIntensity.value = 0.16 + Math.sin(elapsed * 0.3) * 0.05;

    /* — the pour: only during "The Pull" — */
    const pourIn = clamp((p - 0.60) / 0.07, 0, 1) * clamp((0.80 - p) / 0.07, 0, 1);
    pour.visible = pourIn > 0.01;
    if (pour.visible) pour.material.uniforms.uAlpha.value = pourIn;

    /* — spice field: the whole cloud drifts and reacts to scroll — */
    spiceGroup.rotation.y = elapsed * 0.028 + mp * 1.5;
    spiceGroup.position.y = Math.sin(elapsed * 0.24) * 0.10;
    spiceGroup.scale.setScalar(0.94 + mp * 0.14);

    heroSpices.children.forEach((m) => {
      const b = m.userData.base;
      m.position.y = b.y + Math.sin(elapsed * 0.6 + m.userData.ph) * 0.07;
      m.position.x = b.x + Math.cos(elapsed * 0.44 + m.userData.ph) * 0.05;
      m.position.z = b.z + Math.sin(elapsed * 0.37 + m.userData.ph * 1.4) * 0.05;
    });

    /* — backdrop + grade react to the scroll — */
    backdrop.position.copy(camera.position);
    gradePass.uniforms.uTime.value = elapsed;
    gradePass.uniforms.uAberr.value = 0.0018 + Math.abs(state.velocity || 0) * 0.00004;
    bloom.strength = 0.40 + Math.sin(elapsed * 0.35) * 0.05 + (state.chapter === 1 ? 0.12 : 0);

    /* ══ product portholes ══════════════════════════════════════════ */
    renderer.autoClear = true;
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, W, H);
    renderer.setClearColor(INK_CLEAR, 1);
    composer.render();

    if (stages.length){
      // each porthole gets its own viewport + scissor, so the mini scene reads
      // as a window cut into the card
      renderer.autoClear = false;
      renderer.setScissorTest(true);

      for (let i = 0; i < stages.length; i++){
        const el = stages[i];
        const rect = el.getBoundingClientRect();
        if (rect.width < 4 || rect.height < 4) continue;
        if (rect.bottom < 0 || rect.top > H) continue;

        const x = rect.left;
        const y = H - rect.bottom;

        miniMiniatures.forEach((g, gi) => { g.visible = gi === i; });

        const hovered = state.hoveredCard === i;
        const spin = elapsed * 0.20 + i * 1.05;
        const R = 2.62 - (hovered ? 0.14 : 0);   // true orbit, so framing is stable
        miniCamera.position.set(
          Math.sin(spin) * R,
          1.06 + Math.sin(elapsed * 0.6 + i) * 0.04 + (hovered ? 0.05 : 0),
          Math.cos(spin) * R
        );
        miniCamera.lookAt(0, 0.60, 0);
        miniCamera.aspect = rect.width / rect.height;
        miniCamera.updateProjectionMatrix();

        miniKey.intensity = 4.5 * (hovered ? 1.22 : 1.0);
        miniRim.intensity = 0.70 * (hovered ? 1.30 : 1.0);

        renderer.setViewport(x, y, rect.width, rect.height);
        renderer.setScissor(x, y, rect.width, rect.height);
        renderer.render(miniScene, miniCamera);   // clears to PANEL_CLEAR, then draws
      }

      renderer.setScissorTest(false);
      renderer.autoClear = true;
    }

    /* — adaptive quality: back off once if the frame budget is blown — */
    if (!downgraded){
      fpsAccum += dt;
      fpsSamples++;
      frameCount++;
      if (frameCount === 90){
        const avg = fpsAccum / fpsSamples;
        if (avg > 1 / 42){
          dpr = Math.min(dpr, 1.25);
          renderer.setPixelRatio(dpr);
          composer.setPixelRatio(dpr);
          bloom.setSize(W, H);
          downgraded = true;
        }
      }
    }
  }

  function dispose(){
    renderer.dispose();
    composer.dispose?.();
  }

  return { update, resize, dispose, scene, camera, renderer };
}
