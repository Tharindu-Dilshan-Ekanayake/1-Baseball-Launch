import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three'

import { getQuality } from '../../store/quality'
import { glowTime } from '../glow'
import { ballLook, ballStyle } from '../balls'
import { COS, SIN, TIRE_SIZE } from './path'
import { roll } from './rollControl'

/**
 * The hit ball's trail: a glowing comet tail streaming out behind it, in the ball's own
 * colours (balls.js head to tail; every colour of the rainbow, flowing, behind the Rainbow
 * Ball; fire behind a PERFECT hit with a plain ball). It follows where the ball has been over
 * the last TRAIL_TIME, so the faster the ball, the longer the streak, and it shrinks
 * away by itself once the ball comes to rest. Two layers, so it reads from any angle:
 *  - a smooth ribbon, widest at the ball and tapering to nothing, bright down its middle
 *    and soft at its edges - the streak you see from the side;
 *  - a string of soft glowing discs down the same path, shrinking and fading towards
 *    the tip - the comet's cone you see from the chase camera, which looks along the
 *    path, where a ribbon is edge-on.
 * On presets with particles, what flies off it is the ball's own (balls.js `fx`): the Fire
 * Ball spits flames and embers that rise and swirl, the Ice Ball sheds frost that drifts
 * down, the Lightning and Plasma Balls crackle with sparks, the Golden Ball glitters, the
 * Galaxy and Rainbow Balls shed stars and the Black Hole drags glowing matter in after it.
 *
 * Three draw calls at most: the ribbon (a strip of quads rebuilt each frame from a ring
 * of past positions), the discs and the sparkles (camera-facing instanced quads, fixed
 * pools). No textures, nothing allocated per frame, nothing drawn while no ball is
 * flying. The shaders are compiled when the field loads, so the first kick can't stutter.
 */

/** Seconds of the ball's path the ribbon covers, and the most positions it keeps. */
const TRAIL_TIME = 0.7
const SAMPLES = 64
/** The ribbon's half-width at the ball, as a share of the ball's size. */
const HEAD_WIDTH = 0.95
/** Glowing discs down the path, and the first one's radius as a share of the ball's size. */
const ORBS = 20
const ORB_SIZE = 2.1

const PERFECT_HEAD = new Color('#fff27a')
const PERFECT_TAIL = new Color('#ff3b3b')
const WHITE = new Color('#ffffff')

/** Sparkles alive at once, how long each lasts (seconds) and how many a second. */
const SPARKLES = 64
const SPARKLE_LIFE = 0.7
const SPARKLE_RATE = 26

/**
 * What flies off each kind of ball: how many a second (times SPARKLE_RATE), how long they
 * last (times SPARKLE_LIFE), how big (times the ball), their drift (`rise` up, `spread`
 * sideways, `pull` towards the ball) and colours.
 */
const FX = {
  none: { rate: 0.6, life: 1, size: 1, rise: 2, spread: 3, pull: 0, colors: ['#ffffff'] },
  fire: { rate: 2.4, life: 0.9, size: 1.5, rise: 4.5, spread: 2.2, pull: 0, colors: ['#fff27a', '#ffb21a', '#ff5a14', '#ff2a00'] },
  frost: { rate: 1.6, life: 1.2, size: 1, rise: -1.5, spread: 2.5, pull: 0, colors: ['#ffffff', '#bff4ff', '#7fd2ff'] },
  spark: { rate: 2, life: 0.35, size: 0.9, rise: 0, spread: 9, pull: 0, colors: ['#fff7a0', '#9ff4ff', '#ffffff'] },
  gold: { rate: 1.6, life: 1, size: 0.9, rise: 1, spread: 2.5, pull: 0, colors: ['#ffe27a', '#ffffff', '#ffc21a'] },
  smoke: { rate: 2.2, life: 1, size: 1.6, rise: 3, spread: 2, pull: 0, colors: ['#ffd27a', '#ff7a1a', '#c2410c'] },
  stars: { rate: 1.6, life: 1.1, size: 1.1, rise: 0.5, spread: 3.5, pull: 0, colors: ['#ffffff', '#ff7ad9', '#7fd2ff', '#ffe27a'] },
  void: { rate: 2, life: 0.8, size: 1, rise: 0, spread: 6, pull: 7, colors: ['#d18bff', '#ffb3ff', '#7a3cff'] },
}
const FX_COLORS = Object.fromEntries(Object.entries(FX).map(([id, fx]) => [id, fx.colors.map((c) => new Color(c))]))

const ribbonVertex = /* glsl */ `
  attribute vec2 aTrail;
  varying vec2 vTrail;
  void main() {
    vTrail = aTrail;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
/** The trail's colour `f` of the way from the ball (0) to the tip (1): both layers use it. */
const TRAIL_COLOR = /* glsl */ `
  uniform vec3 uHead;
  uniform vec3 uTail;
  uniform float uRainbow;
  uniform float uTime;
  vec3 hue(float h) {
    return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  }
  vec3 trailColor(float f) {
    return mix(mix(uHead, uTail, f), hue(f * 1.3 - uTime * 0.9) * 0.85 + 0.15, uRainbow);
  }
`
const ribbonFragment = /* glsl */ `
  ${TRAIL_COLOR}
  varying vec2 vTrail;
  void main() {
    // x runs 0 at the ball to 1 at the tail's tip; y -1..1 across the ribbon.
    float f = vTrail.x;
    float across = 1.0 - abs(vTrail.y);
    float body = smoothstep(0.0, 0.8, across);
    float core = smoothstep(0.6, 1.0, across);
    float along = pow(1.0 - f, 1.3);
    // Faded right at the ball, so the glow never washes over the ball itself.
    float head = smoothstep(0.0, 0.08, f);
    vec3 col = trailColor(f);
    col = mix(col, vec3(1.0), core * 0.55 * (1.0 - f));
    float alpha = min(1.0, body * 0.85 + core * 0.45) * along * head;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(col, alpha);
    #include <colorspace_fragment>
  }
`

const orbVertex = /* glsl */ `
  attribute vec2 aOrb;
  varying vec2 vUv;
  varying vec2 vOrb;
  void main() {
    // A camera-facing quad at the instance's position, as big as its scale.
    vec3 centre = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    float size = length(instanceMatrix[0].xyz);
    vec4 mv = modelViewMatrix * vec4(centre, 1.0);
    mv.xy += position.xy * size;
    gl_Position = projectionMatrix * mv;
    vUv = uv;
    vOrb = aOrb;
  }
`
const orbFragment = /* glsl */ `
  ${TRAIL_COLOR}
  varying vec2 vUv;
  varying vec2 vOrb;
  void main() {
    // A soft disc, bright in the middle and easing out to nothing at its rim. x = how far
    // down the trail it is (0-1), y = its opacity.
    float r = length(vUv - 0.5) * 2.0;
    float glow = 1.0 - smoothstep(0.0, 1.0, r);
    float alpha = glow * (0.4 + 0.6 * glow) * vOrb.y;
    if (alpha < 0.01) discard;
    vec3 col = mix(trailColor(vOrb.x), vec3(1.0), (1.0 - smoothstep(0.0, 0.45, r)) * 0.45 * (1.0 - vOrb.x));
    gl_FragColor = vec4(col, alpha);
    #include <colorspace_fragment>
  }
`

const sparkleVertex = /* glsl */ `
  attribute float aFade;
  varying vec3 vColor;
  varying vec2 vUv;
  varying float vFade;
  void main() {
    // A camera-facing quad at the instance's position, as big as its scale.
    vec3 centre = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    float size = length(instanceMatrix[0].xyz);
    vec4 mv = modelViewMatrix * vec4(centre, 1.0);
    mv.xy += position.xy * size;
    gl_Position = projectionMatrix * mv;
    vColor = instanceColor;
    vUv = uv;
    vFade = aFade;
  }
`
const sparkleFragment = /* glsl */ `
  varying vec3 vColor;
  varying vec2 vUv;
  varying float vFade;
  void main() {
    // A four-pointed twinkle: a bright dot with two thin crossed rays.
    vec2 p = (vUv - 0.5) * 2.0;
    float spot = 1.0 - smoothstep(0.0, 0.35, length(p));
    float rays = (1.0 - smoothstep(0.0, 0.08, abs(p.x))) * (1.0 - smoothstep(0.2, 1.0, abs(p.y)))
      + (1.0 - smoothstep(0.0, 0.08, abs(p.y))) * (1.0 - smoothstep(0.2, 1.0, abs(p.x)));
    float alpha = clamp(spot + rays * 0.8, 0.0, 1.0) * vFade;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(mix(vColor, vec3(1.0), spot * 0.6), alpha);
    #include <colorspace_fragment>
  }
`

const DOWN_FIELD = new Vector3(0, -SIN, -COS)

/** The ball's recent path: a ring of positions and the time each was taken (seconds). */
const path = { xyz: new Float32Array(SAMPLES * 3), t: new Float64Array(SAMPLES), head: 0, count: 0 }

const sparkles = Array.from({ length: SPARKLES }, () => ({ life: 0, max: SPARKLE_LIFE, pull: 0, pos: new Vector3(), vel: new Vector3(), size: 1 }))

const _a = new Vector3()
const _b = new Vector3()
const _p = new Vector3()
const _tangent = new Vector3()
const _toCam = new Vector3()
const _side = new Vector3()
const _m = new Matrix4()
const _q = new Quaternion()
const _s = new Vector3()
const _zero = new Matrix4().makeScale(0, 0, 0)
const _head = new Color()
const _tail = new Color()

/** Position `k` steps back from the newest (0), into `out`. */
function sample(k, out) {
  const i = ((path.head - k) % SAMPLES + SAMPLES) % SAMPLES
  return out.set(path.xyz[i * 3], path.xyz[i * 3 + 1], path.xyz[i * 3 + 2])
}

function createRibbon() {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(SAMPLES * 2 * 3), 3))
  geometry.setAttribute('aTrail', new BufferAttribute(new Float32Array(SAMPLES * 2 * 2), 2))
  // Two triangles between each pair of samples, laid out once for the longest ribbon.
  const index = []
  for (let i = 0; i < SAMPLES - 1; i += 1) {
    const a = i * 2
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
  }
  geometry.setIndex(index)
  geometry.setDrawRange(0, 0)
  const material = new ShaderMaterial({
    uniforms: {
      uHead: { value: new Color('#ffffff') },
      uTail: { value: new Color('#ffffff') },
      uRainbow: { value: 0 },
      uTime: glowTime,
    },
    vertexShader: ribbonVertex,
    fragmentShader: ribbonFragment,
    // Normal blending, not additive: added onto the bright turf and sky, the ball's colour
    // washed out to white.
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  })
  const mesh = new Mesh(geometry, material)
  mesh.frustumCulled = false
  mesh.renderOrder = 5
  return mesh
}

/** The discs share the ribbon's colour uniforms (the same objects, set once a kick). */
function createOrbs(uniforms) {
  const geometry = new PlaneGeometry(1, 1)
  geometry.setAttribute('aOrb', new InstancedBufferAttribute(new Float32Array(ORBS * 2), 2))
  const material = new ShaderMaterial({ uniforms, vertexShader: orbVertex, fragmentShader: orbFragment, transparent: true, depthWrite: false })
  const mesh = new InstancedMesh(geometry, material, ORBS)
  for (let i = 0; i < ORBS; i += 1) mesh.setMatrixAt(i, _zero)
  mesh.count = 0
  mesh.frustumCulled = false
  mesh.renderOrder = 4
  return mesh
}

function createSparkles() {
  const geometry = new PlaneGeometry(1, 1)
  geometry.setAttribute('aFade', new InstancedBufferAttribute(new Float32Array(SPARKLES), 1))
  const material = new ShaderMaterial({
    vertexShader: sparkleVertex,
    fragmentShader: sparkleFragment,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  })
  const mesh = new InstancedMesh(geometry, material, SPARKLES)
  // Coloured once, so the colour attribute exists before the shader compiles.
  for (let i = 0; i < SPARKLES; i += 1) {
    mesh.setMatrixAt(i, _zero)
    mesh.setColorAt(i, WHITE)
  }
  mesh.frustumCulled = false
  mesh.renderOrder = 6
  return mesh
}

export function TireTrail() {
  const ribbonRef = useRef(null)
  const orbRef = useRef(null)
  const sparkleRef = useRef(null)
  /** The hit (its startedAt) the trail was last reset for; sparkles owed; the next slot; its fx. */
  const state = useRef({ kick: -1, owed: 0, next: 0, fx: 'none' })
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const scene = useThree((s) => s.scene)

  const assets = useMemo(() => {
    const ribbon = createRibbon()
    return { ribbon, orbs: createOrbs(ribbon.material.uniforms), sparkles: createSparkles() }
  }, [])

  // Compiled now, while the field loads, rather than on the first kick (each mesh as
  // itself: the discs' and sparkles' programs are the instanced ones).
  useEffect(() => {
    // (Not in dev: StrictMode's remount disposes materials mid-compile - ShaderWarmup.)
    if (import.meta.env.DEV) return
    for (const mesh of [assets.ribbon, assets.orbs, assets.sparkles]) gl.compileAsync?.(mesh, camera, scene)?.catch(() => null)
  }, [gl, camera, scene, assets])

  useEffect(
    () => () => {
      path.count = 0
      for (const s of sparkles) s.life = 0
      for (const mesh of [assets.ribbon, assets.orbs, assets.sparkles]) {
        mesh.geometry.dispose()
        mesh.material.dispose()
      }
      assets.orbs.dispose()
      assets.sparkles.dispose()
    },
    [assets],
  )

  useFrame((_frame, rawDelta) => {
    const ribbon = ribbonRef.current
    const orbs = orbRef.current
    const sparkleMesh = sparkleRef.current
    if (!ribbon || !orbs || !sparkleMesh) return
    const delta = Math.min(rawDelta, 0.05)
    const now = performance.now() / 1000
    const st = state.current
    const flying = roll.active && roll.phase === 'ride' && !roll.crashed

    // A new hit: forget the last one's path and set this ball's colours.
    if (roll.active && st.kick !== roll.startedAt) {
      st.kick = roll.startedAt
      path.count = 0
      const look = ballLook(roll.ballId)
      const style = ballStyle(roll.ballId)
      // A PERFECT hit sets a plain ball on fire; a ball with its own fire keeps it.
      const blaze = roll.hit === 'perfect' && !style.fx
      _head.copy(blaze ? PERFECT_HEAD : look.head)
      _tail.copy(blaze ? PERFECT_TAIL : look.tail)
      const u = ribbon.material.uniforms
      u.uHead.value.copy(_head)
      u.uTail.value.copy(_tail)
      u.uRainbow.value = style.rainbow ? 1 : 0
      st.fx = style.fx || (blaze ? 'fire' : 'none')
    }

    // Where the ball is now, added to its path while it flies and bounces.
    if (flying) {
      path.head = (path.head + 1) % SAMPLES
      roll.position.toArray(path.xyz, path.head * 3)
      path.t[path.head] = now
      path.count = Math.min(SAMPLES, path.count + 1)
    }

    // --- The ribbon: from the ball back along its path, as far as TRAIL_TIME ago. ---
    let n = 0
    while (n < path.count && now - path.t[((path.head - n) % SAMPLES + SAMPLES) % SAMPLES] < TRAIL_TIME) n += 1
    if (n < 2) {
      ribbon.geometry.setDrawRange(0, 0)
      ribbon.visible = false
      orbs.count = 0
    } else {
      const pos = ribbon.geometry.getAttribute('position')
      const trail = ribbon.geometry.getAttribute('aTrail')
      const width = HEAD_WIDTH * (roll.size || TIRE_SIZE)
      for (let k = 0; k < n; k += 1) {
        sample(k, _p)
        // Along the path here (from the older neighbour to the newer one)...
        sample(Math.max(0, k - 1), _a)
        sample(Math.min(n - 1, k + 1), _b)
        _tangent.subVectors(_a, _b)
        if (_tangent.lengthSq() < 1e-8) _tangent.copy(DOWN_FIELD)
        // ...and across it, turned to face the camera.
        _toCam.subVectors(camera.position, _p)
        _side.crossVectors(_tangent, _toCam)
        if (_side.lengthSq() < 1e-8) _side.set(1, 0, 0)
        _side.normalize()
        const f = k / (n - 1)
        const w = width * Math.pow(1 - f, 0.7)
        pos.setXYZ(k * 2, _p.x - _side.x * w, _p.y - _side.y * w, _p.z - _side.z * w)
        pos.setXYZ(k * 2 + 1, _p.x + _side.x * w, _p.y + _side.y * w, _p.z + _side.z * w)
        trail.setXY(k * 2, f, -1)
        trail.setXY(k * 2 + 1, f, 1)
      }
      pos.needsUpdate = true
      trail.needsUpdate = true
      ribbon.geometry.setDrawRange(0, (n - 1) * 6)
      ribbon.visible = true

      // --- The discs: spread evenly down the same stretch, from just behind the ball. ---
      const orb = orbs.geometry.getAttribute('aOrb')
      const size = ORB_SIZE * (roll.size || TIRE_SIZE)
      for (let j = 0; j < ORBS; j += 1) {
        const f = (j + 0.6) / ORBS
        sample(Math.min(n - 1, Math.round(f * (n - 1))), _p)
        _s.setScalar(size * Math.pow(1 - f, 0.8))
        orbs.setMatrixAt(j, _m.compose(_p, _q, _s))
        orb.setXY(j, f, 0.75 * Math.pow(1 - f, 1.1))
      }
      orbs.count = ORBS
      orbs.instanceMatrix.needsUpdate = true
      orb.needsUpdate = true
    }

    // --- Sparkles drifting off it (presets with particles only). ---
    const fades = sparkleMesh.geometry.getAttribute('aFade')
    let colored = false
    if (flying && roll.speed > 4 && getQuality().particles) {
      const fx = FX[st.fx] || FX.none
      const colors = FX_COLORS[st.fx] || FX_COLORS.none
      st.owed += delta * SPARKLE_RATE * fx.rate
      while (st.owed >= 1) {
        st.owed -= 1
        const i = st.next
        st.next = (st.next + 1) % SPARKLES
        const s = sparkles[i]
        s.max = SPARKLE_LIFE * fx.life * (0.7 + Math.random() * 0.6)
        s.life = s.max
        s.pull = fx.pull
        const r = (roll.size || TIRE_SIZE) * (fx.pull ? 3 : 0.9)
        s.pos.copy(roll.position).add(_a.set((Math.random() - 0.5) * r, (Math.random() - 0.5) * r, (Math.random() - 0.5) * r))
        s.vel.set((Math.random() - 0.5) * fx.spread, fx.rise * (0.5 + Math.random()), (Math.random() - 0.5) * fx.spread)
        s.size = (roll.size || TIRE_SIZE) * fx.size * (0.35 + Math.random() * 0.35)
        const pick = colors[i % colors.length]
        sparkleMesh.setColorAt(i, st.fx === 'none' && i % 3 !== 0 ? ribbon.material.uniforms.uHead.value : pick)
        colored = true
      }
    } else {
      st.owed = 0
    }
    let alive = false
    for (let i = 0; i < SPARKLES; i += 1) {
      const s = sparkles[i]
      if (s.life <= 0) continue
      s.life -= delta
      if (s.life <= 0) {
        s.life = 0
        sparkleMesh.setMatrixAt(i, _zero)
        fades.setX(i, 0)
        continue
      }
      alive = true
      s.vel.multiplyScalar(1 - delta * 2)
      // The Black Hole's: dragged in after the ball.
      if (s.pull && roll.active) s.vel.addScaledVector(_b.subVectors(roll.position, s.pos), s.pull * delta)
      s.pos.addScaledVector(s.vel, delta)
      const age = 1 - s.life / s.max
      // Twinkling as it fades.
      _s.setScalar(s.size * (1 - age * 0.5))
      sparkleMesh.setMatrixAt(i, _m.compose(s.pos, _q, _s))
      fades.setX(i, (1 - age) * (0.7 + 0.3 * Math.sin(age * 40 + i)))
    }
    sparkleMesh.visible = alive
    if (alive) {
      sparkleMesh.instanceMatrix.needsUpdate = true
      fades.needsUpdate = true
    }
    if (colored && sparkleMesh.instanceColor) sparkleMesh.instanceColor.needsUpdate = true
  })

  return (
    <>
      <primitive ref={orbRef} object={assets.orbs} />
      <primitive ref={ribbonRef} object={assets.ribbon} />
      <primitive ref={sparkleRef} object={assets.sparkles} />
    </>
  )
}

export default TireTrail
