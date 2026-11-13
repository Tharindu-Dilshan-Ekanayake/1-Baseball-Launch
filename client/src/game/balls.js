import { Color, InstancedBufferAttribute, InstancedMesh, MeshLambertMaterial, SphereGeometry } from 'three'

import { glowTime } from './glow'

/**
 * How every ball in the Ball Shop looks and burns (shared/balance.js BALLS: names and
 * stats). Colours are sRGB hex.
 *
 *   look     what the ball's painter draws (BALL_LOOK)
 *   a, b, c  base, pattern and accent colours (the stitches on a baseball)
 *   glow     how much it shines on its own (0-1)
 *   head     the trail's colour at the ball; `tail` at its tip
 *   rainbow  the trail runs through every colour
 *   fx       what flies off it in the air: 'fire' (flames and embers), 'frost',
 *            'spark' (electric), 'gold' (glitter), 'smoke' (meteor), 'stars', 'void' -
 *            or nothing
 *
 * The UI uses `a`, `b` and `head` for its swatches; the game draws the rest
 * (BallFlight.jsx, TireTrail.jsx).
 */
export const BALL_LOOK = {
  STITCHED: 0,
  BANDED: 1,
  FLAME: 2,
  CRYSTAL: 3,
  CRACKED: 4,
  GLOSS: 5,
  RAINBOW: 6,
  GALAXY: 7,
  VOID: 8,
}

const L = BALL_LOOK

export const BALL_STYLES = {
  baseball: { look: L.STITCHED, a: '#f7f4ec', b: '#e8e2d2', c: '#e0262f', glow: 0, head: '#ffffff', tail: '#bfe6ff' },
  leather: { look: L.STITCHED, a: '#b5743c', b: '#8f5428', c: '#f6efe0', glow: 0, head: '#ffd9a8', tail: '#c88a50' },
  bouncy: { look: L.BANDED, a: '#ff3fa4', b: '#ffe14a', c: '#ffffff', glow: 0.1, head: '#ff7ac8', tail: '#ffe14a' },
  fire: { look: L.FLAME, a: '#ff3b0a', b: '#ffb21a', c: '#fff27a', glow: 0.75, head: '#fff27a', tail: '#ff2a00', fx: 'fire' },
  ice: { look: L.CRYSTAL, a: '#bff4ff', b: '#4fb8ff', c: '#ffffff', glow: 0.3, head: '#e8fbff', tail: '#3f9cff', fx: 'frost' },
  lightning: { look: L.CRACKED, a: '#1a2a66', b: '#ffe83a', c: '#9ff4ff', glow: 0.45, head: '#fff7a0', tail: '#4fd2ff', fx: 'spark' },
  golden: { look: L.STITCHED, a: '#ffcc1f', b: '#ffe98a', c: '#ffffff', glow: 0.35, head: '#fff3a8', tail: '#ffb000', fx: 'gold' },
  meteor: { look: L.CRACKED, a: '#2a1a14', b: '#ff5a14', c: '#ffd21f', glow: 0.55, head: '#ffd27a', tail: '#ff3b00', fx: 'smoke' },
  plasma: { look: L.GLOSS, a: '#22e6ff', b: '#ff3df2', c: '#ffffff', glow: 0.8, head: '#9ff8ff', tail: '#ff3df2', fx: 'spark' },
  rainbow: { look: L.RAINBOW, a: '#ffffff', b: '#ffffff', c: '#ffffff', glow: 0.4, head: '#ffffff', tail: '#ff7ad9', rainbow: true, fx: 'stars' },
  galaxy: { look: L.GALAXY, a: '#140a33', b: '#7a3cff', c: '#5fd6ff', glow: 0.35, head: '#c69bff', tail: '#3f6bff', fx: 'stars' },
  blackhole: { look: L.VOID, a: '#030208', b: '#b14dff', c: '#ffb3ff', glow: 0.6, head: '#d18bff', tail: '#1a0633', fx: 'void' },
}

const FALLBACK = BALL_STYLES.baseball

// Parsed once: frame code looks colours up without allocating.
const PARSED = Object.fromEntries(
  Object.entries(BALL_STYLES).map(([id, s]) => [
    id,
    { ...s, a: new Color(s.a), b: new Color(s.b), c: new Color(s.c), head: new Color(s.head), tail: new Color(s.tail), glow: s.glow ?? 0 },
  ]),
)

/** Ball `id`'s parsed look (Colors), never null. */
export const ballLook = (id) => PARSED[id] || PARSED.baseball
/** Ball `id`'s style as hex (for the UI). */
export const ballStyle = (id) => BALL_STYLES[id] || FALLBACK
/** The colour of ball `id`'s trail at the ball. */
export const ballTrail = (id) => ballLook(id).head

// --- The ball's painter ------------------------------------------------------------------

/**
 * Paints a ball, in GLSL: `p` is the point on the unit sphere (the ball's own frame, so
 * the pattern spins with it), `t` a clock for the animated ones. Returns the colour and
 * how much it glows (0-1). One evaluation of one noise and one cell pattern, picked by
 * the look - cheap to compile and to run.
 */
export const BALL_GLSL = /* glsl */ `
  float bHash(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.x + p.y) * p.z);
  }
  float bNoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = bHash(i);
    float n100 = bHash(i + vec3(1.0, 0.0, 0.0));
    float n010 = bHash(i + vec3(0.0, 1.0, 0.0));
    float n110 = bHash(i + vec3(1.0, 1.0, 0.0));
    float n001 = bHash(i + vec3(0.0, 0.0, 1.0));
    float n101 = bHash(i + vec3(1.0, 0.0, 1.0));
    float n011 = bHash(i + vec3(0.0, 1.0, 1.0));
    float n111 = bHash(i + vec3(1.0, 1.0, 1.0));
    return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y), mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
  }
  // Distance to the nearest cell edge (small near an edge): cracks and facets.
  float bCells(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    float d1 = 8.0;
    float d2 = 8.0;
    for (int z = -1; z <= 1; z++) {
      for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
          vec3 g = vec3(float(x), float(y), float(z));
          vec3 o = vec3(bHash(i + g), bHash(i + g + 7.1), bHash(i + g + 3.7));
          vec3 r = g + o - f;
          float d = dot(r, r);
          if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
        }
      }
    }
    return sqrt(d2) - sqrt(d1);
  }
  vec3 bHue(float h) {
    return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  }
  vec4 ballLook(vec3 p, float look, vec3 a, vec3 b, vec3 c, float glow, float t) {
    int k = int(look + 0.5);
    vec3 col = a;
    float emit = glow * 0.25;
    // The cell pattern, evaluated once (its loop unrolled in one place only: compiling it
    // per branch made the program slow to build on a phone-speed CPU).
    float e = (k == 3 || k == 4) ? bCells(p * (k == 3 ? 3.2 : 3.0) + vec3(0.0, k == 4 ? t * 0.15 : 0.0, 0.0)) : 1.0;
    if (k == 0) {
      // A stitched baseball: two lobes of leather, the seam curving round between them,
      // a row of red stitches either side of it.
      float th = atan(p.z, p.x);
      float seamY = 0.55 * cos(2.0 * th);
      float d = abs(p.y - seamY * sqrt(max(0.0, 1.0 - p.y * p.y)) * 1.15);
      col = mix(a, b, bNoise(p * 6.0) * 0.5);
      col = mix(col, b * 0.82, 1.0 - smoothstep(0.015, 0.03, d));
      float stitch = step(0.5, fract(th * 9.0 + p.y * 3.0)) * (1.0 - smoothstep(0.04, 0.075, d)) * smoothstep(0.03, 0.045, d);
      col = mix(col, c, stitch);
      emit = glow * stitch + glow * 0.2;
    } else if (k == 1) {
      // A bouncy rubber ball: a fat stripe round its middle, thin ones beside it.
      float y = abs(p.y);
      col = mix(a, b, 1.0 - smoothstep(0.2, 0.23, y));
      col = mix(col, c, (1.0 - smoothstep(0.0, 0.03, abs(y - 0.33))) * 0.9);
    } else if (k == 2) {
      // Fire: flames licking over it, white-hot where they're thickest.
      float n = bNoise(p * 3.5 + vec3(0.0, -t * 3.0, t * 0.7)) * 0.65 + bNoise(p * 8.0 + vec3(0.0, -t * 5.0, 0.0)) * 0.35;
      col = mix(a, b, smoothstep(0.3, 0.7, n));
      col = mix(col, c, smoothstep(0.62, 0.85, n));
      emit = 0.55 + 0.45 * n;
    } else if (k == 3) {
      // Ice: crystal facets with bright edges and a twinkle.
      col = mix(a, b, bNoise(p * 4.0) * 0.6);
      col = mix(col, c, 1.0 - smoothstep(0.0, 0.08, e));
      emit = glow * (0.5 + 0.5 * (1.0 - smoothstep(0.0, 0.08, e)));
    } else if (k == 4) {
      // Cracked: a dark shell split by glowing seams that pulse (lightning, meteor).
      float crack = 1.0 - smoothstep(0.0, 0.07, e);
      float pulse = 0.7 + 0.3 * sin(t * 6.0 + p.y * 4.0);
      col = mix(a, mix(b, c, bNoise(p * 5.0 + t)), crack);
      emit = crack * pulse + glow * 0.1;
    } else if (k == 5) {
      // Plasma: two colours swirling round each other, glowing.
      float s = sin(atan(p.z, p.x) * 3.0 + p.y * 5.0 - t * 4.0 + bNoise(p * 3.0 + t) * 3.0);
      col = mix(a, b, smoothstep(-0.4, 0.4, s));
      col = mix(col, c, smoothstep(0.85, 1.0, s));
      emit = 0.5 + 0.3 * abs(s);
    } else if (k == 6) {
      // Rainbow bands rolling over it.
      col = mix(bHue(fract(p.y * 0.6 + atan(p.z, p.x) * 0.08 - t * 0.4)), vec3(1.0), 0.12);
      emit = 0.35;
    } else if (k == 7) {
      // A galaxy: nebula clouds and twinkling stars.
      float n = bNoise(p * 2.5 + t * 0.1) * 0.6 + bNoise(p * 6.0) * 0.4;
      col = mix(a, b, smoothstep(0.35, 0.75, n));
      col = mix(col, c, smoothstep(0.7, 0.95, n) * 0.8);
      float star = step(0.985, bHash(floor(p * 22.0))) * (0.5 + 0.5 * sin(t * 5.0 + bHash(floor(p * 22.0) + 3.0) * 30.0));
      col = mix(col, vec3(1.0), star);
      emit = star + smoothstep(0.7, 0.95, n) * 0.4;
    } else {
      // A black hole: pitch black, a glowing disc of matter swirling round its equator.
      float swirl = bNoise(vec3(atan(p.z, p.x) * 3.0 - t * 3.0, p.y * 8.0, 0.0));
      float disc = (1.0 - smoothstep(0.0, 0.22, abs(p.y))) * (0.5 + 0.5 * swirl);
      col = mix(a, mix(b, c, swirl), disc);
      emit = disc;
    }
    return vec4(col, emit);
  }
`

const BALL_VERTEX_HEAD = /* glsl */ `
  attribute vec3 aBallA;
  attribute vec3 aBallB;
  attribute vec3 aBallC;
  attribute vec2 aBallStyle;
  varying vec3 vBallP;
  varying vec3 vBallA;
  varying vec3 vBallB;
  varying vec3 vBallC;
  varying vec2 vBallStyle;
`

let ballGeometry = null
let ballMaterial = null

function getBallMaterial() {
  if (ballMaterial) return ballMaterial
  const material = new MeshLambertMaterial({ color: 0xffffff })
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBallTime = glowTime
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${BALL_VERTEX_HEAD}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBallP = normalize(position); vBallA = aBallA; vBallB = aBallB; vBallC = aBallC; vBallStyle = aBallStyle;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uBallTime;
        varying vec3 vBallP;
        varying vec3 vBallA;
        varying vec3 vBallB;
        varying vec3 vBallC;
        varying vec2 vBallStyle;
        ${BALL_GLSL}`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        vec4 ballPaint = ballLook(vBallP, vBallStyle.x, vBallA, vBallB, vBallC, vBallStyle.y, uBallTime);
        diffuseColor.rgb = ballPaint.rgb;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        // Its own glow, and a rim of light round the edge for the ones that burn.
        float ballRim = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 2.0);
        totalEmissiveRadiance += ballPaint.rgb * ballPaint.a * 0.9 + vBallC * ballRim * vBallStyle.y * 0.8;`,
      )
  }
  material.customProgramCacheKey = () => 'ball-v1'
  ballMaterial = material
  return material
}

/**
 * Up to `max` balls in one draw call: `mesh.setBall(i, id)` dresses instance i as ball
 * `id` (cheap; a no-op when unchanged). The sphere and material are shared by every ball
 * mesh; disposeBallMesh frees only the instance data. The sphere has radius 1: scale
 * each instance to the ball's size.
 */
export function createBallMesh(max) {
  ballGeometry ??= new SphereGeometry(1, 22, 14)
  const geometry = ballGeometry.clone()
  const attr = (name, size) => {
    const a = new InstancedBufferAttribute(new Float32Array(max * size), size)
    geometry.setAttribute(name, a)
    return a
  }
  const aA = attr('aBallA', 3)
  const aB = attr('aBallB', 3)
  const aC = attr('aBallC', 3)
  const aStyle = attr('aBallStyle', 2)
  const mesh = new InstancedMesh(geometry, getBallMaterial(), max)
  mesh.frustumCulled = false
  const dressed = new Array(max).fill(null)
  mesh.setBall = (i, id) => {
    if (dressed[i] === id) return
    dressed[i] = id
    const s = ballLook(id)
    aA.setXYZ(i, s.a.r, s.a.g, s.a.b)
    aB.setXYZ(i, s.b.r, s.b.g, s.b.b)
    aC.setXYZ(i, s.c.r, s.c.g, s.c.b)
    aStyle.setXY(i, s.look, s.glow)
    aA.needsUpdate = true
    aB.needsUpdate = true
    aC.needsUpdate = true
    aStyle.needsUpdate = true
  }
  return mesh
}

export function disposeBallMesh(mesh) {
  mesh.geometry.dispose()
  mesh.dispose()
}
