import { useEffect, useRef, useState } from 'react'

import { BALLS, RARITIES } from '@shared/balance'

import { sfx } from '../../audio/sfx'
import { BALL_LOOK, ballStyle } from '../../game/balls'
import { actions } from '../../net/actions'
import { useGame } from '../../store/game'
import Icon from '../Icon'
import StrokeText from '../StrokeText'
import { ChunkyButton, Price } from '../hud/parts'
import { GRADIENTS, u } from '../hud/style'
import Panel from './Panel'

/**
 * The BALL SHOP: every ball in balance BALLS, bought one after another and equipped from
 * here. Each flies further, pays more and bounces its own way, and the fancy ones burn,
 * freeze or crackle all the way down the field. Opened from the left menu, or by walking
 * up to the Ball Shop's stall (BallShopOpener).
 *
 * Every ball is drawn in plain CSS - gradients, a pair of stitched seams, a glow that
 * flickers like fire or pulses like plasma - from the same colours the 3D ball is painted
 * with (game/balls.js), so the shop shows what you'll hit. No images to load.
 */

/** Keyframes for the swatches, scoped by the `bp-` prefix; mounted with the panel. */
const SWATCH_CSS = `
@keyframes bp-flicker { 0%, 100% { filter: brightness(1); transform: scale(1); } 30% { filter: brightness(1.18); transform: scale(1.03); } 60% { filter: brightness(0.94); transform: scale(0.99); } }
@keyframes bp-pulse { 0%, 100% { filter: brightness(1); } 50% { filter: brightness(1.22); } }
@keyframes bp-spin { to { transform: rotate(360deg); } }
@keyframes bp-flame { 0% { transform: translateY(0) scale(1); opacity: 0.95; } 100% { transform: translateY(-38%) scale(0.35); opacity: 0; } }
@keyframes bp-pop { 0% { transform: scale(1); } 35% { transform: scale(1.08); } 100% { transform: scale(1); } }
.bp-fire { animation: bp-flicker 0.42s ease-in-out infinite; }
.bp-glow { animation: bp-pulse 1.4s ease-in-out infinite; }
.bp-spin { animation: bp-spin 4s linear infinite; }
.bp-pop { animation: bp-pop 0.5s ease-out; }
.bp-flame { position: absolute; border-radius: 50% 50% 45% 45%; animation: bp-flame 0.7s ease-out infinite; pointer-events: none; }
`

const RAINBOW_STOPS = '#ff3b5c, #ff9a1f, #ffe53b, #4ef05a, #2fc6ff, #6a5cff, #ff4fd8'
const RAINBOW_CONIC = `conic-gradient(from 20deg, ${RAINBOW_STOPS}, #ff3b5c)`
/** Where the shine sits on every ball: top left. */
const SHINE = 'radial-gradient(circle at 32% 26%, rgba(255,255,255,0.9) 0 7%, rgba(255,255,255,0.25) 13%, transparent 22%)'
const SHADE = 'radial-gradient(circle at 40% 36%, transparent 45%, rgba(0,0,0,0.35) 100%)'

/** The ball's surface, as CSS backgrounds, for its look (BALL_LOOK). */
function surface(s) {
  switch (s.look) {
    case BALL_LOOK.BANDED:
      return `linear-gradient(170deg, transparent 38%, ${s.b} 39% 55%, transparent 56%), radial-gradient(circle at 38% 34%, ${s.a}, ${s.a} 60%, ${s.a})`
    case BALL_LOOK.FLAME:
      return `radial-gradient(circle at 50% 62%, ${s.c} 0 18%, ${s.b} 42%, ${s.a} 78%)`
    case BALL_LOOK.CRYSTAL:
      return `conic-gradient(from 15deg, ${s.a}, ${s.b}, ${s.c}, ${s.b}, ${s.a}, ${s.c}, ${s.b}, ${s.a})`
    case BALL_LOOK.CRACKED:
      return [
        `linear-gradient(62deg, transparent 47%, ${s.b} 48% 51%, transparent 52%)`,
        `linear-gradient(-28deg, transparent 58%, ${s.b} 59% 61.5%, transparent 62.5%)`,
        `linear-gradient(140deg, transparent 30%, ${s.c} 31% 33%, transparent 34%)`,
        `linear-gradient(15deg, transparent 72%, ${s.b} 73% 75%, transparent 76%)`,
        `radial-gradient(circle at 40% 36%, ${s.a}, ${s.a})`,
      ].join(', ')
    case BALL_LOOK.GLOSS:
      return `radial-gradient(circle at 38% 34%, #ffffff 0 6%, ${s.a} 30%, ${s.b} 100%)`
    case BALL_LOOK.RAINBOW:
      return RAINBOW_CONIC
    case BALL_LOOK.GALAXY:
      return [
        'radial-gradient(circle at 28% 62%, #fff 0 1.6%, transparent 2.4%)',
        'radial-gradient(circle at 66% 30%, #fff 0 1.3%, transparent 2.1%)',
        'radial-gradient(circle at 72% 70%, #fff 0 1.1%, transparent 1.9%)',
        'radial-gradient(circle at 46% 46%, #fff 0 0.9%, transparent 1.6%)',
        `radial-gradient(ellipse at 60% 55%, ${s.c}aa 0%, transparent 38%)`,
        `radial-gradient(ellipse at 35% 40%, ${s.b} 0%, transparent 55%)`,
        `radial-gradient(circle at 50% 50%, ${s.a}, ${s.a})`,
      ].join(', ')
    case BALL_LOOK.VOID:
      return `radial-gradient(circle at 50% 50%, ${s.a} 0 46%, ${s.b} 58%, ${s.c} 64%, ${s.b} 70%, ${s.a} 86%)`
    default:
      return `radial-gradient(circle at 38% 34%, ${s.a}, ${s.b} 85%)`
  }
}

/** One stitched seam curling round the ball, on side -1 (left) or 1 (right). */
function Seam({ side, color, size }) {
  return (
    <span
      className="pointer-events-none absolute"
      style={{
        width: '96%',
        height: '96%',
        top: '2%',
        [side < 0 ? 'left' : 'right']: '-66%',
        borderRadius: '50%',
        border: `${u(Math.max(1.5, size * 0.035))} dashed ${color}`,
        boxShadow: `0 0 0 ${u(Math.max(0.6, size * 0.012))} ${color}55`,
      }}
    />
  )
}

/**
 * A CSS ball for ball `id`, `size` reference pixels across (scaled like the rest of the
 * HUD: style.u). `trail` draws its comet tail streaming out to the left, in its trail
 * colours.
 */
export function BallSwatch({ id, size = 96, trail = false }) {
  const s = ballStyle(id)
  const glow = s.glow ?? 0
  const animated = s.fx === 'fire' || s.fx === 'smoke' ? 'bp-fire' : glow >= 0.3 ? 'bp-glow' : ''
  const stitched = s.look === BALL_LOOK.STITCHED
  return (
    <span className="relative inline-block shrink-0" style={{ width: u(size), height: u(size) }}>
      {trail && (
        <span
          className="pointer-events-none absolute"
          style={{
            right: '50%',
            top: '22%',
            width: u(size * 1.9),
            height: '56%',
            borderRadius: `${u(size)} 0 0 ${u(size)}`,
            background: s.rainbow
              ? `linear-gradient(270deg, #ffffffcc, ${RAINBOW_STOPS}, transparent)`
              : `linear-gradient(270deg, ${s.head}ee 0%, ${s.tail}99 55%, transparent 100%)`,
            filter: `blur(${u(size * 0.04)})`,
            clipPath: 'polygon(0 45%, 100% 0, 100% 100%, 0 55%)',
          }}
        />
      )}
      <span
        className={`absolute inset-0 overflow-hidden rounded-full ${animated}`}
        style={{
          background: `${SHINE}, ${SHADE}, ${surface(s)}`,
          border: `${u(Math.max(2, size * 0.045))} solid #111`,
          boxShadow: glow > 0 ? `0 0 ${u(size * 0.32 * glow)} ${u(size * 0.06 * glow)} ${s.head}` : 'none',
        }}
      >
        {stitched && <Seam side={-1} color={s.c} size={size} />}
        {stitched && <Seam side={1} color={s.c} size={size} />}
        {s.look === BALL_LOOK.RAINBOW && <span className="bp-spin absolute inset-0 rounded-full" style={{ background: `${SHINE}, ${RAINBOW_CONIC}`, opacity: 0.55 }} />}
      </span>
      {s.fx === 'fire' &&
        [0, 1, 2].map((i) => (
          <span
            key={i}
            className="bp-flame"
            style={{
              left: `${14 + i * 24}%`,
              top: `${-26 + (i % 2) * 8}%`,
              width: '38%',
              height: '62%',
              background: `radial-gradient(ellipse at 50% 75%, ${s.c} 0%, ${s.b} 38%, ${s.a}cc 58%, ${s.a}00 74%)`,
              mixBlendMode: 'screen',
              animationDelay: `${i * 0.23}s`,
            }}
          />
        ))}
    </span>
  )
}

const pct = (reach) => Math.round((reach - 1) * 100)
const winsText = (wins) => `x${Math.round(wins * 100) / 100}`

/** A ball's three numbers, as small chips. */
function Stats({ ball, size = 22 }) {
  const chip = (icon, text, fill) => (
    <span className="inline-flex items-center" style={{ gap: u(4), padding: `${u(2)} ${u(10)} ${u(2)} ${u(4)}`, borderRadius: u(20), background: 'rgba(0,0,0,0.38)' }}>
      <Icon name={icon} size={u(size * 1.25)} />
      <StrokeText stroke={u(size * 0.22)} fill={fill}>
        {text}
      </StrokeText>
    </span>
  )
  const reach = pct(ball.reach)
  return (
    <span className="flex flex-wrap items-center justify-center" style={{ gap: u(6), fontSize: u(size) }}>
      {chip('fastForward', reach > 0 ? `+${reach}% Distance` : 'Normal Distance', '#9fe8ff')}
      {chip('trophy', `${winsText(ball.wins)} Wins`, '#ffe066')}
      {chip('ball', `${ball.bounce} Bounces`, '#ffffff')}
    </span>
  )
}

function RarityTag({ rarity, size = 24 }) {
  const r = RARITIES[rarity]
  return (
    <span style={{ fontSize: u(size) }}>
      {rarity === 'secret' ? (
        <StrokeText stroke={u(size * 0.24)} gradient={GRADIENTS.rainbow}>
          {r.name.toUpperCase()}
        </StrokeText>
      ) : (
        <StrokeText stroke={u(size * 0.24)} fill={r.color}>
          {r.name.toUpperCase()}
        </StrokeText>
      )}
    </span>
  )
}

/** The ball you're hitting now, big, with its trail and numbers. */
function Equipped({ ball }) {
  return (
    <div
      className="flex flex-wrap items-center justify-center"
      style={{
        gap: u(24),
        padding: `${u(16)} ${u(20)}`,
        borderRadius: u(10),
        border: `${u(5)} solid #111`,
        background: 'radial-gradient(ellipse at 30% 50%, #3a5fb0 0%, #1d2a5c 60%, #101634 100%)',
        boxShadow: `inset 0 ${u(4)} 0 rgba(255,255,255,0.12)`,
      }}
    >
      <span style={{ paddingLeft: u(110) }}>
        <BallSwatch id={ball.id} size={130} trail />
      </span>
      <div className="flex flex-col items-center" style={{ gap: u(6), minWidth: 0 }}>
        <span style={{ fontSize: u(24) }}>
          <StrokeText stroke={u(5)} fill="#7dff4a">
            EQUIPPED
          </StrokeText>
        </span>
        <span style={{ fontSize: u(54), lineHeight: 1 }}>
          <StrokeText stroke={u(10)}>{ball.name}</StrokeText>
        </span>
        <RarityTag rarity={ball.rarity} size={28} />
        <Stats ball={ball} size={24} />
      </div>
    </div>
  )
}

/**
 * One ball's card: its swatch, name, rarity, numbers and what you can do with it -
 * EQUIPPED, EQUIP, BUY (the next one along) or LOCKED (buy the one before first).
 */
function BallCard({ ball, index, state, wins, popped }) {
  const faded = state === 'locked'
  const afford = wins >= ball.cost
  const onBuy = () => {
    if (!afford) {
      sfx.error()
      return
    }
    actions.buyBall(ball.id)
  }
  return (
    <div
      className={`flex flex-col items-center text-center ${popped ? 'bp-pop' : ''}`}
      style={{
        gap: u(6),
        padding: u(10),
        borderRadius: u(8),
        border: `${u(5)} solid ${state === 'equipped' ? '#7dff4a' : '#111'}`,
        background: faded ? GRADIENTS.greyButton : state === 'buy' ? GRADIENTS.rewardCard : 'linear-gradient(180deg, #4a5674 0%, #2c344d 100%)',
        opacity: faded ? 0.8 : 1,
      }}
    >
      <span style={{ marginTop: u(6), filter: faded ? 'saturate(0.8) brightness(0.92)' : 'none' }}>
        <BallSwatch id={ball.id} size={84} />
      </span>
      <span style={{ fontSize: u(ball.name.length > 12 ? 26 : 30), lineHeight: 1.05 }}>
        <StrokeText stroke={u(6)} style={{ whiteSpace: 'normal' }}>
          {ball.name}
        </StrokeText>
      </span>
      <RarityTag rarity={ball.rarity} size={20} />
      <Stats ball={ball} size={17} />
      <div className="mt-auto w-full" style={{ paddingTop: u(6) }}>
        {state === 'equipped' && (
          <ChunkyButton gradient={GRADIENTS.greyButton} disabled className="w-full" style={{ height: u(58), gap: u(6) }}>
            <Icon name="check" size={u(34)} />
            <span style={{ fontSize: u(28) }}>
              <StrokeText stroke={u(6)}>Equipped</StrokeText>
            </span>
          </ChunkyButton>
        )}
        {state === 'owned' && (
          <ChunkyButton gradient={GRADIENTS.blueButton} onClick={() => actions.equipBall(ball.id)} className="w-full" style={{ height: u(58) }}>
            <span style={{ fontSize: u(30) }}>
              <StrokeText stroke={u(6)}>Equip</StrokeText>
            </span>
          </ChunkyButton>
        )}
        {state === 'buy' && (
          <ChunkyButton gradient={afford ? GRADIENTS.greenButton : GRADIENTS.redButton} onClick={onBuy} className={`w-full ${afford ? 'pp-bounce' : ''}`} style={{ height: u(58) }}>
            {ball.cost === 0 ? (
              <span style={{ fontSize: u(30) }}>
                <StrokeText stroke={u(6)}>Free</StrokeText>
              </span>
            ) : (
              <Price amount={ball.cost} size={30} afford={afford} />
            )}
          </ChunkyButton>
        )}
        {state === 'locked' && (
          <div
            className="flex w-full flex-col items-center justify-center"
            style={{ minHeight: u(58), borderRadius: u(10), border: `${u(4)} solid #111`, background: 'rgba(0,0,0,0.35)', padding: `${u(2)} ${u(6)}` }}
          >
            <Price amount={ball.cost} size={22} afford={false} />
            <span style={{ fontSize: u(16) }}>
              <StrokeText stroke={u(4)} style={{ whiteSpace: 'normal' }}>
                Buy the {BALLS[index - 1].name} first
              </StrokeText>
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

const GRID = { gridTemplateColumns: `repeat(auto-fill, minmax(${u(230)}, 1fr))`, gap: u(12) }

export function BallsPanel() {
  // As strings: the profile is a fresh object after every update (a swing, a rep...).
  const ownedKey = useGame((s) => (s.profile.ownedBalls || ['baseball']).join(','))
  const equipped = useGame((s) => s.profile.equippedBall || 'baseball')
  const wins = useGame((s) => s.profile.wins)
  const owned = ownedKey.split(',')
  const equippedBall = BALLS.find((b) => b.id === equipped) || BALLS[0]

  // A ball just bought: its card pops.
  const [popped, setPopped] = useState(null)
  const count = useRef(owned.length)
  useEffect(() => {
    const now = ownedKey.split(',')
    if (now.length > count.current) setPopped(now[now.length - 1])
    count.current = now.length
  }, [ownedKey])
  useEffect(() => {
    if (!popped) return undefined
    const id = setTimeout(() => setPopped(null), 600)
    return () => clearTimeout(id)
  }, [popped])

  const stateOf = (ball, index) => {
    if (ball.id === equipped) return 'equipped'
    if (owned.includes(ball.id)) return 'owned'
    if (index === 0 || owned.includes(BALLS[index - 1].id)) return 'buy'
    return 'locked'
  }

  return (
    <Panel title="BALL SHOP" icon="ball" width={1120}>
      <style>{SWATCH_CSS}</style>
      <div className="flex flex-col" style={{ gap: u(16) }}>
        <Equipped ball={equippedBall} />
        <p className="m-0 text-center" style={{ fontSize: u(24) }}>
          <StrokeText stroke={u(5)} style={{ whiteSpace: 'normal' }}>
            Better balls fly further, pay more Wins on every hit - and the fancy ones leave a trail of fire, ice or lightning!
          </StrokeText>
        </p>
        <div className="grid" style={GRID}>
          {BALLS.map((ball, i) => (
            <BallCard key={ball.id} ball={ball} index={i} state={stateOf(ball, i)} wins={wins} popped={popped === ball.id} />
          ))}
        </div>
      </div>
    </Panel>
  )
}

export default BallsPanel
