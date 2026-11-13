---
canDie: false
hasScore: true
---

# +1 Baseball Launch: Boxity integration

The player cannot die: there is no death or game-over screen. You swing in the batting
cages for Power, step up to home plate and time your swing on the pitch (the swing meter
peaks as the ball crosses the plate - PERFECT for up to x1.5 distance and x1.6 Wins), and
the ball flies down the field, bouncing to a stop: more Power hits it further, and every
metre it travels pays Wins. You always get another pitch. Your bat (24 kinds, each its own
shape - wood, bamboo, stone, bone, copper, steel, metal, gold, lava, diamond... - bought
with Wins, carried on your back) sets how much Power each gain is worth; your ball (12
kinds from the Ball Shop, the Fire Ball leaving a trail of flames) flies further and pays
more. Rebirth 8 times and hold 1M Wins to open the portal to Lava Land (World 2, x3 Wins).

Built on the +1 Tire Rolling template: inside the code the old names stay (`health` is
Power, a `tire` is a bat, a `pad` is a batting cage, a `roll` is a hit).

## Leaderboards

Scores are reported by the **game server**, never by the client
(`server/src/bloxityLeaderboards.js`, `BLOXITY_LEADERBOARDS`). Every ~20 s and when a
player leaves, each pod sends the changed scores of its verified players to
`POST {api}/v1/leaderboards/hosted/{BLOXITY_GAME_ID}/report` as `legion_<userId>`.

| Board      | Label            | Score                                | Format  |
|------------|------------------|--------------------------------------|---------|
| `rebirths` | Rebirths         | `profile.rebirths`                   | number  |
| `wins`     | Total Wins       | `profile.stats.totalWins`            | compact |
| `distance` | Longest Hit (m)  | `floor(profile.stats.bestDistance)`  | compact |
| `playtime` | Minutes Played   | `floor(profile.stats.playtime / 60)` | number  |

All four are `order: desc`, `mode: best`, `reset: none`.

## Gems purchases

Boxity's purchase webhook goes to `POST /api/gems/webhook` on the game server. It is
recorded in the database by `transactionId` (idempotent) and applied exactly once by
the pod the buyer plays on. Unknown skus are answered 400 so Boxity refunds them.

## Rewarded ads

The client sends `adReward { placement, rewardToken }`; the server verifies the token
with `POST {api}/v1/ads/reward/verify` before granting anything.

The game shows **no automatic ads**: no screen/banner ads over gameplay or panels (the
client never calls `ads.screen`), and no ads on a timer. The only ads are the rewarded
ones a player asks for by tapping **Watch Ad** in the Store (a popup button).

## Open Rooms

Each pod reports its rooms every 2 s to `POST {MATCHMAKER_REPORT_URL}/{BLOXITY_GAME_ID}/rooms`
(`server/src/legionRoomReporter.js`, installed after `listen()`), so they show under
"Open Rooms" on the game page. The client joins `?roomId=` at launch and falls back to
normal matchmaking if that room is gone or full.

## Avatars

`client/src/game/PlayerAvatar.jsx` + `avatarRig.js` draw every slot: skin (with face,
shirt and pants), body parts, hat + hair + mask on `Neck1`, back on `Spine2`, neck/chest
on `Spine2` and waist on `Spine1` (rest-inverse placement), hands and shoes as mirrored
pairs following the leaf bones' position and rotation only. A player wearing an uploaded
character (`characterId`) gets its GLB via `avatar.getCharacter()` / `getCharacterFor()`,
with accessories fitted by `characterAccessoryMatrix`; on any failure the regular avatar
shows. Body proportions are applied by moving bones, so accessories follow them.

## Server environment

| Variable                | Purpose                                                       |
|-------------------------|---------------------------------------------------------------|
| `BLOXITY_REPORT_TOKEN`  | Token for leaderboard and room reports (none set = no reports) |
| `MATCHMAKER_REPORT_URL` | Where the Open Rooms reporter posts (injected by Boxity hosting) |
| `BLOXITY_GAME_ID`       | Hosted game id for reports (default `1-baseball-launch`; set it for this game) |
| `LEGION_WEBHOOK_SECRET` | Must match the webhook's `x-legion-webhook-secret` header     |
| `MONGODB_URI`           | Shared database for profiles and Gems grants (SQLite without) |
| `BLOXITY_API_URL` etc.  | Platform URLs; production defaults (`server/src/bloxityEnv.js`) |
