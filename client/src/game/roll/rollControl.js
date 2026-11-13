import { Vector3 } from 'three'

import { BALLS, comboBonus, HIT_GRADES } from '@shared/balance'
import { formatNumber } from '@shared/format'
import { BATTER_YAW } from '@shared/world'

import { sfx } from '../../audio/sfx'
import { getGame } from '../../store/game'
import { fadeThrough } from '../../ui/fade'
import { burst, fireBurst } from '../fx/fxQueue'
import { spawnScattered } from '../fx/popups'
import { consumePull, launch } from '../launch'
import { SWING_CONTACT } from '../playerPose'
import { runtime } from '../runtime'
import { zones } from '../worldLook'
import { showHit } from './hudLink'
import { CONTACT, CONTACT_METER, contactX, createRideState, flightPeak, KICK_HIT, kickTimeAt, laneOf, rideState } from './path'

/** How long the "+N Wins" result shows over the ball, stopped, before you're back. */
const RESULT_HOLD_MS = 2600
/** The ball's settling sound starts this long before it stops. */
const SKID_SOUND_LEAD = 0.9

/** Bounces after landing, by ball id (BALLS `bounce`). */
const BOUNCES = Object.fromEntries(BALLS.map((b) => [b.id, b.bounce]))
export const bouncesFor = (ballId) => BOUNCES[ballId] ?? 3

/**
 * The hit currently playing (the template's "roll"), read every frame by the camera, the
 * field, the ball, your avatar and the effects. Everything about it is known when it
 * starts (the authority already resolved the distance and the Wins), so the client just
 * plays it back: no per-frame network traffic.
 *
 * It's a ride state (see path.rideState: phase, meter, air, bounces, the ball's
 * position...) plus the hit's numbers. You stay in the batter's box (that's what the
 * server checks); only the ball and the camera go down the field.
 */
export const roll = {
  ...createRideState(),
  active: false,
  /** True once the ball has stopped and the result is showing. */
  stopped: false,
  startedAt: 0,
  distance: 0,
  duration: 1,
  wins: 0,
  prize: 0,
  discovered: [],
  /** Template leftovers: nothing on the field stops the ball. */
  blocked: -1,
  /** How many stages it flies into past the first. */
  broken: 0,
  best: false,
  tireId: 'bicycle',
  /** The ball hit (BALLS id) and how many times it bounces after landing. */
  ballId: 'baseball',
  bounce: 3,
  /** How well you timed the swing (HIT_GRADES id), or null for Auto Swing. */
  hit: null,
  /** Where the flight starts: the contact point's metre along the field, and its x. */
  fromMeter: CONTACT_METER,
  startX: CONTACT.x,
  /** The batting station it was hit from, and its lane down the field. */
  station: 4,
  lane: 0,
  /** PERFECTs in a row with this hit (0: not a PERFECT), and its lucky gift or null. */
  combo: 0,
  gift: null,
  /** performance.now() of the first landing, the ball leaving the bat, and the last big jolt. */
  landedAt: 0,
  tookOffAt: 0,
  hitAt: 0,
  /** performance.now() when the ball left the bat. */
  kickedAt: 0,
  /**
   * A graded hit's hit-stop: when it started (performance.now(), 0 if none this hit),
   * how long it lasts, how strong the camera's zoom, punch and shake are (0-1), and the
   * hit clock's lag when it started (the freeze is measured from it).
   */
  freezeAt: 0,
  freezeMs: 0,
  freezePower: 0,
  freezeLag: 0,
  /**
   * The ball thumping down at the end of its arc: when (performance.now()), where, and
   * how high it fell from - what the turf splash and its spray of grass need.
   */
  impactAt: 0,
  impact: new Vector3(),
  impactMeter: 0,
  impactPeak: 0,
  frameKey: -1,
  /**
   * Slow motion: ms the hit's clock is behind real time. The first landing slows the ball
   * (and the camera on it) for a moment; the clock catches up again a little faster than
   * real time afterwards, and is always caught up before the ball stops, so the hit ends
   * exactly when the authority said.
   */
  lag: 0,
  lastNow: 0,
}

/** How long each slow motion lasts, how slow, and how fast the clock catches up. */
const SLOW_MS = 220
const SLOW_RATE = 0.25
/** How fast the hit's clock runs during a hit-stop: all but frozen. */
const FREEZE_RATE = 0.06
const CATCH_UP = 0.4

let timers = []

function clearTimers() {
  for (const id of timers) clearTimeout(id)
  timers = []
}

/**
 * Moves the hit on to this frame. Idempotent per frame (keyed on the renderer's clock),
 * so the camera, the ball and the effects all see exactly the same state however many of
 * them ask.
 */
export function advanceRoll(clockTime) {
  if (!roll.active || roll.frameKey === clockTime) return roll
  roll.frameKey = clockTime
  const now = performance.now()
  const wasAirborne = roll.airborne
  const wasWaiting = roll.phase === 'launch'
  const wasBounces = roll.bounces
  const dt = roll.lastNow ? Math.min(now - roll.lastNow, 100) : 0
  roll.lastNow = now
  if (now - roll.freezeAt < roll.freezeMs) {
    // From the clock, not summed frame by frame: frame steps are capped, so on a slow
    // device a summed freeze would mostly slip away.
    roll.lag = roll.freezeLag + (now - roll.freezeAt) * (1 - FREEZE_RATE)
  } else if (now - roll.hitAt < SLOW_MS) roll.lag += dt * (1 - SLOW_RATE)
  else roll.lag = Math.max(0, roll.lag - dt * CATCH_UP)
  // All caught up by half a second before the stop.
  const left = roll.duration - (now - roll.startedAt) / 1000
  roll.lag = Math.min(roll.lag, Math.max(0, left - 0.5) * 400)
  rideState((now - roll.startedAt - roll.lag) / 1000, roll, roll.lane, roll)
  if (wasWaiting && roll.phase !== 'launch') {
    roll.kickedAt = now
    roll.tookOffAt = now
    blastOff(now)
  }
  if (wasAirborne && !roll.airborne) {
    // Down from the top of the arc: a thump on the turf (Impact.jsx), the camera jolts,
    // a moment of slow motion.
    roll.landedAt = now
    roll.hitAt = now
    roll.impactAt = now
    roll.impact.copy(roll.position)
    roll.impactMeter = roll.meter
    roll.impactPeak = flightPeak(roll.distance - roll.fromMeter, roll.hit)
    sfx.groundSmash(Math.min(1, roll.impactPeak / 40) * 0.7)
  }
  // Each bounce after it: a thud, softer every time.
  if (roll.bounces > wasBounces && wasBounces > 0) sfx.bounce(roll.bounces)
  return roll
}

/**
 * How each grade of hit looks as the ball leaves the bat: its burst (FireBurst kind),
 * confetti, and how hard the camera reacts (0-1).
 */
const HIT_FX = {
  perfect: { fire: 'perfect', palette: 'gold', count: 60, speed: 12, freezeMs: 0, power: 1 },
  great: { fire: 'great', palette: 'power', count: 34, speed: 9, freezeMs: 0, power: 0.65 },
  good: { fire: 'good', palette: 'confetti', count: 16, speed: 6, freezeMs: 0, power: 0.35 },
  weak: { fire: null, palette: null, count: 0, speed: 0, freezeMs: 0, power: 0 },
}

/**
 * The ball leaving the bat: the grade the swing meter gave the hit, straight away, so you
 * see why it flies as far as it does. GOOD, GREAT and PERFECT each get their own moment,
 * bigger every step - a burst off the bat (sparkles, an electric-blue blast, a column of
 * fire), the grade's title slamming onto the screen (HitFlash.jsx), the lens punching
 * wide and the camera shaking (Roll.jsx). A WEAK one just bloops off the end of the bat.
 */
function blastOff(now) {
  sfx.rollStart()
  const grade = HIT_GRADES.find((g) => g.id === roll.hit)
  if (!grade) return
  const fx = HIT_FX[grade.id]
  const p = roll.position
  if (fx.count) burst({ x: p.x, y: p.y, z: p.z, count: fx.count, palette: fx.palette, speed: fx.speed })
  // PERFECTs in a row: the combo and the Wins it adds.
  if (grade.id === 'perfect' && roll.combo >= 2) {
    timers.push(setTimeout(() => spawnScattered(`PERFECT COMBO x${roll.combo}! +${Math.round((comboBonus(roll.combo) - 1) * 100)}% WINS`, { scale: 1.25 }), 450))
  }
  if (grade.id === 'weak') {
    spawnScattered(grade.label, { scale: 1.3 })
    sfx.weakHit()
    return
  }
  roll.freezeAt = Math.min(now, roll.startedAt + roll.lag + KICK_HIT * 1000)
  roll.freezeMs = fx.freezeMs
  roll.freezePower = fx.power
  roll.freezeLag = roll.lag
  fireBurst(p.x, p.y, p.z, fx.fire)
  showHit(grade.id)
  sfx.gradeHit(grade.id)
  timers.push(setTimeout(() => sfx.perfectRelease(fx.power), 60))
}

/**
 * Starts a hit the authority already resolved, from your swing: the bat meets the ball
 * with a crack, it sits on the barrel for a beat, and off it flies.
 */
export function beginRoll(result) {
  clearTimers()
  const game = getGame()
  const now = performance.now()
  // A hit with no swing of yours behind it (Auto Swing: swung for you just now; or a
  // swing the server answered late): the swing is drawn as if it met the ball now.
  if (now - launch.swungAt > 1500) launch.swungAt = now - SWING_CONTACT * 1000
  consumePull()
  const ballId = result.ballId || game.profile.equippedBall
  Object.assign(roll, {
    active: true,
    stopped: false,
    startedAt: now,
    distance: result.distance,
    duration: result.duration,
    wins: result.wins,
    prize: result.prize || 0,
    discovered: result.discovered || [],
    blocked: result.blocked ?? -1,
    broken: result.broken || 0,
    best: result.best,
    tireId: result.tireId || game.profile.equippedTire,
    ballId,
    bounce: bouncesFor(ballId),
    hit: result.hit ?? null,
    fromMeter: CONTACT_METER,
    startX: contactX(launch.station),
    station: launch.station,
    lane: laneOf(launch.station),
    combo: result.combo || 0,
    gift: result.gift || null,
    landedAt: 0,
    tookOffAt: 0,
    hitAt: 0,
    kickedAt: 0,
    freezeAt: 0,
    freezeMs: 0,
    freezePower: 0,
    impactAt: 0,
    frameKey: -1,
    lag: 0,
    lastNow: 0,
  })
  rideState(0, roll, roll.lane, roll)
  runtime.player.frozen = true
  runtime.player.yaw = BATTER_YAW
  runtime.camera.mode = 'roll'
  // The HUD's switch to the flight (a React update and a restyle) in a task of its own,
  // not the frame the hit starts in: together they made that one frame stick on slow
  // phones. The flight itself is already under way from the runtime state above.
  const started = {
    distance: result.distance,
    wins: result.wins,
    prize: result.prize || 0,
    blocked: result.blocked ?? -1,
    duration: result.duration,
    best: result.best,
    giftWins: result.gift?.wins || 0,
  }
  timers.push(setTimeout(() => game.startRoll(started), 0))

  // CRACK! (Auto Swing's crack was already heard when it swung.)
  if (result.hit) sfx.batCrack(result.hit)
  // A cartoon whistle as the ball drops from the top of its arc, ending as it lands.
  const apex = kickTimeAt(0.5, result.duration)
  const land = kickTimeAt(1, result.duration)
  timers.push(setTimeout(() => sfx.fallWhistle(land - apex), apex * 1000))
  timers.push(setTimeout(() => sfx.rollStop(), Math.max(0, result.duration - SKID_SOUND_LEAD) * 1000))
  timers.push(
    setTimeout(() => {
      roll.stopped = true
      sfx.wins()
      const f = roll.position
      burst({ x: f.x, y: f.y + 1.8, z: f.z, count: 50, palette: 'gold', speed: 9 })
      game.endRoll()
      // A stage reached for the first time ever: its name and the prize, once.
      const stages = zones()
      for (const zi of roll.discovered) {
        game.showToast(`NEW STAGE: ${stages[zi].name}! +${formatNumber(stages[zi].discover)} Wins`)
      }
      // A lucky gift: a present bursting open over the ball, and what was in it.
      const gift = roll.gift
      if (gift) {
        timers.push(
          setTimeout(
            () => {
              sfx.reveal()
              burst({ x: f.x, y: f.y + 2.4, z: f.z, count: 70, palette: 'confetti', speed: 11 })
              const what = gift.wins ? `+${formatNumber(gift.wins)} Wins` : gift.label
              game.showToast(`LUCKY GIFT! ${gift.wins ? `${gift.label}: ${what}` : what}`)
            },
            roll.discovered.length ? 1600 : 500,
          ),
        )
      }
      timers.push(setTimeout(() => fadeThrough(finishRoll), RESULT_HOLD_MS))
    }, result.duration * 1000),
  )
}

/**
 * Back at the plate, camera behind you: still in the batter's box, so the next pitch
 * comes straight away (walk off to step out).
 */
export function finishRoll() {
  clearTimers()
  roll.active = false
  roll.stopped = false
  runtime.flightFocus = null
  const player = runtime.player
  player.yaw = BATTER_YAW
  player.frozen = false
  runtime.camera.mode = 'follow'
  runtime.camera.yaw = 0
  runtime.camera.snap = true
  getGame().clearRollResult()
}
