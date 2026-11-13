import { BAT_STYLES, batBase, batTrail } from './bats'

/**
 * Each bat's colours, by bat id (the ids are the template's tire ids, kept for saves;
 * names and stats live in shared/balance.js, and how each bat looks is bats.js). Named for
 * the template, so everything that tinted itself by your tire - the stands, the landing's
 * glow, the speed lines - now takes your bat's colours. `trail` is the glow colour; `a`
 * is the bat's base colour.
 */
export const TIRE_STYLES = BAT_STYLES

export const tireRim = (id) => batBase(id)
export const tireGlow = (id) => batTrail(id)
