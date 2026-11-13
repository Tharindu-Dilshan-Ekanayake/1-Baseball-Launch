import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Color, Matrix4, Quaternion, Vector3 } from 'three'

import { ROLL_RECOVERY } from '@shared/balance'
import { BATTER_YAW, PAD_YAW } from '@shared/world'

import { batBase } from '../bats'

import { remotePlayers } from '../../net/remotePlayers'
import { getQuality } from '../../store/quality'
import { createBoxInstances, disposeBlocks } from '../blocks'
import { RUN_CADENCE } from '../kick'
import { sharedMaterials, STYLE } from '../materials'
import { runtime } from '../runtime'
import { hideNameplatesFrom, NAMEPLATE_POOL_SIZE, placeNameplate } from './nameplates'

/** Remote players are drawn this far in the past, so 10 Hz updates interpolate. */
const INTERP_DELAY_MS = 110
const MAX_REMOTES = 8
/** Six blocks of body and one of bat. */
const PARTS = 7
const S = 0.36

/** Classic blocky figure, in studs-scaled units: [x, y(pivot), size, hangs from pivot]. */
const PART_LAYOUT = [
  { key: 'head', pos: [0, 1.62, 0], size: [1.2 * S, 1 * S, 1 * S] },
  { key: 'torso', pos: [0, 1.08, 0], size: [2 * S, 2 * S, 1 * S] },
  { key: 'armL', pos: [-1.5 * S, 1.44, 0], size: [1 * S, 2 * S, 1 * S], swing: -1 },
  { key: 'armR', pos: [1.5 * S, 1.44, 0], size: [1 * S, 2 * S, 1 * S], swing: 1 },
  { key: 'legL', pos: [-0.5 * S, 0.72, 0], size: [1 * S, 2 * S, 1 * S], swing: 1 },
  { key: 'legR', pos: [0.5 * S, 0.72, 0], size: [1 * S, 2 * S, 1 * S], swing: -1 },
]

// Parsed once: setColorAt runs for every limb of every player, every frame.
const palette = (list) => list.map((c) => new Color(c))
const SHIRTS = palette(['#e8423a', '#2f7fe6', '#3ccf4e', '#9b4dff', '#ff9a1f', '#1d1f26', '#ffffff', '#ff5fa8'])
const PANTS = palette(['#2d3a5c', '#1d1f26', '#4a3a2a', '#3a3a46', '#2f5aa8'])
const SKINS = palette(['#f5cd47', '#e8b48a', '#c98a5a', '#8a5a3a', '#ffd9b3'])

function hashString(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

const _m = new Matrix4()
const _base = new Matrix4()
const _local = new Matrix4()
const _rot = new Matrix4()
const _scale = new Matrix4()
const _q = new Quaternion()
const _s = new Vector3()
const _v = new Vector3()
const _up = new Vector3(0, 1, 0)
const _target = new Vector3()
const _dir = new Vector3()
const _prev = new Vector3()
/** The bat across a figure's back (knob over the right shoulder), and held up at bat. */
const BAT_BACK = new Matrix4().compose(new Vector3(0.05, 1.2, -0.3), new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.7), new Vector3(0.17, 1.45, 0.17))
const BAT_UP = new Matrix4().compose(new Vector3(-0.35, 1.75, 0.0), new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -0.5), new Vector3(0.11, 0.95, 0.11))
const BAT_SWUNG = new Matrix4().compose(new Vector3(0.45, 1.6, 0.05), new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 1.0), new Vector3(0.11, 0.95, 0.11))
const _batColor = new Color()

function lerpAngle(a, b, t) {
  let d = b - a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}

/** Interpolates a remote player to `renderTime`. */
function interpolate(r, renderTime) {
  const snaps = r.snaps
  if (snaps.length === 0) return
  let i = snaps.length - 1
  while (i > 0 && snaps[i - 1].t > renderTime) i -= 1
  const b = snaps[i]
  const a = snaps[Math.max(0, i - 1)]
  const span = b.t - a.t
  const t = span > 0 ? Math.min(1, Math.max(0, (renderTime - a.t) / span)) : 1
  _prev.copy(r.position)
  r.position.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t)
  r.yaw = lerpAngle(a.r, b.r, t)
  // Drop snapshots we've moved past, keeping one to interpolate from.
  while (snaps.length > 2 && snaps[1].t < renderTime) snaps.shift()
}

/**
 * Writes one blocky figure's six parts from `base` (its feet), limbs swung by `swing`
 * (and arms by `armSwing`, if given, stretched `armStretch` times their length), and its
 * bat (`bat`: BAT_BACK, BAT_UP or BAT_SWUNG) in its bat's colour. Returns the next free
 * instance.
 */
function writeFigure(body, instance, r, base, swing, armSwing, armStretch = 1, bat = BAT_BACK) {
  const h = hashString(r.sessionId)
  const shirt = SHIRTS[h % SHIRTS.length]
  const pants = PANTS[(h >>> 8) % PANTS.length]
  const skin = SKINS[(h >>> 16) % SKINS.length]
  for (const part of PART_LAYOUT) {
    const hangs = part.swing !== undefined
    const isArm = part.key.startsWith('arm')
    const angle = hangs ? (isArm && armSwing !== null ? armSwing : swing * part.swing) : 0
    const long = isArm ? armStretch : 1
    _local.makeTranslation(part.pos[0], part.pos[1], part.pos[2])
    _rot.makeRotationX(angle)
    _scale.makeScale(part.size[0], part.size[1] * long, part.size[2])
    // Limbs hang from their pivot; head and torso are centred on theirs.
    if (hangs) _scale.setPosition(0, (-part.size[1] * long) / 2, 0)
    _m.copy(base).multiply(_local).multiply(_rot).multiply(_scale)
    body.setMatrixAt(instance, _m)
    // Classic look: shirt on the torso, trousers on the legs, bare arms and head.
    body.setColorAt(instance, part.key === 'torso' ? shirt : part.key.startsWith('leg') ? pants : skin)
    instance += 1
  }
  body.setMatrixAt(instance, _m.copy(base).multiply(bat))
  body.setColorAt(instance, _batColor.copy(batBase(r.tireId || 'bicycle')))
  return instance + 1
}

/** Puts a name tag over `at`, if it's on screen; returns the next free tag. */
function writeNameplate(plate, name, at, distance, maxDistance, camera, size, uid) {
  if (plate >= NAMEPLATE_POOL_SIZE) return plate
  if (distance < maxDistance) {
    _v.copy(at).project(camera)
    if (_v.z < 1) {
      const fade = Math.min(1, (maxDistance - distance) / 6)
      placeNameplate(plate, name, (_v.x * 0.5 + 0.5) * size.width, (-_v.y * 0.5 + 0.5) * size.height, fade, uid)
      return plate + 1
    }
  }
  placeNameplate(plate, '', null)
  return plate + 1
}

/**
 * Everyone else in the lobby: blocky avatars (one InstancedMesh for every limb and bat of
 * every player), name tags and their pets (handed to the shared pet renderer). Also works
 * out, once a frame for everyone, what the real avatars (RemoteAvatars) need: whether
 * they're mid-hit (`r.hitting`, `r.hitT` seconds since it started, `r.hitGrade`: their
 * ball itself flies in roll/BallFlight) or up at bat waiting on a pitch (`r.pulling`, anim
 * 'pull'). In a batting cage they swing. Hidden past the preset's draw distance.
 */
export function RemotePlayers() {
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const bodyRef = useRef(null)

  const assets = useMemo(() => {
    // Smooth toy boxes: the shared toy material, so no extra shader program.
    const body = createBoxInstances(MAX_REMOTES * PARTS, sharedMaterials().toy, STYLE.SMOOTH)
    body.castShadow = true
    return { body }
  }, [])

  useEffect(
    () => () => {
      disposeBlocks(assets.body)
      hideNameplatesFrom(0)
    },
    [assets],
  )

  useFrame((state, rawDelta) => {
    const body = bodyRef.current
    if (!body) return
    const delta = Math.min(rawDelta, 0.05)
    const settings = getQuality()
    const now = performance.now()
    const renderTime = now - INTERP_DELAY_MS
    const t = state.clock.elapsedTime

    let instance = 0
    let plate = 0
    runtime.remotePets.length = 0

    for (const r of remotePlayers.values()) {
      interpolate(r, renderTime)
      const moved = _prev.distanceTo(r.position)
      r.speed = r.speed * 0.8 + (moved / Math.max(delta, 1e-3)) * 0.2

      // --- Their hit: the swing here, the ball in BallFlight ----------------------
      const ghost = runtime.ghostRolls.get(r.sessionId)
      r.hitting = false
      if (ghost) {
        const elapsed = (now - ghost.startedAt) / 1000
        if (elapsed > ghost.duration + ROLL_RECOVERY + 1) runtime.ghostRolls.delete(r.sessionId)
        else {
          r.hitting = true
          r.hitT = elapsed
          r.hitGrade = ghost.hit
        }
      }
      r.pulling = r.anim === 'pull' && !r.hitting
      r.shadow.position.copy(r.position)

      // --- In the lobby -----------------------------------------------------------
      const shownAt = r.position
      const distance = camera.position.distanceTo(shownAt)
      const visible = distance < settings.remoteDrawDistance
      r.shadow.visible = visible
      const running = r.anim === 'run'

      // Players drawn as their real avatar (RemoteAvatars) skip the blocky figure.
      if (visible && !r.fullAvatar && instance + PARTS <= MAX_REMOTES * PARTS) {
        const walking = !running && r.speed > 0.6
        if (walking) r.walkPhase += delta * (6 + Math.min(r.speed, 10) * 0.5)
        // In a cage: a swing at every pitch.
        if (running) r.walkPhase += delta * RUN_CADENCE
        const swing = walking ? Math.sin(r.walkPhase) * 0.9 : 0
        const batting = r.pulling || r.hitting
        _q.setFromAxisAngle(_up, running ? PAD_YAW : batting ? BATTER_YAW : r.yaw)
        _base.compose(r.position, _q, _s.set(1, 1, 1))
        // (A click swing loops too: anim 'swing'.)
        const clicking = r.anim === 'swing'
        if (clicking) r.walkPhase += delta * 11
        const swung = r.hitting || ((running || clicking) && Math.sin(r.walkPhase) > 0)
        // Arms up on the bat at the plate and in the cage; swinging against the legs walking.
        const arms = batting || running || clicking ? (swung ? -1.2 : -2.2) : walking ? null : 0.1
        instance = writeFigure(body, instance, r, _base, swing, arms, 1, batting || running || clicking ? (swung ? BAT_SWUNG : BAT_UP) : BAT_BACK)
      }

      // Name tag, just above the head (players are 1.8 tall).
      if (visible) {
        _v.set(r.position.x, r.position.y + 2.05, r.position.z)
        plate = writeNameplate(plate, r.name, _v, distance, settings.remoteNameDistance, camera, size, r.uid)
      }

      // Their pets: follow in formation, drawn by the shared pet renderer.
      if (visible) {
        const sin = Math.sin(r.yaw)
        const cos = Math.cos(r.yaw)
        for (let i = 0; i < r.petIds.length && i < r.pets.length; i += 1) {
          const pet = r.pets[i]
          pet.id = r.petIds[i]
          const sx = i === 0 ? -1.5 : i === 1 ? 1.5 : 0
          const sz = i === 2 ? -2.5 : -1.3
          _target.set(r.position.x - cos * sx + sin * sz, r.position.y, r.position.z + sin * sx + cos * sz)
          _dir.copy(pet.position)
          pet.position.lerp(_target, 1 - Math.exp(-6 * delta))
          const stepped = _dir.distanceTo(pet.position)
          if (stepped > 0.005) pet.yaw = Math.atan2(pet.position.x - _dir.x, pet.position.z - _dir.z)
          pet.hop = Math.abs(Math.sin(t * 7 + i)) * (stepped > 0.01 ? 0.35 : 0.08)
          runtime.remotePets.push(pet)
        }
      }
    }
    hideNameplatesFrom(plate)
    body.count = instance
    body.instanceMatrix.needsUpdate = true
    if (body.instanceColor) body.instanceColor.needsUpdate = true
  })

  return (
    <>
      <primitive ref={bodyRef} object={assets.body} />
    </>
  )
}

export default RemotePlayers
