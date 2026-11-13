import { SWING_WINDOW, swingMeterAt } from '@shared/balance'

import { sfx } from '../audio/sfx'
import { actions } from '../net/actions'
import { spawnScattered } from './fx/popups'

/**
 * Your turn at bat, before the authority hears about it (the template's launch state:
 * the file and the object keep their names).
 *
 * Walk onto a batting station's batter's box and you step up to bat (`gripping`). Press
 * HIT and you toss the ball high over the plate yourself; on its way down the game drops
 * into slow motion, and the swing meter (shared/balance.js swingMeterAt) fills as it
 * falls, peaks the moment it reaches the bat's height over the plate and drains as it goes
 * by. Press again - SWING - and the swing is sent (net/actions.roll) with the meter as it
 * stood; the pose holds through the swing until the server's answer plays the hit
 * (roll/rollControl.beginRoll). Swing too early or too late - outside the window - and you
 * whiff; let it fall and it drops at your feet. Either way, toss again.
 *
 * Plain module state, written by the HIT button and the player and read every frame by
 * the tossed ball, the camera and the avatar - never React state, never per-frame network
 * traffic.
 */
export const launch = {
  /** Up at bat in the batter's box (and not mid-hit). */
  gripping: false,
  /** The batting station you're up at (shared/world STATIONS index). */
  station: 4,
  /** Tossing and swinging by itself (Auto Swing): a plain hit every toss. */
  auto: false,
  /** Set when you step in: the player moves you onto the batter spot on its next frame. */
  snap: false,
  /** The swing meter now (0-1). */
  charge: 0,
  /** 'ready' (waiting for HIT) | 'toss' (the ball's in the air) | 'whiff' (swung and missed; it's falling). */
  stage: 'ready',
  /** Each toss's number (the tossed ball keys on it), 0 before the first. */
  toss: 0,
  /** performance.now() of the toss, and when the ball comes down to the bat's height. */
  tossAt: 0,
  arriveAt: 0,
  /** performance.now() you became ready to toss (Auto Swing waits a beat). */
  readySince: 0,
  /** Swung at the ball and waiting for the authority: when, and how full the meter was. */
  released: false,
  releasedAt: 0,
  accuracy: 0,
  /** performance.now() of your last swing (a hit or a whiff), for the swing pose. */
  swungAt: 0,
  /** A swing that missed: when (performance.now(), 0 if none), and whether it was early. */
  whiffAt: 0,
  whiffEarly: false,
  /** HIT pressed near a station but not in its box yet: when (the player steps you in). */
  stepInAt: 0,
  /** Stepped in by that press: toss as soon as you're set (performance.now(), 0 none). */
  tossAfter: 0,
}

/** The toss: up fast (ms), then down in slow motion to the bat's height (ms), and how high. */
export const TOSS_RISE_MS = 340
export const TOSS_FALL_MS = 1350
export const TOSS_APEX = 2.8
/** Missed: it falls on past the bat to the ground in this long before you can toss again. */
const DROP_MS = 650
/** No answer this long after swinging (off the plate, busy): give up on that swing. */
const RELEASE_TIMEOUT_MS = 1500
/** Pressing HIT near a station: how long the request stands, and the beat before the toss once you're in. */
const STEP_IN_REQUEST_MS = 600
const STEP_IN_TOSS_MS = 260
/** Auto Swing tosses this long after it's ready, and swings this long before the ball arrives. */
const AUTO_DELAY_MS = 650
const AUTO_LEAD_MS = 40

function ready(now) {
  launch.stage = 'ready'
  launch.readySince = now
  launch.charge = 0
}

/** Steps up to bat at batting station `station` (`auto`: Auto Swing tosses and swings for you). */
export function grab(auto = false, now = performance.now(), station = launch.station) {
  launch.station = station
  launch.gripping = true
  launch.auto = auto
  launch.snap = true
  launch.released = false
  launch.whiffAt = 0
  ready(now)
  // Stepped in by pressing HIT: toss as soon as you're squared up.
  launch.tossAfter = now - launch.stepInAt < STEP_IN_REQUEST_MS ? now + STEP_IN_TOSS_MS : 0
  launch.stepInAt = 0
}

/** Whether HIT was just pressed near a station (the player steps you into its box). */
export const wantsStepIn = (now = performance.now()) => now - launch.stepInAt < STEP_IN_REQUEST_MS

/** Tosses the ball up: the slow-motion fall begins once it tops out. */
function tossUp(now) {
  launch.stage = 'toss'
  launch.toss += 1
  launch.tossAt = now
  launch.arriveAt = now + TOSS_RISE_MS + TOSS_FALL_MS
  launch.charge = 0
  sfx.toss()
  setTimeout(() => {
    if (launch.stage === 'toss' && launch.tossAt === now) sfx.slowMo()
  }, TOSS_RISE_MS)
}

/** Seconds from the ball reaching the bat's height (negative: still coming down). */
export const pitchClock = (now = performance.now()) => (now - launch.arriveAt) / 1000

/**
 * How much of the slow motion is on at `now` (0-1): from the toss topping out until you
 * swing, or the ball's gone by.
 */
export function slowAt(now = performance.now()) {
  if (launch.stage !== 'toss' || launch.released || !launch.gripping) return 0
  const since = now - launch.tossAt - TOSS_RISE_MS
  if (since < 0) return Math.max(0, 1 + since / 120)
  return now > launch.arriveAt + SWING_WINDOW * 1000 ? 0 : 1
}

/**
 * Moves the at-bat on to `now`: the meter, a ball that fell by unswung (ready to toss
 * again), Auto Swing's toss and swing. Called every frame by the player while up at bat.
 * Returns the meter when Auto Swing just swung (send a plain hit), else undefined.
 */
export function updatePull(now) {
  if (launch.released && now - launch.releasedAt > RELEASE_TIMEOUT_MS) {
    // The authority never answered (busy, off the plate): back to tossing.
    launch.released = false
    ready(now)
  }
  if (!launch.gripping || launch.released) return undefined
  if (launch.stage === 'ready') {
    launch.charge = 0
    if (launch.tossAfter && now >= launch.tossAfter) {
      launch.tossAfter = 0
      tossUp(now)
    } else if (launch.auto && now - launch.readySince > AUTO_DELAY_MS) tossUp(now)
    return undefined
  }
  const t = (now - launch.arriveAt) / 1000
  launch.charge = launch.stage === 'toss' ? swingMeterAt(t) : 0
  if (launch.stage === 'toss' && launch.auto && now >= launch.arriveAt - AUTO_LEAD_MS) return swing(now)
  // Fallen by (or whiffed): it drops at your feet, and you toss again.
  if (now > launch.arriveAt + SWING_WINDOW * 1000 + DROP_MS && (launch.stage !== 'whiff' || now > launch.whiffAt + 500)) {
    if (launch.stage === 'toss') sfx.strike()
    ready(now)
  }
  return undefined
}

/**
 * Swings at the tossed ball. Returns the meter (0-1) to send when it's a hit; null when it's
 * a whiff (too early or too late); undefined when there's nothing to swing at.
 */
export function swing(now = performance.now()) {
  if (!launch.gripping || launch.released || launch.stage !== 'toss') return undefined
  launch.swungAt = now
  const t = (now - launch.arriveAt) / 1000
  const meter = swingMeterAt(t)
  if (meter <= 0) {
    launch.stage = 'whiff'
    launch.whiffAt = now
    launch.whiffEarly = t < 0
    launch.charge = 0
    return null
  }
  launch.released = true
  launch.releasedAt = now
  launch.accuracy = meter
  launch.charge = meter
  return meter
}

/** The template's name for swinging: kept for its callers. */
export const letGo = swing

/**
 * Presses HIT (the HUD button, the keys, a click, the jump button at bat): near a station
 * but not in its box yet, steps you in and tosses; tosses the ball up when you're ready, swings at it while it's coming down - a hit goes to the
 * authority with the meter as it stood; a whiff whooshes through thin air with a "TOO
 * EARLY!" or "TOO LATE!". Returns 'step', 'toss', the meter of a hit, null for a whiff, or
 * undefined when it did nothing.
 */
export function pressHit(now = performance.now()) {
  // Near a station but not in its box: step in (the player does it) and toss.
  if (!launch.gripping && !launch.released) {
    launch.stepInAt = now
    return 'step'
  }
  if (launch.released) return undefined
  if (launch.stage === 'ready') {
    tossUp(now)
    return 'toss'
  }
  const meter = swing(now)
  if (meter === null) {
    sfx.whiff()
    spawnScattered(launch.whiffEarly ? 'TOO EARLY!' : 'TOO LATE!', { scale: 1.2 })
  } else if (meter !== undefined) {
    actions.roll(Math.round(meter * 1000) / 1000)
  }
  return meter
}

/** The template's (and the clicks') name for pressing HIT. */
export const pressSwing = pressHit

/** The authority's hit has started from your swing: it takes it from here. */
export function consumePull() {
  launch.gripping = false
  launch.auto = false
  launch.released = false
  launch.charge = 0
  launch.stage = 'ready'
}

/** Steps out of the batter's box (walked away, jumped, a panel opened). */
export function cancelPull() {
  launch.gripping = false
  launch.auto = false
  launch.released = false
  launch.charge = 0
  launch.stage = 'ready'
}

/** Whether you're at bat at all: waiting to toss, the ball in the air, or swung and waiting for the answer. */
export const isPulling = () => launch.gripping || launch.released
