import { useEffect, useRef } from 'react'

import { getGame, useGame } from '../../store/game'

/**
 * Opens the Ball Shop's panel when you walk up to its stall (zone.ballShop, from the game
 * ticker) - unless another panel is open or your ball's still flying (then as soon as it
 * lands) - and closes it again if you walk away with it still open. Once a visit: close
 * it while standing there and it stays closed until you leave and come back. Renders
 * nothing.
 */
export function BallShopOpener() {
  const atShop = useGame((s) => s.zone.ballShop)
  const busy = useGame((s) => Boolean(s.roll || s.rollResult))
  /** Whether the panel now open was opened by walking up (so walking off closes it). */
  const opened = useRef(false)
  /** Opened once already this visit (closing it keeps it closed till you come back). */
  const visited = useRef(false)

  useEffect(() => {
    const game = getGame()
    if (atShop) {
      if (!visited.current && !game.panel && !busy) {
        game.openPanel('balls')
        opened.current = true
        visited.current = true
      }
    } else {
      visited.current = false
      if (opened.current) {
        opened.current = false
        if (game.panel === 'balls') game.closePanel()
      }
    }
  }, [atShop, busy])

  return null
}

export default BallShopOpener
