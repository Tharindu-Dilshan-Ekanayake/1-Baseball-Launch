import {
  BufferAttribute,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  ExtrudeGeometry,
  IcosahedronGeometry,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  OctahedronGeometry,
  Quaternion,
  Shape,
  Sphere,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import { glowTime } from './glow'

/**
 * Every bat in the bat shop (shared/balance.js TIRES - the ids are the template's tire
 * ids, kept for saves; names and stats live there): each its own procedural shape - a
 * classic wooden bat, a bamboo cane, a caveman's stone club, a cartoon femur, a riveted
 * copper bat, a spiked bat, a lollipop, an icicle-studded crystal, a gilded bat with a
 * ruby in its knob, a lava rock with glowing cracks, a lightning bolt, three cut gems, a
 * unicorn horn, a dragon's horned and spined club, a chrome-and-carbon cyber bat with
 * neon rings and an orb, an infinity bat circled by floating rings - painted by one GLSL
 * function (BAT_GLSL). No textures.
 *
 * Each bat is one merged geometry, built lazily the first time it's needed and shared.
 * Every vertex carries its paint: `aP` (where it is on the bat, metres, for the patterns),
 * `aLook` (which pattern, and how much it glows) and two sRGB colours `aCa` / `aCb` - so
 * every bat draws with one material and one program, and swapping bats is swapping a
 * geometry. The bat shop merges all twenty-four into a single mesh that turns each bat
 * on its stand in the vertex shader (createBatShowcase): one draw call.
 *
 * A bat's local frame: the hands' grip at the origin, the bat running along +Y - its
 * knob a little below the origin, its barrel's tip at about batLength(id) - and the
 * barrel's hitting face towards +Z. Units are metres (the avatar is 1.8 tall).
 */

/** The patterns BAT_GLSL paints (a vertex's `aLook.x`). */
export const BAT_LOOK = {
  PLAIN: 0,
  WOOD: 1,
  BAMBOO: 2,
  STONE: 3,
  BONE: 4,
  COPPER: 5,
  STEEL: 6,
  GLOSS: 7,
  METAL: 8,
  CHROME: 9,
  CANDY: 10,
  SWIRL: 11,
  ICE: 12,
  GOLD: 13,
  LAVA: 14,
  THUNDER: 15,
  GEM: 16,
  RAINBOW: 17,
  PASTEL: 18,
  GALAXY: 19,
  SCALES: 20,
  CARBON: 21,
  NEON: 22,
  PRISM: 23,
  GRIP: 24,
  LEATHER: 25,
}
const K = BAT_LOOK

/**
 * Per bat id: its base colour `a` (its stand's cap) and `trail` - the colour of its glow,
 * its stand's trim and anything else tinted by it. How each is shaped and painted is its
 * builder, below.
 */
export const BAT_STYLES = {
  bicycle: { a: '#e9c48e', trail: '#ffe2a8' },
  mountain: { a: '#a8642e', trail: '#ff8a5a' },
  wood: { a: '#c4dc6a', trail: '#b6ff6a' },
  stone: { a: '#9aa1aa', trail: '#d6dce6' },
  cookie: { a: '#f3ead2', trail: '#fff6dc' },
  pizza: { a: '#e07a3c', trail: '#ff9a5a' },
  donut: { a: '#c9d0da', trail: '#e8f0ff' },
  watermelon: { a: '#d4dae3', trail: '#7fb2ff' },
  monster: { a: '#4a3426', trail: '#ff4a4a' },
  mint: { a: '#ff5f9e', trail: '#ff9cd6' },
  silver: { a: '#eef2f8', trail: '#e8f0ff' },
  ice: { a: '#c9f1ff', trail: '#bff4ff' },
  gold: { a: '#ffc81a', trail: '#ffd21f' },
  lava: { a: '#2a0f0b', trail: '#ff5a1c' },
  platinum: { a: '#ffd21f', trail: '#7fe6ff' },
  emerald: { a: '#2bd17a', trail: '#7dffb0' },
  ruby: { a: '#ff3b5c', trail: '#ff7a90' },
  diamond: { a: '#bff0ff', trail: '#bff4ff' },
  rainbow: { a: '#ffffff', trail: '#ff7ad9' },
  unicorn: { a: '#ffb6e6', trail: '#ffb0f0' },
  galaxy: { a: '#120a2a', trail: '#a46bff' },
  dragon: { a: '#22a552', trail: '#4cff7a' },
  cosmic: { a: '#c9d2de', trail: '#3fd8ff' },
  infinity: { a: '#ffffff', trail: '#ffffff' },
}

// Parsed once: frame code looks colours up without allocating.
const PARSED = Object.fromEntries(Object.entries(BAT_STYLES).map(([id, s]) => [id, { a: new Color(s.a), trail: new Color(s.trail) }]))
const styleOf = (id) => PARSED[id] || PARSED.bicycle

/** The colour of bat `id`'s glow, trims and anything tinted by it. */
export const batTrail = (id) => styleOf(id).trail
/** Bat `id`'s base colour. */
export const batBase = (id) => styleOf(id).a

// --- The painter -------------------------------------------------------------------------

/**
 * The bat painter, in GLSL. `p` is where the fragment is on the bat (its local frame,
 * metres; on a few parts, like the lollipop's face, the part's own frame), `n` its
 * object-space normal (gem facets), `vn` its view-space normal (the shine: metals fake
 * their reflections from it, so they gleam even on the LOW preset), `look` the pattern,
 * `a` / `b` its two colours (linear), `glow` how much it lights itself, `t` a clock.
 * Writes the diffuse colour and the light it gives off.
 *
 * Kept cheap to compile as well as to run: the cell pattern (a 3x3 loop) and the two
 * noises are each evaluated once, at a scale picked by the look, and every look shades
 * from those.
 */
const BAT_GLSL = /* glsl */ `
  float bHash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float bNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(bHash(i), bHash(i + vec2(1.0, 0.0)), f.x), mix(bHash(i + vec2(0.0, 1.0)), bHash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  vec3 bCells(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float d1 = 8.0;
    float d2 = 8.0;
    float id = 0.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 g = vec2(float(x), float(y));
        vec2 o = vec2(bHash(i + g), bHash(i + g + 17.7));
        vec2 r = g + o - f;
        float d = dot(r, r);
        if (d < d1) { d2 = d1; d1 = d; id = bHash(i + g + 3.3); }
        else if (d < d2) { d2 = d; }
      }
    }
    return vec3(sqrt(d1), sqrt(d2), id);
  }
  vec3 bHue(float h) {
    return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  }
  void batPaint(vec3 p, vec3 n, vec3 vn, float look, vec3 a, vec3 b, float glow, float t, out vec3 col, out vec3 emit) {
    int k = int(look + 0.5);
    // Continuous over the whole surface (no seam round the back), stretched along the bat.
    vec2 q = vec2(p.x + p.z, p.y);
    float ang = atan(p.z, p.x + 1e-5);
    float turn = ang / 6.28318;
    // A studio light up and to the left of the camera, and the sky above: the shine.
    float spec = pow(max(0.0, dot(vn, vec3(-0.36, 0.56, 0.75))), 22.0);
    float rim = pow(1.0 - clamp(vn.z, 0.0, 1.0), 2.0);
    float sky = smoothstep(-0.15, 0.3, vn.y);
    bool cellular = k == ${K.STONE} || k == ${K.ICE} || k == ${K.LAVA} || k == ${K.PRISM};
    float cs = k == ${K.STONE} ? 16.0 : k == ${K.ICE} ? 13.0 : k == ${K.LAVA} ? 15.0 : 11.0;
    vec2 drift = k == ${K.LAVA} ? vec2(0.0, t * 0.05) : vec2(0.0);
    vec3 cl = cellular ? bCells(q * cs + drift) : vec3(1.0, 1.0, 0.0);
    float edge = cl.y - cl.x;
    vec2 ns = k == ${K.WOOD} ? vec2(45.0, 2.2) : k == ${K.STEEL} ? vec2(80.0, 1.5) : k == ${K.GALAXY} ? vec2(6.0) : k == ${K.PASTEL} ? vec2(4.0) : vec2(9.0);
    vec2 nd = k == ${K.LAVA} ? vec2(t * 0.4) : k == ${K.PASTEL} ? vec2(t * 0.1, 0.0) : vec2(0.0, t * 0.05);
    float n1 = bNoise(q * ns + nd);
    float n2 = bNoise(q * 23.0 + 7.0);
    col = a;
    emit = a * glow + vec3(spec * 0.2);
    if (k == ${K.WOOD}) {
      float ring = smoothstep(0.6, 0.95, bNoise(q * vec2(9.0, 0.7) + 3.0));
      col = mix(a, b, smoothstep(0.35, 0.8, n1) * 0.75 + ring * 0.25);
      emit = vec3(spec * 0.14);
    } else if (k == ${K.BAMBOO}) {
      float f = fract(p.y / 0.2);
      float dark = 1.0 - smoothstep(0.0, 0.12, min(f, 1.0 - f));
      col = mix(mix(a, b, bNoise(q * vec2(40.0, 2.0)) * 0.5), b * 0.7, dark * 0.6);
      emit = vec3(spec * 0.2);
    } else if (k == ${K.STONE}) {
      col = mix(b * 0.45, mix(a, b, cl.z) * (0.85 + 0.3 * n2), smoothstep(0.015, 0.07, edge));
      emit = vec3(0.0);
    } else if (k == ${K.BONE}) {
      float crack = 1.0 - smoothstep(0.0, 0.02, abs(n1 - 0.5));
      col = mix(a, b, smoothstep(0.3, 0.9, n2) * 0.6) * (1.0 - crack * 0.35);
      emit = vec3(spec * 0.15);
    } else if (k == ${K.COPPER}) {
      float v = smoothstep(0.6, 0.78, n1);
      vec3 metal = mix(b, a, 0.5 + 0.5 * sky) * (0.85 + 0.3 * n2);
      col = mix(metal * 0.6, vec3(0.18, 0.55, 0.45), v);
      emit = metal * (1.0 - v) * 0.35 + vec3(spec * (1.0 - v) * 0.9);
    } else if (k == ${K.STEEL}) {
      vec3 base = mix(b, a, 0.55 + 0.45 * n1);
      float band = 0.5 + 0.5 * sin(vn.y * 6.0 + vn.x * 2.5);
      col = base * 0.5;
      emit = base * (0.2 + 0.4 * band * sky) + vec3(spec);
    } else if (k == ${K.GLOSS}) {
      emit = a * glow + vec3(spec * 0.9) + a * rim * 0.15;
    } else if (k == ${K.METAL}) {
      col = a * 0.5;
      emit = mix(b, a, sky) * 0.45 + vec3(spec * 0.9) + a * glow;
    } else if (k == ${K.CHROME}) {
      float band = 0.5 + 0.5 * sin(vn.y * 8.0 - vn.x * 3.0);
      vec3 env = mix(b * 0.5, a, sky) * (0.55 + 0.45 * band);
      col = b * 0.25;
      emit = env * 0.75 + vec3(spec * 1.3) + a * rim * 0.25;
    } else if (k == ${K.CANDY}) {
      col = mix(a, b, step(0.5, fract(p.y * 7.0 + turn)));
      emit = vec3(spec * 0.75) + col * glow;
    } else if (k == ${K.SWIRL}) {
      float an = atan(p.z, p.x + 1e-5) / 6.28318;
      col = mix(a, b, step(0.5, fract(an * 3.0 + length(p.xz) * 14.0)));
      emit = vec3(spec * 0.8) + col * glow;
    } else if (k == ${K.ICE}) {
      col = mix(a, b, cl.z * 0.5 + n1 * 0.3);
      col = mix(col, vec3(1.0), (1.0 - smoothstep(0.01, 0.05, edge)) * 0.7);
      float sp = step(0.985, bHash(floor(q * 60.0) + floor(t * 3.0)));
      emit = a * glow + vec3(sp) + a * rim * 0.35 + vec3(spec * 0.8);
    } else if (k == ${K.GOLD}) {
      float band = 0.5 + 0.5 * sin(vn.y * 6.0 + vn.x * 3.0);
      vec3 metal = mix(a, b, band * sky * 0.7);
      float groove = 1.0 - smoothstep(0.0, 0.006, abs(fract(p.y * 9.0) - 0.5) - 0.44);
      float scroll = step(0.82, 0.5 + 0.5 * sin(turn * 37.699 + p.y * 40.0)) * step(0.5, fract(p.y * 4.5));
      metal *= 1.0 - (groove * 0.45 + scroll * 0.25);
      col = metal * 0.55;
      emit = metal * (0.3 + 0.35 * band) + vec3(spec * 1.1) + a * glow;
    } else if (k == ${K.LAVA}) {
      float crack = 1.0 - smoothstep(0.02, 0.1, edge);
      vec3 rock = a * (0.8 + 0.6 * n2);
      vec3 hot = mix(b, vec3(1.0, 0.86, 0.25), smoothstep(0.5, 1.0, crack) * (0.6 + 0.4 * n1));
      float pulse = 0.75 + 0.25 * sin(t * 3.0 + p.y * 9.0);
      col = mix(rock, hot, crack);
      emit = hot * crack * pulse * 1.1 + b * glow * 0.3;
    } else if (k == ${K.THUNDER}) {
      float z = abs(fract(q.x * 6.0 + abs(fract(p.y * 5.0) - 0.5) * 1.8 + t * 0.6) - 0.5);
      float bolt = 1.0 - smoothstep(0.03, 0.08, z);
      float flick = step(0.35, fract(sin(floor(t * 8.0)) * 43758.5));
      col = mix(a, b, bolt);
      emit = a * glow + b * bolt * (0.5 + 0.5 * flick) + vec3(spec * 0.6);
    } else if (k == ${K.GEM}) {
      // One shade per facet: its (flat) normal, snapped so every pixel of it agrees.
      vec3 nq = floor(n * 6.0 + 0.5);
      float h = bHash(nq.xy * 0.37 + nq.z * 1.71 + 0.5);
      col = mix(b, a, 0.45 + 0.55 * h);
      float glint = pow(max(0.0, sin(t * 2.0 + h * 40.0)), 24.0);
      emit = a * glow + col * 0.15 + vec3(glint * 0.8 + spec * 1.2) + a * rim * 0.4;
    } else if (k == ${K.RAINBOW}) {
      col = mix(bHue(fract(p.y * 1.1 - t * 0.25 + q.x * 0.6)), vec3(1.0), 0.15);
      emit = col * glow + vec3(spec * 0.6);
    } else if (k == ${K.PASTEL}) {
      float s = sin(p.y * 14.0 + n1 * 4.4 + q.x * 20.0);
      col = mix(mix(a, b, smoothstep(-0.6, 0.6, s)), vec3(1.0), smoothstep(0.65, 0.95, n2) * 0.6);
      emit = col * glow + vec3(spec * 0.5);
    } else if (k == ${K.GALAXY}) {
      float nn = n1 * 0.65 + n2 * 0.35;
      col = mix(a, b, smoothstep(0.35, 0.75, nn));
      col = mix(col, vec3(0.37, 0.84, 1.0), smoothstep(0.7, 0.95, nn) * 0.7);
      vec2 cellS = floor(q * 36.0);
      float blob = 1.0 - smoothstep(0.12, 0.38, length(fract(q * 36.0) - 0.5));
      float star = step(0.9, bHash(cellS)) * blob * (0.5 + 0.5 * sin(t * 4.0 + bHash(cellS + 5.0) * 30.0));
      col = mix(col, vec3(1.0), star);
      emit = vec3(star) + col * smoothstep(0.7, 0.95, nn) * 0.35 + a * glow;
    } else if (k == ${K.SCALES}) {
      float row = floor(q.y * 26.0);
      vec2 sq = vec2(q.x * 20.0 + mod(row, 2.0) * 0.5, q.y * 26.0);
      float d = length((fract(sq) - vec2(0.5, 0.25)) * vec2(1.0, 1.3));
      col = mix(a, b, smoothstep(0.2, 0.48, d));
      col = mix(col, a * 1.6, smoothstep(0.38, 0.44, d) * (1.0 - smoothstep(0.46, 0.5, d)));
      emit = vec3(spec * 0.5);
    } else if (k == ${K.CARBON}) {
      vec2 w = q * 70.0;
      float twill = step(0.5, fract(w.x * 0.5 + floor(w.y) * 0.5));
      col = mix(a, b, twill * 0.7 + 0.15 * n2);
      emit = vec3(spec * 0.55) + b * 0.1 * sky;
    } else if (k == ${K.NEON}) {
      float pulse = 0.8 + 0.2 * sin(t * 4.0 + p.y * 12.0);
      col = mix(a, vec3(1.0), 0.3);
      emit = a * (0.9 + glow) * pulse + vec3(spec * 0.5);
    } else if (k == ${K.PRISM}) {
      col = bHue(fract(cl.z + t * 0.2 + p.y * 0.3));
      col = mix(col, vec3(1.0), 0.25 + 0.3 * (1.0 - smoothstep(0.0, 0.05, edge)));
      emit = col * max(glow, 0.3) + vec3(spec);
    } else if (k == ${K.GRIP}) {
      float line = 1.0 - smoothstep(0.0, 0.12, fract(p.y * 32.0 + turn * 2.0));
      col = mix(a, b, step(0.5, fract(p.y * 12.0 + turn))) * (1.0 - 0.35 * line);
      emit = vec3(spec * 0.15);
    } else if (k == ${K.LEATHER}) {
      float s = fract(p.y * 18.0 + turn);
      float seam = 1.0 - smoothstep(0.0, 0.1, s);
      col = mix(a, a * 0.6, seam) * (0.85 + 0.3 * n1);
      float stitch = step(0.6, fract(turn * 16.0)) * (1.0 - smoothstep(0.03, 0.09, abs(s - 0.5)));
      col = mix(col, b, stitch * 0.8);
      emit = vec3(spec * 0.1);
    }
  }
`

const VERTEX_HEAD = /* glsl */ `
  attribute vec3 aP;
  attribute vec2 aLook;
  attribute vec3 aCa;
  attribute vec3 aCb;
  varying vec3 vBatP;
  varying vec2 vBatLook;
  varying vec3 vBatA;
  varying vec3 vBatB;
  varying vec3 vBatN;
  uniform float uBatTime;
  #ifdef BAT_SHOWCASE
    attribute vec3 aCenter;
    attribute float aPhase;
  #endif
`

/**
 * The paint varyings, then the showcase's turn: every bat spins about its own upright
 * axis on its stand (aCenter) and bobs, each a beat behind the last (aPhase).
 */
const VERTEX_NORMAL = /* glsl */ `
  vBatP = aP;
  vBatLook = aLook;
  // Colours travel as sRGB bytes; light in linear.
  vBatA = pow(aCa, vec3(2.2));
  vBatB = pow(aCb, vec3(2.2));
  vBatN = normal;
  vec3 objectNormal = normal;
  #ifdef BAT_SHOWCASE
    float batTurn = uBatTime * 0.6 + aPhase * 0.7;
    float batC = cos(batTurn);
    float batS = sin(batTurn);
    objectNormal = vec3(batC * normal.x + batS * normal.z, normal.y, -batS * normal.x + batC * normal.z);
  #endif
`

const VERTEX_POSITION = /* glsl */ `
  vec3 transformed = position;
  #ifdef BAT_SHOWCASE
    transformed = aCenter + vec3(batC * position.x + batS * position.z, position.y + sin(uBatTime * 1.6 + aPhase) * 0.15, -batS * position.x + batC * position.z);
  #endif
`

/** A Lambert material taught to paint bats; `showcase` turns them on their stands. */
function createBatMaterial(showcase) {
  const material = new MeshLambertMaterial({ color: 0xffffff })
  if (showcase) material.defines = { BAT_SHOWCASE: '' }
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBatTime = glowTime
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_HEAD}`)
      .replace('#include <beginnormal_vertex>', VERTEX_NORMAL)
      .replace('#include <begin_vertex>', VERTEX_POSITION)
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uBatTime;
        varying vec3 vBatP;
        varying vec2 vBatLook;
        varying vec3 vBatA;
        varying vec3 vBatB;
        varying vec3 vBatN;
        ${BAT_GLSL}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        vec3 batCol;
        vec3 batEmit;
        batPaint(vBatP, normalize(vBatN), normal, vBatLook.x, vBatA, vBatB, vBatLook.y, uBatTime, batCol, batEmit);
        diffuseColor.rgb = batCol;
        totalEmissiveRadiance += batEmit;`,
      )
  }
  material.customProgramCacheKey = () => (showcase ? 'bat-showcase-v1' : 'bat-v1')
  return material
}

// --- Building a bat -------------------------------------------------------------------

const UP = new Vector3(0, 1, 0)
const _color = new Color()

/** sRGB bytes of a hex colour. */
function srgb(hex) {
  const h = _color.set(hex).getHex()
  return [(h >> 16) & 255, (h >> 8) & 255, h & 255]
}

/** A transform: position, Euler rotation (XYZ) and scale. */
function at(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  return new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromEuler(new Euler(rx, ry, rz)), new Vector3(sx, sy, sz))
}

/** A transform turning +Y to point along (dx, dy, dz), from (x, y, z). */
function aim(x, y, z, dx, dy, dz, sx = 1, sy = sx, sz = sx) {
  const q = new Quaternion().setFromUnitVectors(UP, new Vector3(dx, dy, dz).normalize())
  return new Matrix4().compose(new Vector3(x, y, z), q, new Vector3(sx, sy, sz))
}

/** A lathe round the bat's axis from [radius, y] pairs, bottom to top. */
const lathe = (points, segments = 12) => new LatheGeometry(points.map(([r, y]) => new Vector2(Math.max(0, r), y)), segments)

/** A ring round the bat's axis at height y. */
const ring = (y, radius, tube, radial = 4, tubular = 14) => new TorusGeometry(radius, tube, radial, tubular).rotateX(Math.PI / 2).translate(0, y, 0)

/** A cone whose base sits at the origin, pointing up +Y. */
const spike = (radius, height, segments = 5) => new ConeGeometry(radius, height, segments, 1).translate(0, height / 2, 0)

/** Repeatable noise in 0-1 from a position (shared vertices get the same value). */
function hash3(x, y, z, seed = 0) {
  const h = Math.sin(Math.round(x * 997) * 12.9898 + Math.round(y * 997) * 78.233 + Math.round(z * 997) * 37.719 + seed * 19.19) * 43758.5453
  return h - Math.floor(h)
}

/** Pushes every vertex out from `centre` by up to +-amount of its distance: a lumpy rock. */
function lumpy(geometry, amount, seed = 0) {
  const pos = geometry.getAttribute('position')
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    const k = 1 + amount * (hash3(x, y, z, seed) - 0.5) * 2
    pos.setXYZ(i, x * k, y * k, z * k)
  }
  return geometry
}

/** Roughens a lathe: each vertex pushed out from the axis, above `fromY`. */
function roughen(geometry, amount, fromY, seed = 0) {
  const pos = geometry.getAttribute('position')
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    if (y < fromY || Math.hypot(x, z) < 1e-4) continue
    const k = 1 + amount * (hash3(x, y, z, seed) - 0.35)
    pos.setXYZ(i, x * k, y, z * k)
  }
  return geometry
}

/** Collects a bat's parts, each with its paint, and merges them into one geometry. */
class BatBuilder {
  constructor() {
    this.parts = []
  }

  /**
   * Adds a part painted `look` in colours `a` / `b`. `m` places it; `flat` shades it in
   * facets; `local` paints it in its own frame (before `m`), not the bat's.
   */
  add(geometry, look, a, b = a, { glow = 0, m = null, flat = false, local = false } = {}) {
    let g = geometry
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name)
    g.clearGroups()
    if (flat && g.index) {
      const unshared = g.toNonIndexed()
      g.dispose()
      g = unshared
    }
    const own = local ? g.getAttribute('position').array.slice() : null
    if (m) g.applyMatrix4(m)
    if (flat || !g.getAttribute('normal')) g.computeVertexNormals()
    const count = g.getAttribute('position').count
    if (!g.index) g.setIndex(Array.from({ length: count }, (_, i) => i))
    g.setAttribute('aP', new BufferAttribute(own ?? g.getAttribute('position').array.slice(), 3))
    const looks = new Float32Array(count * 2)
    const ca = new Uint8Array(count * 3)
    const cb = new Uint8Array(count * 3)
    const [ar, ag, ab] = srgb(a)
    const [br, bg, bb] = srgb(b)
    for (let i = 0; i < count; i += 1) {
      looks[i * 2] = look
      looks[i * 2 + 1] = glow
      ca[i * 3] = ar
      ca[i * 3 + 1] = ag
      ca[i * 3 + 2] = ab
      cb[i * 3] = br
      cb[i * 3 + 1] = bg
      cb[i * 3 + 2] = bb
    }
    g.setAttribute('aLook', new BufferAttribute(looks, 2))
    g.setAttribute('aCa', new BufferAttribute(ca, 3, true))
    g.setAttribute('aCb', new BufferAttribute(cb, 3, true))
    this.parts.push(g)
    return this
  }

  build() {
    const merged = mergeGeometries(this.parts, false)
    for (const part of this.parts) part.dispose()
    merged.computeBoundingBox()
    merged.computeBoundingSphere()
    return merged
  }
}

// --- Shapes ---------------------------------------------------------------------------

/** Where a bat's knob ends (its bottom). */
const KNOB_Y = -0.12

/**
 * The classic bat's profile, [radius, y] from the knob up: a flared knob, a slim handle,
 * a smooth taper and the barrel, ending `cap` - 'round', 'flat' or 'cup' (a cupped end).
 */
function classic({ knob = 0.05, handle = 0.03, barrel = 0.08, handleTop = 0.28, barrelStart = 0.64, tip = 1.0, cap = 'round', steps = 6 } = {}) {
  const y0 = KNOB_Y
  const pts = [
    [0, y0],
    [knob * 0.75, y0 + 0.004],
    [knob, y0 + 0.018],
    [knob * 0.92, y0 + 0.036],
    [handle * 1.25, y0 + 0.055],
    [handle, y0 + 0.085],
    [handle, handleTop],
  ]
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps
    const s = t * t * (3 - 2 * t)
    pts.push([handle + (barrel - handle) * s, handleTop + (barrelStart - handleTop) * t])
  }
  if (cap === 'round') {
    pts.push([barrel, tip - barrel * 0.5])
    for (let i = 1; i <= 3; i += 1) {
      const a = (i / 3) * (Math.PI / 2)
      pts.push([barrel * Math.cos(a), tip - barrel * 0.5 + Math.sin(a) * barrel * 0.5])
    }
  } else if (cap === 'cup') {
    pts.push([barrel, tip - 0.01], [barrel * 0.97, tip], [barrel * 0.72, tip], [barrel * 0.6, tip - 0.022], [0, tip - 0.026])
  } else {
    pts.push([barrel, tip - 0.01], [barrel * 0.95, tip], [0, tip])
  }
  return pts
}

/** The profile's radius at height y (above the knob), for fitting rings and studs on it. */
function radiusAt(points, y) {
  for (let i = points.length - 1; i > 0; i -= 1) {
    const [r1, y1] = points[i]
    const [r0, y0] = points[i - 1]
    if (y <= y1 && y >= y0 && y1 > y0) return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0)
  }
  return points[Math.floor(points.length / 2)][0]
}

/** A wrap round the handle from y0 to y1, `thick` proud of radius r (an open tube). */
const wrap = (r, y0, y1, thick = 0.006) =>
  lathe(
    [
      [r - 0.001, y0],
      [r + thick, y0 + 0.006],
      [r + thick, y1 - 0.006],
      [r - 0.001, y1],
    ],
    12,
  )

/** `count` things round the barrel at height y, each made by `make(angle)` and painted the same. */
function around(builder, count, make, look, a, b, opts, offset = 0) {
  for (let i = 0; i < count; i += 1) builder.add(make(((i + offset) / count) * Math.PI * 2), look, a, b, opts)
}

const WOOD_TAPE = '#26262b'

/** Every bat's builder, by id. Each returns its merged geometry. */
const BUILDERS = {
  /** Classic light wood with a black taped grip. */
  bicycle() {
    const b = new BatBuilder()
    b.add(lathe(classic({ knob: 0.05, handle: 0.028, barrel: 0.075, tip: 1.0 })), K.WOOD, '#e9c48e', '#c08850')
    b.add(wrap(0.028, -0.035, 0.22), K.GRIP, WOOD_TAPE, WOOD_TAPE)
    return b.build()
  },

  /** Darker maple, thicker barrel with a cupped end, red-and-white tape, two gold rings. */
  mountain() {
    const pts = classic({ knob: 0.055, handle: 0.03, barrel: 0.088, handleTop: 0.26, barrelStart: 0.62, tip: 1.06, cap: 'cup' })
    const b = new BatBuilder()
    b.add(lathe(pts), K.WOOD, '#a8642e', '#6a3414')
    b.add(wrap(0.03, -0.035, 0.24), K.GRIP, '#e0262f', '#ffffff')
    for (const y of [0.7, 0.98]) b.add(ring(y, radiusAt(pts, y) + 0.001, 0.006), K.METAL, '#ffd34d', '#b07a10')
    return b.build()
  },

  /** A bamboo cane: segments with node rings, a twine grip and a leaf tied on. */
  wood() {
    const b = new BatBuilder()
    const joints = [-0.1, 0.14, 0.36, 0.57, 0.79, 1.02]
    const r = (y) => 0.038 + (0.07 - 0.038) * Math.min(1, Math.max(0, (y + 0.1) / 1.0))
    for (let i = 0; i + 1 < joints.length; i += 1) {
      const y0 = joints[i]
      const y1 = joints[i + 1]
      b.add(new CylinderGeometry(r(y1), r(y0), y1 - y0, 12, 1, i > 0 && i < joints.length - 2), K.BAMBOO, '#c4dc6a', '#8fb444', { m: at(0, (y0 + y1) / 2, 0) })
    }
    for (const y of joints) b.add(ring(y, r(y) + 0.003, 0.011, 3, 12), K.PLAIN, '#7ea33a')
    // The open top: a dark hollow inside the last node.
    b.add(new CylinderGeometry(r(1.02) * 0.75, r(1.02) * 0.75, 0.004, 12), K.PLAIN, '#4a5e22', '#4a5e22', { m: at(0, 1.022, 0) })
    b.add(wrap(r(0.05), -0.04, 0.12, 0.005), K.LEATHER, '#c9a46a', '#8a6a3a')
    // Two leaves, tied on just over the grip.
    for (const side of [-1, 1]) {
      b.add(new SphereGeometry(1, 8, 4), K.PLAIN, '#3fae3a', '#3fae3a', { m: at(side * 0.06, 0.24, 0.02, 0, 0, side * -0.55, 0.012, 0.13, 0.04) })
    }
    return b.build()
  },

  /** A caveman's club: a leather-wrapped stick with a head of rock lumps. */
  stone() {
    const b = new BatBuilder()
    b.add(lathe(classic({ knob: 0.048, handle: 0.032, barrel: 0.05, handleTop: 0.3, barrelStart: 0.5, tip: 0.6, cap: 'flat' }), 10), K.WOOD, '#7a5032', '#4f3018')
    b.add(wrap(0.032, -0.04, 0.3, 0.008), K.LEATHER, '#7a4a24', '#d9b48a')
    const lumps = [
      [0, 0.5, 0, 0.075],
      [0.02, 0.62, -0.012, 0.09],
      [-0.016, 0.75, 0.015, 0.105],
      [0.012, 0.88, -0.006, 0.115],
      [0, 0.99, 0.01, 0.095],
      [0.075, 0.8, 0.03, 0.05],
      [-0.065, 0.68, -0.04, 0.05],
    ]
    lumps.forEach(([x, y, z, s], i) => b.add(lumpy(new IcosahedronGeometry(1, s > 0.06 ? 1 : 0), 0.16, i), K.STONE, '#9aa1aa', '#6c727c', { m: at(x, y, z, i, i * 2, 0, s), flat: true }))
    return b.build()
  },

  /** A big cartoon femur: a waisted shaft with knobbled double ends, a bandage grip. */
  cookie() {
    const b = new BatBuilder()
    const pts = []
    for (let i = 0; i <= 10; i += 1) {
      const y = -0.04 + (i / 10) * 0.98
      const t = i / 10
      pts.push([0.046 + 0.016 * Math.pow(Math.abs(t - 0.5) * 2, 2), y])
    }
    b.add(lathe([[0, -0.05], ...pts, [0, 0.95]], 12), K.BONE, '#f3ead2', '#d8c9a3')
    for (const side of [-1, 1]) {
      b.add(new SphereGeometry(0.06, 9, 6), K.BONE, '#f3ead2', '#d8c9a3', { m: at(side * 0.036, -0.075, 0) })
      b.add(new SphereGeometry(0.085, 9, 6), K.BONE, '#f3ead2', '#d8c9a3', { m: at(side * 0.052, 0.99, 0) })
    }
    b.add(new SphereGeometry(0.07, 9, 6), K.BONE, '#f3ead2', '#d8c9a3', { m: at(0, 0.93, 0) })
    b.add(wrap(0.055, 0.0, 0.24, 0.006), K.GRIP, '#f8f4ea', '#e2d8c4')
    return b.build()
  },

  /** Copper with patches of verdigris, three riveted bands. */
  pizza() {
    const pts = classic({ knob: 0.052, handle: 0.03, barrel: 0.08, tip: 1.02, cap: 'flat' })
    const b = new BatBuilder()
    b.add(lathe(pts), K.COPPER, '#e07a3c', '#a84a20')
    b.add(wrap(0.03, -0.035, 0.24), K.LEATHER, '#5a3418', '#c79a6a')
    for (const y of [0.48, 0.72, 0.94]) {
      const r = radiusAt(pts, y)
      b.add(new CylinderGeometry(r + 0.006, r + 0.006, 0.03, 12, 1, true), K.METAL, '#c96a30', '#7a3412', { m: at(0, y, 0) })
      around(b, 6, (a) => new OctahedronGeometry(0.011, 0).applyMatrix4(at(Math.cos(a) * (r + 0.008), y, Math.sin(a) * (r + 0.008))), K.METAL, '#ffd08a', '#b06a2a', { flat: true })
    }
    return b.build()
  },

  /** Brushed steel, rows of hex bolts, a steel collar and end cap, a blue-and-white grip. */
  donut() {
    const pts = classic({ knob: 0.052, handle: 0.029, barrel: 0.078, tip: 1.03, cap: 'flat' })
    const b = new BatBuilder()
    b.add(lathe(pts), K.STEEL, '#c9d0da', '#8b95a3')
    b.add(wrap(0.029, -0.035, 0.24), K.GRIP, '#1f4fd8', '#ffffff')
    b.add(ring(0.5, radiusAt(pts, 0.5) + 0.002, 0.009), K.METAL, '#e8edf3', '#5a6472')
    b.add(new CylinderGeometry(0.074, 0.074, 0.016, 12), K.METAL, '#9aa3b0', '#3a404a', { m: at(0, 1.034, 0) })
    for (const y of [0.74, 0.92]) {
      const r = radiusAt(pts, y)
      around(b, 4, (a) => new CylinderGeometry(0.015, 0.015, 0.014, 6).translate(0, 0.007, 0).applyMatrix4(aim(Math.cos(a) * r, y, Math.sin(a) * r, Math.cos(a), 0, Math.sin(a))), K.METAL, '#e8edf3', '#5a6472', { flat: true }, y > 0.8 ? 0.5 : 0)
    }
    return b.build()
  },

  /** An aluminium slugger: silver paint, blue and red stripes, a rubber end cap. */
  watermelon() {
    const pts = classic({ knob: 0.058, handle: 0.026, barrel: 0.082, handleTop: 0.32, barrelStart: 0.6, tip: 1.1, cap: 'flat' })
    const b = new BatBuilder()
    b.add(lathe(pts), K.GLOSS, '#d4dae3', '#d4dae3')
    b.add(wrap(0.026, -0.035, 0.26, 0.007), K.GRIP, '#1a1a1e', '#2a2a30')
    const stripe = (y0, y1, color) => {
      const r = radiusAt(pts, (y0 + y1) / 2) + 0.002
      b.add(new CylinderGeometry(r, r, y1 - y0, 12, 1, true), K.GLOSS, color, color, { m: at(0, (y0 + y1) / 2, 0) })
    }
    stripe(0.64, 0.69, '#2f6bff')
    stripe(0.71, 0.735, '#ff3b3b')
    stripe(0.98, 1.03, '#2f6bff')
    b.add(new CylinderGeometry(0.079, 0.079, 0.03, 12), K.PLAIN, '#1a1a1e', '#1a1a1e', { m: at(0, 1.105, 0) })
    return b.build()
  },

  /** Dark wood ringed with steel studs and spikes, steel bands, a red grip. */
  monster() {
    const pts = classic({ knob: 0.055, handle: 0.032, barrel: 0.085, tip: 1.04, cap: 'round' })
    const b = new BatBuilder()
    b.add(lathe(pts), K.WOOD, '#4a3426', '#2a1a10')
    b.add(wrap(0.032, -0.035, 0.24), K.GRIP, '#c81e2a', '#1a1a1e')
    for (const y of [0.52, 0.99]) b.add(ring(y, radiusAt(pts, y) + 0.002, 0.009), K.METAL, '#b8c0cc', '#4a5260')
    ;[0.62, 0.77, 0.9].forEach((y, row) => {
      const r = radiusAt(pts, y) - 0.004
      around(b, 6, (a) => spike(0.018, 0.075).applyMatrix4(aim(Math.cos(a) * r, y, Math.sin(a) * r, Math.cos(a), 0.15, Math.sin(a))), K.METAL, '#e6ebf2', '#5a6270', { flat: true }, row * 0.5)
    })
    b.add(spike(0.02, 0.08), K.METAL, '#e6ebf2', '#5a6270', { m: at(0, 1.07, 0), flat: true })
    return b.build()
  },

  /** A candy-striped stick with a big swirly lollipop for a barrel and a ribbon bow. */
  mint() {
    const b = new BatBuilder()
    b.add(
      lathe([
        [0, -0.125],
        [0.04, -0.12],
        [0.048, -0.095],
        [0.034, -0.07],
        [0.034, 0.74],
        [0, 0.745],
      ]),
      K.CANDY,
      '#ffffff',
      '#e8263a',
    )
    b.add(wrap(0.034, -0.04, 0.2), K.GRIP, '#ff8fd0', '#ffffff')
    // The lollipop, its face to the front (+Z).
    b.add(new CylinderGeometry(0.19, 0.19, 0.07, 22, 1), K.SWIRL, '#ff4fa8', '#fff2a8', { m: at(0, 0.9, 0, Math.PI / 2), local: true })
    b.add(new TorusGeometry(0.19, 0.025, 4, 22), K.GLOSS, '#ffffff', '#ffffff', { m: at(0, 0.9, 0) })
    // A ribbon bow where the stick meets the sweet.
    for (const side of [-1, 1]) b.add(new SphereGeometry(1, 8, 5), K.GLOSS, '#4fd2ff', '#4fd2ff', { m: at(side * 0.06, 0.7, 0.03, 0, 0, side * 0.5, 0.06, 0.035, 0.022) })
    b.add(new SphereGeometry(0.026, 8, 5), K.GLOSS, '#4fd2ff', '#4fd2ff', { m: at(0, 0.7, 0.035) })
    return b.build()
  },

  /** Mirror chrome with black bands. */
  silver() {
    const pts = classic({ knob: 0.052, handle: 0.028, barrel: 0.084, handleTop: 0.27, barrelStart: 0.58, tip: 1.06, cap: 'round' })
    const b = new BatBuilder()
    b.add(lathe(pts), K.CHROME, '#ffffff', '#5a6a85')
    b.add(wrap(0.028, -0.035, 0.23), K.GRIP, '#15161a', '#3a3d45')
    for (const y of [0.5, 0.64, 0.96]) b.add(ring(y, radiusAt(pts, y) + 0.001, 0.007), K.PLAIN, '#15161a')
    return b.build()
  },

  /** Faceted frosted crystal with icicles down the barrel and a crystal crown. */
  ice() {
    const pts = classic({ knob: 0.055, handle: 0.032, barrel: 0.085, tip: 1.0, cap: 'flat', steps: 4 })
    const b = new BatBuilder()
    b.add(lathe(pts, 7), K.ICE, '#c9f3ff', '#5fb8ee', { glow: 0.12, flat: true })
    b.add(wrap(0.032, -0.035, 0.22), K.GRIP, '#9fe8ff', '#ffffff')
    ;[0.6, 0.82].forEach((y, row) => {
      const r = radiusAt(pts, y) - 0.004
      around(b, 5, (a) => spike(0.022, 0.11).applyMatrix4(aim(Math.cos(a) * r, y, Math.sin(a) * r, Math.cos(a), -0.55, Math.sin(a))), K.ICE, '#e8fbff', '#7fcfff', { glow: 0.2, flat: true }, row * 0.5)
    })
    const crown = [
      [0, 0, 0, 0.034, 0.2],
      [0.04, -0.02, 0.4, 0.024, 0.13],
      [-0.03, 0.03, -0.45, 0.022, 0.12],
      [0.01, -0.04, 0.2, 0.02, 0.1],
    ]
    for (const [x, z, lean, r, h] of crown) b.add(spike(r, h, 6), K.ICE, '#e8fbff', '#7fcfff', { glow: 0.2, m: at(x, 0.99, z, lean * 0.6, 0, -lean), flat: true })
    return b.build()
  },

  /** Gilded and engraved, gold rings, a ruby set in the knob. */
  gold() {
    const pts = classic({ knob: 0.054, handle: 0.03, barrel: 0.082, tip: 1.04, cap: 'round' })
    const b = new BatBuilder()
    b.add(lathe(pts), K.GOLD, '#ffc81a', '#fff1a8', { glow: 0.1 })
    b.add(wrap(0.03, -0.035, 0.23), K.GRIP, '#7a0a22', '#ffd21f')
    for (const y of [0.5, 0.64]) b.add(ring(y, radiusAt(pts, y) + 0.002, 0.008), K.METAL, '#ffd34d', '#c27a00')
    b.add(new OctahedronGeometry(0.032, 0), K.GEM, '#ff3b5c', '#7a0a22', { glow: 0.35, m: at(0, KNOB_Y - 0.012, 0, 0, 0, 0, 1, 1.25, 1), flat: true })
    return b.build()
  },

  /** Black volcanic rock split by glowing, flowing magma, rock chunks jutting out. */
  lava() {
    const pts = classic({ knob: 0.055, handle: 0.032, barrel: 0.09, tip: 1.04, cap: 'round' })
    const b = new BatBuilder()
    b.add(roughen(lathe(pts, 10), 0.22, 0.32, 3), K.LAVA, '#1d0f0b', '#ff5a14', { glow: 0.1, flat: true })
    b.add(wrap(0.032, -0.035, 0.23, 0.007), K.LEATHER, '#2a1a14', '#ff5a14')
    const chunks = [
      [0.62, 0.3, 0.035],
      [0.78, 2.4, 0.04],
      [0.9, 4.3, 0.032],
      [0.7, 5.4, 0.028],
    ]
    for (const [y, a, s] of chunks) {
      const r = radiusAt(pts, y)
      b.add(lumpy(new IcosahedronGeometry(1, 0), 0.2, y * 10), K.LAVA, '#1d0f0b', '#ff5a14', { glow: 0.1, m: at(Math.cos(a) * r, y, Math.sin(a) * r, a, a * 2, 0, s), flat: true })
    }
    return b.build()
  },

  /** A zig-zag lightning bolt on a navy handle, crackling with electricity. */
  platinum() {
    const b = new BatBuilder()
    b.add(lathe(classic({ knob: 0.052, handle: 0.03, barrel: 0.036, handleTop: 0.28, barrelStart: 0.34, tip: 0.36, cap: 'flat' })), K.GRIP, '#1c2a5c', '#2f4fa8')
    b.add(wrap(0.03, -0.035, 0.24), K.GRIP, '#1c2a5c', '#7fe6ff')
    b.add(ring(0.33, 0.04, 0.012), K.METAL, '#e8f0ff', '#6a7a9a')
    // The bolt: a zig-zag band, widening upwards, extruded front to back.
    const spine = [
      [0, 0.32, 0.03],
      [0.06, 0.58, 0.045],
      [-0.045, 0.62, 0.05],
      [0.07, 0.9, 0.06],
      [-0.03, 0.95, 0.065],
      [0.04, 1.17, 0.07],
    ]
    const shape = new Shape()
    shape.moveTo(spine[0][0] + spine[0][2], spine[0][1])
    for (let i = 1; i < spine.length; i += 1) shape.lineTo(spine[i][0] + spine[i][2], spine[i][1])
    for (let i = spine.length - 1; i >= 0; i -= 1) shape.lineTo(spine[i][0] - spine[i][2], spine[i][1])
    const bolt = new ExtrudeGeometry(shape, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.014, bevelSize: 0.012, bevelSegments: 1 })
    b.add(bolt, K.THUNDER, '#ffd21f', '#7ff6ff', { glow: 0.35, m: at(0, 0, -0.035), flat: true })
    return b.build()
  },

  /** A hexagonal emerald prism, pointed at the tip, set in gold. */
  emerald() {
    const b = new BatBuilder()
    b.add(lathe(classic({ knob: 0.05, handle: 0.03, barrel: 0.032, handleTop: 0.28, barrelStart: 0.3, tip: 0.31, cap: 'flat' }), 6), K.GEM, '#1fb866', '#0a5a2c', { glow: 0.1, flat: true })
    b.add(wrap(0.031, -0.035, 0.22), K.GRIP, '#0a6b34', '#ffd21f')
    b.add(
      lathe(
        [
          [0, 0.3],
          [0.04, 0.31],
          [0.07, 0.48],
          [0.088, 0.66],
          [0.088, 0.96],
          [0, 1.14],
        ],
        6,
      ),
      K.GEM,
      '#2bd17a',
      '#0a6b34',
      { glow: 0.15, flat: true },
    )
    b.add(ring(0.31, 0.045, 0.014, 4, 6), K.METAL, '#ffd34d', '#c27a00', { flat: true })
    return b.build()
  },

  /** Four cut rubies stacked up the barrel, each bigger than the last, gold collars. */
  ruby() {
    const b = new BatBuilder()
    b.add(lathe(classic({ knob: 0.052, handle: 0.03, barrel: 0.034, handleTop: 0.3, barrelStart: 0.33, tip: 0.34, cap: 'flat', steps: 3 }), 10), K.METAL, '#ffd34d', '#b07a10')
    b.add(wrap(0.03, -0.035, 0.24), K.GRIP, '#ffd21f', '#7a0a22')
    const gems = [
      [0.42, 0.06, 0.1],
      [0.58, 0.075, 0.12],
      [0.77, 0.09, 0.14],
      [0.98, 0.1, 0.15],
    ]
    for (const [cy, r, h] of gems) {
      b.add(
        lathe(
          [
            [0, cy - h * 0.62],
            [r, cy],
            [r * 0.98, cy + 0.012],
            [r * 0.62, cy + h * 0.42],
            [0, cy + h * 0.42],
          ],
          8,
        ),
        K.GEM,
        '#ff3b5c',
        '#7a0a22',
        { glow: 0.18, flat: true },
      )
      b.add(ring(cy - h * 0.6, 0.03, 0.01, 3, 8), K.METAL, '#ffd34d', '#b07a10')
    }
    return b.build()
  },

  /** A huge brilliant-cut diamond for a barrel on a silver handle, a diamond knob. */
  diamond() {
    const b = new BatBuilder()
    b.add(lathe(classic({ knob: 0.048, handle: 0.03, barrel: 0.036, handleTop: 0.32, barrelStart: 0.36, tip: 0.37, cap: 'flat' })), K.CHROME, '#ffffff', '#6a7a95')
    b.add(wrap(0.03, -0.035, 0.24), K.GRIP, '#bff0ff', '#ffffff')
    b.add(
      lathe(
        [
          [0, 0.34],
          [0.06, 0.55],
          [0.115, 0.86],
          [0.117, 0.885],
          [0.082, 1.0],
          [0.056, 1.05],
          [0, 1.05],
        ],
        8,
      ),
      K.GEM,
      '#e8fbff',
      '#6fc8ff',
      { glow: 0.25, flat: true },
    )
    b.add(new OctahedronGeometry(0.03, 0), K.GEM, '#e8fbff', '#6fc8ff', { glow: 0.3, m: at(0, KNOB_Y - 0.01, 0, 0, 0, 0, 1, 1.3, 1), flat: true })
    return b.build()
  },

  /** A flowing spectrum, a puff of cloud at the knob. */
  rainbow() {
    const b = new BatBuilder()
    b.add(lathe(classic({ knob: 0.05, handle: 0.029, barrel: 0.085, tip: 1.05, cap: 'round' })), K.RAINBOW, '#ffffff', '#ffffff', { glow: 0.25 })
    b.add(wrap(0.029, -0.035, 0.23), K.GRIP, '#ffffff', '#ff7ad9')
    for (const [x, y, z, s] of [
      [0, KNOB_Y - 0.01, 0, 0.04],
      [0.035, KNOB_Y + 0.005, 0.01, 0.03],
      [-0.034, KNOB_Y + 0.004, -0.008, 0.03],
    ])
      b.add(new SphereGeometry(s, 8, 6), K.PLAIN, '#ffffff', '#ffffff', { glow: 0.2, m: at(x, y, z) })
    return b.build()
  },

  /** Pastel swirls, a pearly spiral horn for a tip and little wings at the handle. */
  unicorn() {
    const b = new BatBuilder()
    b.add(lathe(classic({ knob: 0.05, handle: 0.029, barrel: 0.078, tip: 0.92, cap: 'flat' })), K.PASTEL, '#ffb6e6', '#a8d8ff', { glow: 0.06 })
    b.add(wrap(0.029, -0.035, 0.22), K.GRIP, '#ffb6e6', '#ffffff')
    // The horn, ridged as it twists to a point.
    const horn = []
    for (let i = 0; i <= 14; i += 1) {
      const t = i / 14
      horn.push([(1 - t) * 0.066 * (1 + 0.12 * Math.sin(t * 40)), 0.915 + t * 0.34])
    }
    b.add(lathe(horn, 10), K.CANDY, '#fff4c2', '#ffd27a', { glow: 0.2 })
    for (const side of [-1, 1]) b.add(new SphereGeometry(1, 8, 5), K.GLOSS, '#ffffff', '#ffffff', { glow: 0.15, m: at(side * 0.08, 0.33, -0.01, 0, 0, side * -0.9, 0.018, 0.1, 0.05) })
    return b.build()
  },

  /** A nebula of twinkling stars, a glowing ring orbiting the barrel, a planet for a knob. */
  galaxy() {
    const b = new BatBuilder()
    b.add(lathe(classic({ knob: 0.04, handle: 0.029, barrel: 0.085, tip: 1.05, cap: 'round' })), K.GALAXY, '#120a2a', '#7a3cff', { glow: 0.1 })
    b.add(wrap(0.029, -0.035, 0.23), K.GRIP, '#120a2a', '#7a3cff')
    b.add(new TorusGeometry(0.15, 0.008, 4, 24), K.NEON, '#5fd6ff', '#5fd6ff', { glow: 0.6, m: at(0, 0.8, 0, Math.PI / 2 + 0.45, 0, 0.2) })
    b.add(new SphereGeometry(0.05, 10, 7), K.GALAXY, '#2a1060', '#c35cff', { glow: 0.2, m: at(0, KNOB_Y - 0.02, 0) })
    return b.build()
  },

  /** Green scales, golden spines down its back, horns at the tip and claws at the knob. */
  dragon() {
    const pts = classic({ knob: 0.05, handle: 0.031, barrel: 0.088, tip: 1.04, cap: 'round' })
    const b = new BatBuilder()
    b.add(lathe(pts), K.SCALES, '#22a552', '#0d4f26')
    b.add(wrap(0.031, -0.035, 0.23), K.GRIP, '#0d4f26', '#ffd21f')
    for (let i = 0; i < 6; i += 1) {
      const y = 0.45 + i * 0.1
      const r = radiusAt(pts, y) - 0.004
      b.add(spike(0.02, 0.06 + i * 0.008), K.GLOSS, '#ffd21f', '#ffd21f', { m: aim(0, y, -r, 0, 0.35, -1), flat: true })
    }
    // Two horns curving up and out from the tip.
    for (const side of [-1, 1]) {
      b.add(new ConeGeometry(0.026, 0.1, 6).translate(0, 0.05, 0), K.GLOSS, '#f3ead2', '#f3ead2', { m: aim(side * 0.045, 0.98, 0, side, 0.5, 0), flat: true })
      b.add(new ConeGeometry(0.016, 0.09, 6).translate(0, 0.045, 0), K.GLOSS, '#f3ead2', '#f3ead2', { m: aim(side * 0.115, 1.025, 0, side * 0.3, 1, 0), flat: true })
    }
    // Claws round the knob.
    for (let i = 0; i < 3; i += 1) {
      const a = (i / 3) * Math.PI * 2 + 0.5
      b.add(spike(0.012, 0.05), K.GLOSS, '#1a1a1e', '#1a1a1e', { m: aim(Math.cos(a) * 0.045, KNOB_Y + 0.01, Math.sin(a) * 0.045, Math.cos(a), -0.8, Math.sin(a)), flat: true })
    }
    return b.build()
  },

  /** Chrome and carbon fibre, glowing neon-blue rings, an energy orb held at the tip. */
  cosmic() {
    const pts = classic({ knob: 0.05, handle: 0.03, barrel: 0.078, handleTop: 0.32, barrelStart: 0.58, tip: 1.0, cap: 'flat', steps: 5 })
    const b = new BatBuilder()
    b.add(lathe(pts, 10), K.CHROME, '#ffffff', '#4a5a75')
    b.add(wrap(0.03, -0.035, 0.26), K.CARBON, '#15161a', '#2c313b')
    // Carbon panels round the barrel, and chrome sleeves at either end of it.
    const panel = (y0, y1) => {
      const r = radiusAt(pts, (y0 + y1) / 2) + 0.003
      b.add(new CylinderGeometry(r, r, y1 - y0, 10, 1, true), K.CARBON, '#1a1d24', '#3a404d', { m: at(0, (y0 + y1) / 2, 0) })
    }
    panel(0.6, 0.72)
    panel(0.82, 0.92)
    b.add(new CylinderGeometry(0.04, 0.04, 0.07, 10), K.CHROME, '#ffffff', '#4a5a75', { m: at(0, 0.33, 0) })
    for (const y of [0.37, 0.77, 0.96]) b.add(ring(y, radiusAt(pts, y) + 0.004, 0.009, 3, 12), K.NEON, '#3fd8ff', '#3fd8ff', { glow: 1 })
    b.add(ring(KNOB_Y + 0.02, 0.052, 0.008, 3, 12), K.NEON, '#3fd8ff', '#3fd8ff', { glow: 1 })
    // The orb, in a chrome cradle.
    b.add(new CylinderGeometry(0.05, 0.075, 0.04, 10), K.CHROME, '#ffffff', '#4a5a75', { m: at(0, 1.02, 0) })
    b.add(ring(1.045, 0.055, 0.012, 3, 12), K.CHROME, '#ffffff', '#4a5a75')
    b.add(new SphereGeometry(0.06, 10, 7), K.NEON, '#5fd6ff', '#5fd6ff', { glow: 1, m: at(0, 1.1, 0) })
    return b.build()
  },

  /** Shifting prismatic crystal, three glowing rings floating round it, a prism knob. */
  infinity() {
    const b = new BatBuilder()
    b.add(lathe(classic({ knob: 0.05, handle: 0.029, barrel: 0.086, tip: 1.06, cap: 'round' })), K.PRISM, '#ffffff', '#ffffff', { glow: 0.3 })
    b.add(wrap(0.029, -0.035, 0.23), K.GRIP, '#ffffff', '#c69bff')
    ;[0.55, 0.75, 0.95].forEach((y, i) => {
      b.add(new TorusGeometry(0.13 + i * 0.012, 0.009, 3, 18), K.NEON, '#ffffff', '#ffffff', { glow: 0.4, m: at(0, y, 0, Math.PI / 2 + (i - 1) * 0.35, 0, (i - 1) * 0.25) })
    })
    b.add(new OctahedronGeometry(0.034, 0), K.PRISM, '#ffffff', '#ffffff', { glow: 0.4, m: at(0, KNOB_Y - 0.012, 0, 0, 0, 0, 1, 1.3, 1), flat: true })
    return b.build()
  },
}

const geometries = new Map()

/** Bat `id`'s geometry, built the first time it's asked for and shared from then on. */
export function getBatGeometry(id) {
  const key = BUILDERS[id] ? id : 'bicycle'
  let geometry = geometries.get(key)
  if (!geometry) {
    geometry = BUILDERS[key]()
    geometries.set(key, geometry)
  }
  return geometry
}

/** Knob to tip, metres. */
export const batLength = (id) => {
  const box = getBatGeometry(id).boundingBox
  return box.max.y
}

// --- Avatars' bats --------------------------------------------------------------------

let avatarMaterial = null

/**
 * One avatar's bat: a single mesh. `mesh.setBat(id)` dresses it as bat `id` (cheap, a
 * no-op when unchanged: it swaps in that bat's shared geometry). Every bat shares one
 * material, and so one program. Placed every frame by its holder.
 */
export function createBatMesh() {
  avatarMaterial ??= createBatMaterial(false)
  const mesh = new Mesh(getBatGeometry('bicycle'), avatarMaterial)
  mesh.frustumCulled = false
  let shown = 'bicycle'
  mesh.setBat = (id) => {
    if (id === shown) return
    shown = id
    mesh.geometry = getBatGeometry(id)
  }
  return mesh
}

/**
 * Lets an avatar's bat go. Its geometry and material are shared by every bat (and the
 * shop), built once and kept, so there's nothing of its own to free - and it's left where
 * it is in the scene: React owns that (taking it out here lost the bat for good whenever
 * React re-ran the effect, as StrictMode does on every mount in dev).
 */
// eslint-disable-next-line no-unused-vars
export function disposeBatMesh(mesh) {}

// --- The bat shop's showcase ------------------------------------------------------------

/**
 * Every bat in `entries` (`{ id, x, y, z, phase }`: the bat and where it floats) in one
 * mesh and one draw call: each `scale` times its size, upright, centred on its spot, and
 * turned and bobbed on it by the vertex shader (phase staggers them). Free it with
 * disposeBatShowcase.
 */
export function createBatShowcase(entries, scale = 1) {
  const parts = entries.map(({ id, x, y, z, phase }) => {
    const g = getBatGeometry(id).clone()
    const box = g.boundingBox
    // Centred on its middle, leaning back a touch.
    g.translate(0, -(box.min.y + box.max.y) / 2, 0)
    g.applyMatrix4(at(0, 0, 0, -0.1, 0, 0, scale))
    const count = g.getAttribute('position').count
    const centres = new Float32Array(count * 3)
    for (let i = 0; i < count; i += 1) {
      centres[i * 3] = x
      centres[i * 3 + 1] = y
      centres[i * 3 + 2] = z
    }
    g.setAttribute('aCenter', new BufferAttribute(centres, 3))
    g.setAttribute('aPhase', new BufferAttribute(new Float32Array(count).fill(phase), 1))
    return g
  })
  const geometry = mergeGeometries(parts, false)
  for (const part of parts) part.dispose()
  const mesh = new Mesh(geometry, createBatMaterial(true))
  // Each bat is built round the origin and moved to its spot by the vertex shader, so the
  // geometry's own bounds are useless: the sphere is set from the spots instead (padded
  // for a bat's size and bob), and the whole shop is skipped only when it's out of view.
  const centre = new Vector3()
  for (const e of entries) centre.add(new Vector3(e.x, e.y, e.z))
  centre.divideScalar(Math.max(1, entries.length))
  let radius = 0
  for (const e of entries) radius = Math.max(radius, Math.hypot(e.x - centre.x, e.y - centre.y, e.z - centre.z))
  geometry.boundingSphere = new Sphere(centre, radius + 4 * scale + 2)
  mesh.frustumCulled = true
  return mesh
}

export function disposeBatShowcase(mesh) {
  mesh.geometry.dispose()
  mesh.material.dispose()
}

/** Triangles in bat `id` (for budgets and tests). */
export const batTriangles = (id) => getBatGeometry(id).index.count / 3
