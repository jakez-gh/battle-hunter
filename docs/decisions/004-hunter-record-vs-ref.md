# ADR 004: Hunter record vs. hunter ref — the `.kind` field split

- **Status:** accepted
- **Date:** 2026-06-17
- **Level:** architecture

## Question

`state.hunters[i]` objects don't carry a `.kind` field. Only the *reference
objects* (`state.current`, `battle.attacker`, `battle.defender`) have
`{ kind: 'hunter' | 'monster', index }`. Code that checks `unit.kind ===
'hunter'` on a raw hunter record will always get `undefined`, which evaluates
falsy — silently wrong. How should engine code distinguish hunters from
monsters, and how should this be documented to prevent the same bug from
recurring?

## Options considered

1. **Add `kind: 'hunter'` to every hunter record** — consistent; no two-tier
   split. Con: bloats every record in saved state; `kind` means "species" on
   monster records (`'VAC'`, `'OOZ'`, `'FNG'`, `'WYRM'`), so reusing the field
   name for `'hunter'` is a type collision.

2. **Keep the split; use refs for identity, records for data** — refs
   (`{kind, index}`) are lightweight pointers into the state arrays; records
   are the mutable data objects. Engine code that needs to know "is this a
   hunter or a monster?" must operate on a ref, not a resolved record. Con:
   callers must keep refs and records separate — easy to confuse.

3. **Add a separate `_kind` field to hunter records** — avoids the collision
   but adds a redundant field.

## Research / findings

The bug surfaced in `getAdjacentEnemies` and `getNextCurrent` (commit `2d8cb05`):
both checked `unit.kind === 'hunter'` after calling `resolveUnit()`, which
returns the raw hunter record. Because hunter records have no `.kind`, the
check silently evaluated to `false` even for hunters.

Monster records DO carry `.kind` because they need it for species-specific
logic (crit riders, drop tables). Sharing the same field for a categorical
`'hunter'` tag would shadow this.

The correct pattern — already used in `resolveUnit` itself — is to check the
*ref object* before resolving:

```js
if (candidate.kind === 'hunter') { ... }    // ✓  ref has kind
const unit = resolveUnit(state, candidate); // resolve only for data
```

Not:

```js
const unit = resolveUnit(state, candidate);
if (unit.kind === 'hunter') { ... }         // ✗  hunter record has no .kind
```

## Decision

Keep the split (option 2). Hunter records carry no `.kind` field. Monster
records carry `kind` as their species tag. All hunter-vs-monster identity
checks must use the ref object, not the resolved record.

## Why

Adding `kind: 'hunter'` to every record would create a naming collision with
the species-level `kind` on monster records. The split is already structurally
sound: `state.current`, `battle.attacker`, and `battle.defender` are
intentionally refs, not records. Code navigating the state machine already has
access to these refs at every decision point — there is no case where you need
to know "is this a hunter?" without also having the ref.

## Consequences

- **Gotcha documented here and in ARCHITECTURE.md**: "hunter records have no
  `.kind`; use refs for identity checks."
- **Bug class to watch for**: any `resolveUnit(state, ref)` call followed
  immediately by `unit.kind === 'hunter'` is wrong. The pattern should be
  `ref.kind === 'hunter'` before resolving, or a separate check on the ref.
- **No code change required** — the architecture is already correct; only the
  documentation was missing.
