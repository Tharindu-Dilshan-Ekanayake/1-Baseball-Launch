import { Vector3 } from 'three'

import { SPAWN } from '@shared/world'

/**
 * Per-frame mutable state shared between systems.
 *
 * Deliberately outside React and zustand: it changes every frame, nothing should
 * re-render because of it, and every reader lives in a `useFrame` or a timer. UI that
 * needs a slow-changing derivative of it (which zone the player is in, say) gets it
 * from the 10 Hz game ticker, which is the only thing that copies from here into the
 * store.
 */
export const runtime = {
  player: {
    position: new Vector3(SPAWN.x, 0, SPAWN.z),
    /** Facing, radians about +Y. PI faces north (-Z), towards the track. */
    yaw: Math.PI,
    speed: 0,
    grounded: true,
    /** 'idle' | 'walk' | 'run' (swinging in a cage) | 'pull' (up at bat) | 'jump' - what other players see. */
    anim: 'idle',
    /** Set when the controller should ignore input. */
    frozen: false,
    /** The batting cage you're swinging in (-1: none), and your swings' phase in it. */
    cage: -1,
    cagePhase: -1,
  },

  /** Touch input, written by the on-screen joystick. -1..1, +y = forward. */
  input: {
    joyX: 0,
    joyY: 0,
    jump: false,
  },

  camera: {
    /** 'follow' orbits the player; 'roll' chases your ball (see roll/Roll.jsx). */
    mode: 'follow',
    yaw: 0,
    pitch: 0.36,
    distance: 11,
    /** Set to jump the follow camera straight to its target next frame. */
    snap: false,
  },

  /** What the sun's shadow box centres on while the camera chases your ball. */
  flightFocus: null,

  /**
   * Other players' pets, written by the multiplayer layer: `{ id, position, yaw, hop }`
   * per pet. Drawn by the same instanced pet meshes as yours.
   */
  remotePets: [],

  /**
   * Other players' hits to replay (their balls flying down their own lines), by their
   * session id: `{ distance, duration, blocked, tireId, ballId, hit, x, z, startedAt }`.
   */
  ghostRolls: new Map(),

  /** A pose pinned over yours from the ?debug console (Player.jsx), or null. */
  debugPose: null,

  /** Walls that come and go at runtime, e.g. locked pads. */
  dynamicColliders: [],

  /**
   * Things that get a blob shadow on low presets. Each entry is
   * `{ position: Vector3, size: number, visible?: boolean }`.
   */
  shadowCasters: new Set(),
}

/** Puts the player back at spawn, e.g. after a reconnect into a fresh lobby. */
export function respawn() {
  runtime.player.position.set(SPAWN.x, 0, SPAWN.z)
  runtime.player.yaw = Math.PI
}
