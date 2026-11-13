# +1 Baseball Launch - client

The game's browser client: React 19 + React Three Fiber on three.js, Vite, Tailwind, zustand.

Swing in the batting cages for Power, step up to home plate and time your swing on the
pitch, and send the ball flying and bouncing down the field for Wins. Spend them on 24
bats (wood, bamboo, stone, bone, copper, steel, metal, gold, lava, diamond...), 12 balls
from the Ball Shop (the Fire Ball, Ice Ball, Lightning Ball...), pets and better cages;
rebirth for more Power; open the portal to Lava Land (World 2).

## Scripts

- `npm run dev` - development server (add `?perf` for the r3f-perf overlay, `?debug` for `window.__pp`)
- `npm run build` - production build into `dist/`
- `npm run lint` - ESLint

## Where things live

- `src/game/` - the 3D world: lobby, batting cages, home plate, the ball's flight, avatars, effects
- `src/ui/` - the DOM HUD and panels (each panel a lazily loaded chunk: `ui/panels/panelLoaders.js`)
- `src/net/` - the connection to the game server (or the offline stand-in, `net/localServer.js`)
- `../shared/` - game rules and balance, shared with the server (`balance.js` is every tunable number)
