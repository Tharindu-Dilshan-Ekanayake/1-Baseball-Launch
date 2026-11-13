import { STATION_COUNT, stationAt } from '@shared/world'

import { remotePlayers } from '../net/remotePlayers'

/** How near a station's batter spot another player must stand, up at bat, to hold it. */
const HOLD_RADIUS = 1.1

/** Per station: 1 while another player is up at bat (or mid-hit) there. Rewritten by takenStations. */
export const taken = new Uint8Array(STATION_COUNT)

/**
 * Which batting stations other players hold right now (up at bat, or watching their hit
 * fly, standing in its batter's box): writes `taken` and returns it. Cheap - a handful of
 * players and ten stations - and allocation-free, so the player, the station rings and
 * the pitchers can each call it every frame.
 */
export function takenStations() {
  taken.fill(0)
  for (const r of remotePlayers.values()) {
    if (r.anim !== 'pull' && !r.hitting) continue
    const s = stationAt(r.position.x, r.position.z, HOLD_RADIUS)
    if (s >= 0) taken[s] = 1
  }
  return taken
}
