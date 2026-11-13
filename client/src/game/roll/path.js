import { Euler, Quaternion, Vector3 } from 'three'

import { HOME_PLATE, SLOPE_ANGLE, STATIONS, TRACK_START_Z } from '@shared/world'

/**
 * Geometry of a hit: one long, straight field running north from the plaza's edge,
 * dead level (SLOPE_ANGLE is 0; the maths still allows a slope).
 *
 * Track metre `m` is measured along the field from the start line (the plaza's north
 * edge). Before the start (m < 0) the ground is the plaza. Everything here is pure maths
 * and allocation-free, so the frame loop can call it freely.
 */

export const SIN = Math.sin(SLOPE_ANGLE)
export const COS = Math.cos(SLOPE_ANGLE)
export const TAN = Math.tan(SLOPE_ANGLE)

/** World z of track metre m. */
export const zAt = (m) => TRACK_START_Z - (m > 0 ? m * COS : m)
/** Height of the floor at track metre m. */
export const floorY = (m) => (m > 0 ? -m * SIN : 0)
/** Height of the track's floor plane under world z. */
export const slopeY = (z) => (z < TRACK_START_Z ? -(TRACK_START_Z - z) * TAN : 0)
/** Height of a surface parallel to the floor, `h` metres off it, under world z. */
export const surfaceY = (z, h) => slopeY(z) + h / COS

/** How a box lies on the track: tipped back by the slope angle. */
export const SLOPE_EULER_X = -SLOPE_ANGLE

/** World point at track metre m, `x` to the side and `h` off the floor. */
export function trackPoint(m, x, h, out) {
  if (m <= 0) return out.set(x, h, TRACK_START_Z - m)
  return out.set(x, -m * SIN + h * COS, TRACK_START_Z - m * COS - h * SIN)
}

const _e = new Euler()
const _q = new Quaternion()
const _p = new Vector3()
const _s = new Vector3()

/**
 * Matrix of a box lying on the track, given in track terms: centred `x` across, `h`
 * off the floor (to its centre) and at metre `m` (also its centre), sized `sx` across,
 * `sy` thick and `sz` along the track, leaning `lean` radians about its own long axis.
 */
export function slopeBoxMatrix(m, x, h, sx, sy, sz, lean, out) {
  trackPoint(m, x, h, _p)
  _q.setFromEuler(_e.set(m > 0 ? SLOPE_EULER_X : 0, 0, lean))
  return out.compose(_p, _q, _s.set(sx, sy, sz))
}

/** Same as slopeBoxMatrix, but as BlockSet.add arguments: [x, y, z, rotX]. */
export function slopeBoxPlacement(m, x, h) {
  trackPoint(m, x, h, _p)
  return [_p.x, _p.y, _p.z, m > 0 ? SLOPE_EULER_X : 0]
}

/** Metres a world z is along the track (negative in the plaza). */
export const meterAtZ = (z) => (z < TRACK_START_Z ? (TRACK_START_Z - z) / COS : TRACK_START_Z - z)

// --- A hit -----------------------------------------------------------------------

const clamp01 = (x) => Math.min(1, Math.max(0, x))

/** The ball's radius as it flies (bigger than a real one: it has to read from afar). */
export const BALL_RADIUS = 0.26
/** How big the ball reads to the trail and effects. */
export const TIRE_SIZE = BALL_RADIUS
/**
 * Where the bat meets the ball: over the front of a station's plate, at the batter's belt
 * (the batter stands at its batter spot, side-on). The flight starts here. `x` is the
 * middle station's; contactX(station) any station's.
 */
export const CONTACT = { x: HOME_PLATE.x + 0.15, y: 1.0, z: HOME_PLATE.z - 0.45 }
export const contactX = (station) => (STATIONS[station]?.x ?? HOME_PLATE.x) + 0.15
/** A station's balls' lane across the field (0 for an unknown one). */
export const laneOf = (station) => STATIONS[station]?.lane ?? 0
/** Seconds into a hit that the ball leaves the bat: a beat of hit-stop on the bat first. */
export const KICK_HIT = 0.16
/** The metre (negative: still in the plaza) the flight starts from. */
export const CONTACT_METER = (TRACK_START_Z - CONTACT.z) / COS

/**
 * The flight's shares of the hit's time after it leaves the bat: the big arc, then the
 * bounces, the rest rolling to a stop. The arc covers ARC_SHARE of the distance, the
 * bounces most of what's left.
 */
const ARC_T = 0.6
const BOUNCE_T = 0.27
const ARC_SHARE = 0.74
const BOUNCE_SHARE = 0.92
/** Each bounce this much lower (in height) and shorter than the last. */
const RESTITUTION = 0.48

/**
 * How far along the arc (0-1) the ball is `t` of the way through it: off the bat fast,
 * slowing as it goes, still moving when it comes down.
 */
const progress = (t) => {
  const x = clamp01(t)
  return 1.5 * x - 0.5 * x * x
}

/**
 * Seconds into a hit of `duration` at which the ball has flown `f` (0-1) of its first
 * arc: 0.5 is the top of the arc, 1 the moment it first lands.
 */
export const kickTimeAt = (f, duration) => KICK_HIT + ARC_T * (1.5 - Math.sqrt(2.25 - 2 * clamp01(f))) * Math.max(0.1, duration - KICK_HIT)

/**
 * The arc's peak grows with the distance (a short hit stays low, a long one soars) and
 * with how well you timed the swing (KICK_ARC: a WEAK one is a low liner, a PERFECT one a
 * towering moonshot), capped so the field stays in view below it.
 */
const KICK_ARC = { weak: 0.45, good: 0.85, great: 1.15, perfect: 1.5 }
export const flightPeak = (distance, hit = null) => Math.min(48, (5 + 0.62 * Math.sqrt(Math.max(0, distance))) * (KICK_ARC[hit] ?? 1))

/** A fresh state for rideState to write into. */
export const createRideState = () => ({
  /** 'launch' (on the bat) | 'ride' (flying, bouncing, rolling) | 'stopped'. */
  phase: 'launch',
  launch: 0,
  meter: 0,
  speed: 0,
  /** Height of the ball's bottom off the ground. */
  air: 0,
  size: BALL_RADIUS,
  /** True during the first, big arc (until it first lands). */
  airborne: false,
  /** 0 in the first arc; 1 once it's landed, then one more for every bounce after. */
  bounces: 0,
  /** Rolling along the ground after its last bounce. */
  rolling: false,
  /** How far the ball has turned about its spin axis (radians): it spins as it goes. */
  spin: 0,
  /** Never true: nothing on the field stops it. */
  crashed: false,
  x: 0,
  /** The ball's centre. */
  position: new Vector3(),
})

/**
 * Everything about a hit `elapsed` seconds in - yours, or another player's replayed from
 * the same numbers, so both fly identically. `ride` is `{ fromMeter, startX, distance,
 * duration, hit, bounce }` (duration includes the swing; `bounce` is how many times the
 * ball bounces after it lands - its BALLS `bounce`, 3 if unknown); `lane` is a sideways
 * offset so balls don't overlap. Writes into `out` (see createRideState):
 *   phase    'launch' (on the bat) | 'ride' | 'stopped'
 *   meter    metres along the field; speed in m/s along it
 *   position the ball's centre; air its height off the ground
 */
export function rideState(elapsed, ride, lane, out) {
  const start = Number.isFinite(ride.fromMeter) ? ride.fromMeter : CONTACT_METER
  const end = Math.max(start + 2, ride.distance)
  const span = end - start
  const flightTime = Math.max(0.1, ride.duration - KICK_HIT)
  const bounces = Math.max(1, Math.min(8, Math.round(ride.bounce ?? 3)))
  const peak = flightPeak(span, ride.hit)
  let meter = start
  let speed = 0
  let air = CONTACT.y - BALL_RADIUS
  out.airborne = false
  out.crashed = false
  out.rolling = false
  out.bounces = 0
  if (elapsed < KICK_HIT) {
    // On the bat: the hit-stop as it squashes against the barrel.
    out.phase = 'launch'
    out.launch = clamp01(elapsed / KICK_HIT)
  } else {
    const t = (elapsed - KICK_HIT) / flightTime
    out.launch = 1
    out.phase = t >= 1 ? 'stopped' : 'ride'
    const arcEnd = start + span * ARC_SHARE
    const bounceEnd = arcEnd + (end - arcEnd) * BOUNCE_SHARE
    if (t < ARC_T) {
      // The big arc: off the bat on a rising line, over the top, down onto the grass.
      const u = t / ARC_T
      const f = progress(u)
      meter = start + (arcEnd - start) * f
      speed = ((arcEnd - start) * (1.5 - u)) / (ARC_T * flightTime)
      air = (CONTACT.y - BALL_RADIUS) * (1 - f) + peak * 4 * f * (1 - f)
      out.airborne = true
    } else if (t < ARC_T + BOUNCE_T) {
      // The bounces: each a smaller hop, shorter and lower than the last. Their lengths
      // and times shrink by RESTITUTION, adding up to the bounces' share.
      const v = (t - ARC_T) / BOUNCE_T
      let total = 0
      for (let k = 0; k < bounces; k += 1) total += RESTITUTION ** k
      let at = 0
      let k = 0
      let w = 1 / total
      while (k < bounces - 1 && v > at + w) {
        at += w
        k += 1
        w = RESTITUTION ** k / total
      }
      const local = clamp01((v - at) / w)
      const from = arcEnd + (bounceEnd - arcEnd) * at
      const to = arcEnd + (bounceEnd - arcEnd) * (at + w)
      meter = from + (to - from) * local
      speed = (to - from) / (w * BOUNCE_T * flightTime)
      const hop = peak * 0.3 * RESTITUTION ** (2 * k)
      air = hop * 4 * local * (1 - local)
      out.bounces = 1 + k
    } else {
      // Rolling to a stop on the grass, exactly where the authority said.
      const v = clamp01((t - ARC_T - BOUNCE_T) / (1 - ARC_T - BOUNCE_T))
      const f = 1 - (1 - v) * (1 - v)
      meter = bounceEnd + (end - bounceEnd) * f
      speed = (2 * (1 - v) * (end - bounceEnd)) / ((1 - ARC_T - BOUNCE_T) * flightTime)
      air = 0
      out.bounces = bounces + 1
      out.rolling = v < 1
    }
  }
  // Ease from the plate onto its own line down the field.
  const settle = clamp01((meter - start) / 40)
  const x = (Number.isFinite(ride.startX) ? ride.startX : CONTACT.x) * (1 - settle) + lane * settle
  // Spins with the ground it covers.
  out.spin = (meter - start) / BALL_RADIUS
  out.meter = meter
  out.speed = speed
  out.air = air
  out.x = x
  out.size = BALL_RADIUS
  if (out.phase === 'launch') out.position.set(Number.isFinite(ride.startX) ? ride.startX : CONTACT.x, CONTACT.y, CONTACT.z)
  else trackPoint(meter, x, BALL_RADIUS + air, out.position)
  return out
}

/** Each other player's ball flies down its own line of the field, so balls don't overlap. */
export function laneFor(sid) {
  let h = 2166136261
  for (let i = 0; i < sid.length; i += 1) h = Math.imul(h ^ sid.charCodeAt(i), 16777619)
  return (((h >>> 0) % 5) - 2) * 3
}
