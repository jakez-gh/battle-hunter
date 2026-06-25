# What makes Battle Hunter fun — and bought

Research-backed design principles (Jake-directed, 2026-06-25). The 2026-06-20
multi-agent workflow already surveyed *comparable titles + monetization* (see
`WORK.md`). This doc goes one level deeper — the **fundamentals** of (1) why games
are fun and (2) why people pay — and translates each into a concrete, prioritized
action for *this* game. Sources at the bottom.

---

## Part 1 — What makes a game fun

**F1. A game is a series of interesting decisions** (Sid Meier). A choice is
"interesting" when the player has enough information to strategize but no single
option is obviously best, *and the consequences are visible*. A choice you can't
reason about is just anxiety.
→ **BH:** the decision points are steering, *descend-or-bank*, perk picks, and the
combat response (Counter/Guard/Escape/Surrender). Each must be a real dilemma with
legible stakes. The steering range/path overlay and the pre-attack advantage
readout exist precisely to give players the information that makes these choices
*interesting* rather than blind. **No auto-pick perks** (ADR/ROADMAP already says
breadth-not-power) — an obvious best choice is a non-choice.

**F2. Fun is learning; play continues while mastery is unfinished** (Raph Koster —
the "possibility space"). A game stops being fun the moment it's *solved*.
→ **BH:** depth must reward learning — card/perk synergies, reading AI archetypes,
risk timing. Variety (perks, run modifiers, the daily seed) is what keeps it
unsolved. This is the strategic case for Relic Dive over a fixed 15-mission arc.

**F3. Flow = challenge matched to skill** (Csikszentmihalyi). Too easy bores, too
hard frightens; the sweet spot is a rising curve.
→ **BH:** difficulty options (the Easy/Normal/Hard AI reflex) and escalating relic
depth in a Dive give the curve; reroll/agency tools soften variance spikes that
would otherwise knock players out of flow.

**F4. Juice is the difference between "works" and "feels great"** (Vlambeer, *Juice
it or Lose it*). Screen-shake, freeze-frames, scaled audio, and exaggeration
*reinforce existing mechanics* — and they are also the clip-worthy moments that
sell the game on a stream.
→ **BH:** the combat-juice pass, WYRM-spawn cinematic, and magnitude-scaled audio
are not polish-for-polish — they are simultaneously the feel lever and the
marketing lever. Keep investing here.

**F5. ⚠ The load-bearing risk: Battle Hunter is OUTPUT-randomness-heavy.** Players
tolerate **input randomness** (revealed *before* you decide → you adapt → agency)
far more than **output randomness** (rolled *after* you commit → "I lost and it
wasn't my fault"). BH rolls 2d6 *after* you choose to move and *after* you commit
to a battle — the least-forgiving kind. This is the single biggest threat to the
game feeling fair and fun.
→ **BH levers, in priority order:**
  1. **Lean on the input-randomness the game already has.** Hands are public and
     the deck is a known quantity — that *is* input randomness. Surface it: show
     odds and known cards so the player decides *with* information.
  2. **Give agency tools over the output rolls:** a per-mission **Fortune reroll
     token**, a pre-commit **advantage readout** (win-odds / expected damage), and
     a post-battle **math summary** ("you 9+3 vs 7+2 — win by 3"). These don't
     remove dice; they make a loss legible and a win earned.
  3. **Never silently fudge seeded/daily rolls** — that breaks the determinism the
     whole Relic Dive/Daily Hunt rests on (ADR-0005). Any smoothing is Story-only
     and display-honest.

**F6. The first session must crystallize the game's identity fast and grant an
early win.** Teach by *doing*, not walls of text; keep any tutorial < 5 minutes and
skippable; the opening *is* the whole game in miniature.
→ **BH:** the title→hub→creation→first-mission path front-loads systems and a
9-page manual. The demo needs a *fast path to a first win that teaches by playing*
— this is both a fun lever and (Part 2) the #1 purchase lever.

**F7. Replayability is agency that survives repetition.** Meta-progression should
unlock **options/breadth, not raw power** — power-creep re-solves the game and
kills F2. Run variety + alternative challenges keep mastery alive.
→ **BH:** Relic Dive perks (breadth, capped stats — already designed this way) +
Phase 3 modifiers + the daily compare loop. Do **not** turn the hospital/perk
economy into a vertical power treadmill.

## Part 2 — What drives the purchase decision

**P1. The free demo *is* the marketing — and the real predictor is demo PLAYTIME,
not wishlist count.** The signal that converts is *demo-to-wishlist attachment*
(~20% is the magic number) and players who sink >1 hour. A demo that exposes a lack
of polish actively *hurts*.
→ **BH:** the free itch/web build is the demo. Polish it before pushing it.
Instrument for session length and a prominent "Wishlist on Steam" CTA. The Daily
Hunt is the perfect demo — short, repeatable, identity-crystallizing.

**P2. Wishlists are market-validation to the Steam algorithm *and* to you.** You
need **~2,000 wishlists before Next Fest** to see meaningful results (<1,000 →
negligible). **Under ~50 reviews you effectively don't exist** on Steam.
→ **BH:** open a Steam "Coming Soon" page *now* and accrue wishlists for months via
the daily-share loop and streamer clips; only enter Next Fest past ~2k.

**P3. The store page is a multiplier on all marketing** — capsule, a trailer with
real gameplay in the first seconds, and correct tags.
→ **BH:** lead the capsule/trailer with the hook — *"four hunters race a procedural
dungeon for a hidden relic — dice, cards, a ticking deck-monster doomsday clock;
one seed, one daily run, race your friends"* — **not** "1999 PS1 clone."

**P4. Streamability and shareability drive organic discovery** (and demos belong in
streamers' hands). Clip-worthy moments + a shareable artifact are the viral engine.
→ **BH:** the WYRM cinematic, last-second relic steals, and the Wordle-style daily
share string *are* that engine. F4 and P4 are the same investment.

**P5. Price psychology.** $1–10 reads as "hyper-casual / very short"; **$15+ sharply
raises expectations**; left-digit bias is real ($9.99 ≪ $10, $14.99 ≪ $15); a higher
price can *signal* higher quality; anchor with a launch discount.
→ **BH:** target **$9.99–$12.99**; never ≤ $4.99 (signals low quality). List $12.99
with a launch discount to ~$10.39 (fires the wishlist email), or $9.99 flat. Keep
the web build free forever as the demo/funnel. No F2P/ads/IAP.

## Synthesis — Battle Hunter's three highest-leverage truths

1. **Tame the output randomness or the rest doesn't matter (F5).** This is the core
   fun-risk unique to a dice+card game. Agency tools (odds readout, reroll, post-hoc
   math) and leaning on the public-hand input randomness are top priority. *Promoted
   from "quick win" to design principle.*
2. **The demo's first 5 minutes are the whole business (F6 + P1 + P2).** A polished,
   identity-crystallizing, early-win first run drives demo playtime → wishlists →
   sales. The Daily Hunt is the ideal demo shape.
3. **Feel and marketing are one budget (F4 + P4).** Every hour of juice is also an
   hour of marketing, because the clip *is* the ad.

## Re-prioritized actions (grounded in the above)

**Do next (highest fun-/purchase-per-effort):**
- Finish the **agency-over-dice** suite: advantage readout (odds), Fortune reroll,
  post-battle math. *(F5 — engine odds module shipped alongside this doc.)*
- Design a **"first run" demo path**: fast hunter pick → a short, winnable first
  dungeon that teaches by doing → an early win → the daily-share prompt. *(F6/P1)*
- Keep the **juice + WYRM cinematic + daily-share** loop polished. *(F4/P4)*
- Open the **Steam "Coming Soon" page**; write the hook-first capsule/trailer. *(P2/P3)*

**Hold the line on:**
- Perks/modifiers = **breadth, not power** (F2/F7). Audit every perk against
  "is this an auto-pick?" and "does this re-solve the game?"
- **No silent dice-fudging** in seeded/daily modes (F5/ADR-0005).

**Don't:**
- Don't ship the demo before it's polished — an unpolished demo converts *negative*
  (P1).
- Don't price ≤ $4.99 or build F2P/ads (P5).
- Don't add a vertical power treadmill to the meta (F7).

---

## Sources

Fun / design theory:
- [Sid Meier on interesting decisions (GDC 2012)](https://www.gamedeveloper.com/design/gdc-2012-sid-meier-on-how-to-see-games-as-sets-of-interesting-decisions) · [Designing Interesting Decisions](https://www.gamedeveloper.com/design/designing-interesting-decisions-in-games-and-when-not-to-)
- [Decision-Making and Flow Theory (Game Design Concepts)](https://gamedesignconcepts.wordpress.com/2009/07/20/level-7-decision-making-and-flow-theory/)
- [Squeezing more juice out of your game design (Vlambeer / GameAnalytics)](https://www.gameanalytics.com/blog/squeezing-more-juice-out-of-your-game-design) · [Juice it or Lose it](https://gamejuice.co.uk/resources/juice-it-or-lose-it)
- [What makes or breaks agency in roguelikes](https://thom.ee/blog/what-makes-or-breaks-agency-in-roguelikes/) · [Designing for Mastery in Roguelikes (Grid Sage)](https://www.gridsagegames.com/blog/2025/08/designing-for-mastery-in-roguelikes-w-roguelike-radio/)
- [Input vs Output Randomness (Skeleton Code Machine)](https://www.skeletoncodemachine.com/p/input-output-randomness-part-1) · [Effect of Input-output Randomness on CCG satisfaction (arXiv)](https://arxiv.org/pdf/2107.08437) · [The 2 types of randomness (Board Game Design Course)](https://boardgamedesigncourse.com/the-2-types-of-randomness/)
- [How to Hook Players in the First 10 Minutes (Game-Changr)](https://www.game-changr.com/post/stop-teaching-start-seducing-how-to-make-players-fall-in-love-in-10-minutes)

Purchase decision / marketing:
- [Wishlist-to-buyer conversions for Next Fest demos (Alinea Analytics)](https://alineaanalytics.substack.com/p/wishlist-to-buyer-conversions-for) · [Next Fest may matter less than you think (Alinea)](https://alineaanalytics.substack.com/p/steam-next-fests-winners-and-why)
- [Next Fest wishlist benchmarks (How To Market A Game / Zukowski)](https://howtomarketagame.com/2025/03/26/benchmarks-how-many-wishlists-can-i-get-from-steam-next-fest/) · [Steam page launch guide (Zukowski / Game World Observer)](https://gameworldobserver.com/2025/03/11/steam-page-launch-guide-wishlists-zukowski)
- [Steam Game Pricing Strategy 2026 (Datahumble)](https://datahumble.com/blog/steam-game-pricing-strategy) · [Pricing Psychology Traps (Indie Launch Lab)](https://indielaunchlab.com/blog/pricing-psychology-traps-how-indie-developers-price-themselves-out-of-success)
