import { useFrame, useThree } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef } from 'react'
import { Quaternion, Vector3 } from 'three'

import { isPadUnlocked } from '@shared/logic'
import { BATTER_YAW, clampToWalkable, groundHeightAt, PAD_X, PAD_YAW, padAt, padCenterZ, PLATE_RADIUS, STATIC_COLLIDERS, stationAt, STATIONS, STEP_IN_RADIUS } from '@shared/world'

import { sfx } from '../audio/sfx'
import { getGame } from '../store/game'
import ErrorBoundary from '../ui/ErrorBoundary'
import { CLICK_PLANT_S, CLICK_POSE_S, clicks, sinceClick, TOSS_S, tapSwing } from './clickSwing'
import FallbackAvatar from './FallbackAvatar'
import PlayerAvatar from './PlayerAvatar'
import { RUN_CADENCE } from './kick'
import { actions } from '../net/actions'
import { cancelPull, grab, isPulling, launch, pressSwing, slowAt, TOSS_FALL_MS, TOSS_RISE_MS, updatePull, wantsStepIn } from './launch'
import { BODY } from './playerPose'
import { roll } from './roll/rollControl'
import { takenStations } from './stations'
import { runtime } from './runtime'
import useKeyboard from './useKeyboard'

export const PLAYER_HEIGHT = 1.8
const RADIUS = 0.45

const WALK_SPEED = 10.875
const ACCELERATION = 16
const GRAVITY = 32
const JUMP_SPEED = 10.5
/** Ledges up to this high are walked straight onto (the showroom's back stage). */
const STEP_UP = 1.05
/** Up at bat, pushing the stick this far steps you out of the box. */
const STEP_OUT_INPUT = 0.35
/** Stepped out, you're only stepped back in once you've been this far from the spot. */
const STEP_LATCH_CLEAR = STEP_IN_RADIUS + 0.9
/** How long a swing's pose plays (seconds) before you're back to waiting on the pitch. */
const SWING_POSE_S = 0.95
/** A press on the 3D view this short (ms) and this still (px) is a click, not a camera drag. */
const TAP_MS = 350
const TAP_PX = 10

// Scratch objects, reused each frame so the loop allocates nothing.
const _input = new Vector3()
const _move = new Vector3()
const _camForward = new Vector3()
const _camRight = new Vector3()
const _targetQuat = new Quaternion()
const _up = new Vector3(0, 1, 0)
const _clamped = { x: 0, z: 0 }
const _pivot = new Vector3()

/** Pushes a circle out of an axis-aligned rect. Returns true on contact. */
function pushOut(pos, rect) {
  const cx = Math.min(rect.maxX, Math.max(rect.minX, pos.x))
  const cz = Math.min(rect.maxZ, Math.max(rect.minZ, pos.z))
  const dx = pos.x - cx
  const dz = pos.z - cz
  const d2 = dx * dx + dz * dz
  if (d2 >= RADIUS * RADIUS) return false

  if (d2 > 1e-8) {
    const d = Math.sqrt(d2)
    const push = (RADIUS - d) / d
    pos.x += dx * push
    pos.z += dz * push
    return true
  }

  // Centre inside the rect (spawned in, or a wall appeared on top of us): leave by the
  // nearest side.
  const left = pos.x - rect.minX
  const right = rect.maxX - pos.x
  const near = pos.z - rect.minZ
  const far = rect.maxZ - pos.z
  const m = Math.min(left, right, near, far)
  if (m === left) pos.x = rect.minX - RADIUS
  else if (m === right) pos.x = rect.maxX + RADIUS
  else if (m === near) pos.z = rect.minZ - RADIUS
  else pos.z = rect.maxZ + RADIUS
  return true
}

/**
 * The local player: a kinematic character controller.
 *
 * No physics engine: the world is flat ground, a few raised floors and a list of
 * rectangular walls, which a circle-vs-rect push-out handles exactly. That saves the
 * ~2 MB Rapier WASM download and keeps the active rigid body count at zero.
 *
 * Walk onto the batter's box at home plate and you step up to bat (launch.js): squared
 * up side-on to the mound, waiting on the pitch in your stance; the SWING button (or
 * Space) swings (RollButton), and the swing plays here. The hit itself flies the ball,
 * not you (roll/): you stay in the box, watching it go, then celebrate. Push the stick or
 * jump to step out. In a batting cage you step onto its batter spot and swing at every
 * pitch the machine throws you. Walking about, your bat rides across your back.
 *
 * Reads and writes `runtime.player`; never touches React state per frame.
 *
 * @param {{ onAvatarReady?: () => void }} props
 */
export function Player({ onAvatarReady }) {
  const groupRef = useRef(null)
  const visualRef = useRef(null)
  const keys = useKeyboard()
  const velocity = useRef(new Vector3())
  const vy = useRef(0)
  /** Stepped out of the box: don't step straight back in until you've walked off. */
  const stepLatch = useRef(false)
  /** The jump input last frame: at bat, pressing it swings. */
  const jumpHeld = useRef(false)

  // A click or tap on the 3D view (not a drag to turn the camera, not on the HUD, which
  // sits above it) swings your bat: at the pitch at home plate, else a click swing
  // (clickSwing.js) for Power.
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    const el = gl.domElement
    const downs = new Map()
    const onDown = (e) => downs.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now(), button: e.button })
    const onUp = (e) => {
      const d = downs.get(e.pointerId)
      downs.delete(e.pointerId)
      if (!d || (e.pointerType === 'mouse' && d.button !== 0)) return
      if (performance.now() - d.t < TAP_MS && Math.hypot(e.clientX - d.x, e.clientY - d.y) < TAP_PX) tapSwing()
    }
    const onCancel = (e) => downs.delete(e.pointerId)
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onCancel)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onCancel)
    }
  }, [gl])

  /** Handed to the avatar so it can pose itself. A ref: written every frame. */
  const motionRef = useRef({
    time: 0,
    speed: 0,
    grounded: true,
    maxSpeed: WALK_SPEED,
    vy: 0,
    stride: 0,
    bat: undefined,
    swingT: 0,
    coil: 0,
    great: false,
  })

  // The blob shadow follows the character.
  const shownAt = useMemo(() => new Vector3().copy(runtime.player.position), [])
  useEffect(() => {
    const caster = { position: shownAt, size: 1.1 }
    runtime.shadowCasters.add(caster)
    return () => runtime.shadowCasters.delete(caster)
  }, [shownAt])

  useFrame((state, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05)
    const now = performance.now()
    const player = runtime.player
    const pos = player.position
    const k = keys.current
    const joy = runtime.input
    const motion = motionRef.current
    const game = getGame()
    const profile = game.profile
    motion.time += delta

    const group = groupRef.current
    const visual = visualRef.current

    // --- The batting stations: stepping up, at bat, stepping out -----------------
    // Up at bat: how far from your station's spot; otherwise from the nearest station's.
    const near = stationAt(pos.x, pos.z, STEP_LATCH_CLEAR + 1)
    const spot = STATIONS[isPulling() || roll.active ? launch.station : Math.max(0, near)]
    const fromSpot = near < 0 && !isPulling() ? Infinity : Math.hypot(pos.x - spot.spotX, pos.z - spot.spotZ)
    if (stepLatch.current && fromSpot > STEP_LATCH_CLEAR) stepLatch.current = false
    // Onto a free station's batter spot (not one another player's batting at) - or HIT
    // pressed near one - up to bat.
    const asked = wantsStepIn(now) && fromSpot < PLATE_RADIUS + 0.4
    if (!roll.active && !isPulling() && (asked || !stepLatch.current) && !player.frozen && player.grounded && !game.panel && (fromSpot < STEP_IN_RADIUS || asked) && !takenStations()[spot.index]) {
      grab(Boolean(profile.passes.autoRoll && profile.settings.autoRoll), now, spot.index)
      sfx.stepIn()
    }
    // Moved off the box some other way (a server correction, a portal): stepped out.
    if (!roll.active && isPulling() && !launch.snap && fromSpot > STEP_IN_RADIUS + 0.6) cancelPull()
    const atBat = !roll.active && isPulling()
    if (atBat && launch.snap) {
      // Just stepped in: onto the batter's spot, squared up to the plate.
      launch.snap = false
      pos.set(spot.spotX, groundHeightAt(spot.spotX, spot.spotZ), spot.spotZ)
      velocity.current.set(0, 0, 0)
    }

    // --- Input, relative to the camera ----------------------------------------
    _input.set(0, 0, 0)
    const still = player.frozen
    if (!still) {
      _input.set(
        (k.right ? 1 : 0) - (k.left ? 1 : 0) + joy.joyX,
        0,
        (k.backward ? 1 : 0) - (k.forward ? 1 : 0) - joy.joyY,
      )
    }
    let inputLength = Math.min(1, _input.length())

    if (atBat) {
      // Up at bat: a firm push on the stick steps you out (not mid-swing); otherwise you
      // stay planted in the box.
      if (inputLength > STEP_OUT_INPUT && !launch.released) {
        cancelPull()
        stepLatch.current = true
      } else {
        inputLength = 0
        // Auto Swing follows its toggle, even mid at-bat.
        launch.auto = Boolean(profile.passes.autoRoll && profile.settings.autoRoll)
        // The pitch clock: the meter, a pitch gone by, Auto Swing's swing.
        const auto = updatePull(now)
        if (auto !== undefined && auto !== null) {
          sfx.batCrack(null)
          actions.roll()
        }
      }
    }

    if (inputLength > 0.02) {
      _input.normalize()
      // Flatten the camera's forward onto the ground plane so "up" always means
      // "away from the camera".
      state.camera.getWorldDirection(_camForward)
      _camForward.y = 0
      _camForward.normalize()
      _camRight.crossVectors(_camForward, _up).normalize()
      _move
        .set(0, 0, 0)
        .addScaledVector(_camForward, -_input.z)
        .addScaledVector(_camRight, _input.x)
        .normalize()
        .multiplyScalar(WALK_SPEED * inputLength)
    } else {
      _move.set(0, 0, 0)
    }
    // A click swing plants you for a moment while you toss and swing.
    const clicking = sinceClick(now) < CLICK_PLANT_S
    const planted = (atBat && isPulling()) || roll.active || clicking

    // Ease towards the target velocity: crisp, but no instant 0->max snaps.
    const blend = 1 - Math.exp(-ACCELERATION * delta)
    velocity.current.lerp(_move, blend)
    if (planted) velocity.current.set(0, 0, 0)

    // --- Horizontal move + collision --------------------------------------------
    const prevX = pos.x
    const prevZ = pos.z
    pos.x += velocity.current.x * delta
    pos.z += velocity.current.z * delta

    // In a cage, standing still: ease onto its batter spot to swing.
    const pad = padAt(pos.x, pos.z)
    const speedNow = Math.hypot(velocity.current.x, velocity.current.z)
    const training = pad >= 0 && player.grounded && speedNow < 0.5 && !still && !planted && isPadUnlocked(profile, pad)
    if (training) {
      // (shared/world cageBatterSpot, inline: nothing made per frame.)
      const ease = 1 - Math.exp(-10 * delta)
      pos.x += (PAD_X - pos.x) * ease
      pos.z += (padCenterZ(pad) - 0.85 - pos.z) * ease
    }

    for (const rect of STATIC_COLLIDERS) pushOut(pos, rect)
    for (const rect of runtime.dynamicColliders) pushOut(pos, rect)
    clampToWalkable(pos.x, pos.z, _clamped)
    pos.x = _clamped.x
    pos.z = _clamped.z

    // A ledge too tall to step onto acts as a wall.
    let floor = groundHeightAt(pos.x, pos.z)
    if (floor - pos.y > STEP_UP) {
      pos.x = prevX
      pos.z = prevZ
      floor = groundHeightAt(pos.x, pos.z)
    }

    // --- Vertical ---------------------------------------------------------------
    const jumpInput = k.jump || joy.jump
    const pressed = jumpInput && !jumpHeld.current
    jumpHeld.current = jumpInput
    // Up at bat, the jump button (Space) swings instead.
    if (pressed && atBat && isPulling()) pressSwing(now)
    const wantJump = !still && !roll.active && !atBat && jumpInput
    if (wantJump && player.grounded) {
      vy.current = JUMP_SPEED
      player.grounded = false
      sfx.jump()
    }
    vy.current -= GRAVITY * delta
    pos.y += vy.current * delta

    if (pos.y <= floor) {
      // Coming down from a jump (not just stepping off a kerb) lands with a thump.
      if (!player.grounded && vy.current < -5) sfx.jumpLand()
      pos.y = floor
      vy.current = 0
      player.grounded = true
    } else if (pos.y - floor > 0.05) {
      // Walked off a ledge, or still rising from a jump.
      player.grounded = false
    }

    // --- Facing -----------------------------------------------------------------
    const speed = Math.hypot(velocity.current.x, velocity.current.z)
    const batting = (atBat && isPulling()) || roll.active
    if (training) player.yaw = PAD_YAW
    else if (batting) player.yaw = BATTER_YAW
    else if (speed > 0.3) player.yaw = Math.atan2(velocity.current.x, velocity.current.z)

    // --- The bat: waiting on the pitch, swinging, watching it fly ----------------
    motion.bat = undefined
    motion.cheer = 0
    motion.toss = 0
    motion.slow = 0
    const sinceSwing = (now - launch.swungAt) / 1000
    if (roll.active) {
      motion.bat = 'after'
      motion.swingT = Math.max(0, sinceSwing)
      motion.great = roll.hit === 'perfect' || roll.hit === 'great'
    } else if (atBat && isPulling()) {
      if (launch.swungAt && sinceSwing < SWING_POSE_S && (launch.released || now - launch.whiffAt < SWING_POSE_S * 1000)) {
        motion.bat = 'swing'
        motion.swingT = sinceSwing
      } else {
        motion.bat = 'ready'
        // The toss: the front hand flicks the ball up, then you load up as it comes down
        // (in slow motion: the waggle stills).
        const since = launch.stage === 'toss' ? now - launch.tossAt : Infinity
        motion.toss = since < TOSS_RISE_MS + 120 ? 1 - since / (TOSS_RISE_MS + 120) : 0
        motion.coil = since === Infinity ? 0 : Math.min(1, Math.max(0, (since - TOSS_RISE_MS * 0.6) / (TOSS_FALL_MS * 0.75)))
        motion.slow = slowAt(now)
      }
    } else if (!training && sinceClick(now) < CLICK_POSE_S) {
      // A click swing: loading up as the ball goes up, then smacking it.
      const t = sinceClick(now)
      if (t < TOSS_S) {
        motion.bat = 'ready'
        motion.coil = t / TOSS_S
      } else {
        motion.bat = 'swing'
        motion.swingT = t - TOSS_S
      }
    }

    // A pose pinned from the ?debug console (window.__pp.runtime.debugPose), for checking
    // the animation frame by frame. Never set in normal play.
    if (runtime.debugPose) Object.assign(motion, runtime.debugPose)

    // --- Where the body is ------------------------------------------------------
    // Step-ups ease in over a few frames on the visual only; the logical position snaps
    // so collision and triggers stay exact.
    const shownY = group ? group.position.y : pos.y
    const steppingUp = player.grounded && pos.y > shownY
    const y = steppingUp ? shownY + (pos.y - shownY) * Math.min(1, delta * 18) : pos.y
    _pivot.set(pos.x, y + BODY.pivot, pos.z)
    if (visual) {
      // Click swinging, the body turns side-on so the ball flies the way you were facing.
      const clickPose = motion.bat && !batting && !training
      _targetQuat.setFromAxisAngle(_up, clickPose ? clicks[0].yaw - Math.PI / 2 : player.yaw)
      visual.quaternion.slerp(_targetQuat, batting ? 1 - Math.pow(0.00001, delta) : 1 - Math.pow(0.0005, delta))
    }
    if (group) group.position.set(_pivot.x, _pivot.y - BODY.pivot, _pivot.z)
    shownAt.set(_pivot.x, pos.y, _pivot.z)

    // --- Publish motion ---------------------------------------------------------
    player.speed = speed
    // What other players see: 'pull' is up at bat (the template's name), 'run' a cage,
    // 'swing' a click swing.
    player.anim = !player.grounded ? 'jump' : batting ? 'pull' : training ? 'run' : motion.bat ? 'swing' : speed > 0.5 ? 'walk' : 'idle'

    motion.speed = speed
    motion.grounded = player.grounded
    motion.vy = vy.current
    // In a cage: a swing at every pitch (playerPose, `run`).
    motion.run = training ? 1 : 0
    motion.stride += delta * (training ? RUN_CADENCE : 5 + 6 * Math.min(1, speed / WALK_SPEED))
    runtime.player.cagePhase = training ? motion.stride : -1
    runtime.player.cage = training ? pad : -1
  })

  return (
    <group ref={groupRef}>
      <group ref={visualRef}>
        <ErrorBoundary fallback={<FallbackAvatar motionRef={motionRef} onReady={onAvatarReady} />}>
          <Suspense fallback={<FallbackAvatar motionRef={motionRef} />}>
            <PlayerAvatar onReady={onAvatarReady} targetHeight={PLAYER_HEIGHT} motionRef={motionRef} />
          </Suspense>
        </ErrorBoundary>
      </group>
    </group>
  )
}

export default Player
