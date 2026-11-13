import { CLICK_INTERVAL } from '@shared/balance'

import { sfx } from '../audio/sfx'
import { actions } from '../net/actions'
import { getGame } from '../store/game'
import { isPulling, pressSwing } from './launch'
import { SWING_CONTACT } from './playerPose'
import { roll } from './roll/rollControl'
import { runtime } from './runtime'

/** Seconds from the click to the bat swinging: you toss the ball up first. */
export const TOSS_S = 0.22
/** Seconds from the click to the bat meeting the ball (the Power gain lands then). */
export const CLICK_CONTACT = TOSS_S + SWING_CONTACT
/** Seconds a click swing keeps you planted, and how long its pose plays in all. */
export const CLICK_PLANT_S = TOSS_S + 0.32
export const CLICK_POSE_S = TOSS_S + 0.52

/**
 * The click swings (shared/balance CLICK_INTERVAL): click or tap anywhere in the lobby -
 * not on the HUD - and you toss a ball up and smack it, for one Power gain. The last two
 * swings, newest first: when each started (performance.now(), 0 never), where you stood
 * and which way you faced (the ball flies that way). Read every frame by the player (the
 * pose) and the training balls (the ball); written only by tapSwing.
 */
export const clicks = [
  { at: 0, x: 0, y: 0, z: 0, yaw: 0 },
  { at: 0, x: 0, y: 0, z: 0, yaw: 0 },
]

/**
 * A click or tap on the 3D view. Up at bat it swings at the pitch; in a cage, mid-hit or
 * in the air it does nothing (the cage swings for you); otherwise, once CLICK_INTERVAL
 * has passed since the last, a click swing - the server pays it as the bat meets the
 * ball. Returns whether it swung.
 */
export function tapSwing(now = performance.now()) {
  const player = runtime.player
  if (roll.active || player.frozen || getGame().panel) return false
  if (isPulling()) {
    pressSwing(now)
    return true
  }
  if (player.cage >= 0 || !player.grounded) return false
  if (now - clicks[0].at < CLICK_INTERVAL * 1000) return false
  // The older swing makes way for this one.
  const [newest, older] = clicks
  Object.assign(older, newest)
  newest.at = now
  newest.x = player.position.x
  newest.y = player.position.y
  newest.z = player.position.z
  newest.yaw = player.yaw
  sfx.swingWhoosh()
  setTimeout(() => {
    sfx.tok()
    actions.clickSwing()
  }, CLICK_CONTACT * 1000)
  return true
}

/** Seconds since your latest click swing started (Infinity if none). */
export const sinceClick = (now = performance.now()) => (clicks[0].at ? (now - clicks[0].at) / 1000 : Infinity)
