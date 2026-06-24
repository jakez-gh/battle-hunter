# Agent coordination protocol

Multiple Claude agents work this repo **at the same time, in the same working
tree.** Without coordination they clobber each other — this is not theoretical:
a `git add -A` once swept another agent's uncommitted board section into an
unrelated commit, and two agents claimed the same task simultaneously. This
directory is the shared nervous system that prevents that: **presence**
(who's alive), **claims** (who owns what, with a lease that expires if you
vanish), **handoff** (how to resume your work), and a **mailbox** (talk to a
peer, wait for a reply, survive their disappearance).

All of it is plain files under `.agents/`, driven by one dependency-free CLI:

```
node .agents/agent-coord.mjs <command> [--flags]      # run `help` for the full list
```

Runtime state (`registry/ mailbox/ claims/ log/`) is **gitignored** — it's live
local coordination, not history. This README and the CLI are the committed,
durable parts.

---

## The rules (every agent, every session)

### 1. On startup — announce yourself and look around
```bash
node .agents/agent-coord.mjs agents          # who else is here? are they alive?
node .agents/agent-coord.mjs register --name <you> --role <e.g. engine|render|ui>
#   → prints your id, e.g. "render-3f9a2c". Use it as --as on every later call.
node .agents/agent-coord.mjs inbox --as <id> # any messages waiting?
node .agents/agent-coord.mjs tasks           # what's already claimed?
```
Also read `WORK.md` — claims are the live lock; `WORK.md` is the durable board.

### 2. Before you touch code — claim the task AND the files
```bash
node .agents/agent-coord.mjs claim --as <id> --task <work-item> \
     --files "src/engine/ai.js,tests/ai.test.mjs" --handoff "starting: plan is X"
```
- If it prints **DENIED**, someone live owns it. Do **not** edit those files.
  Pick another task, or `send` the owner a message and coordinate.
- **Touch only files you've claimed.** When committing, `git add <your files>`
  explicitly — **never `git add -A`** (that is exactly what swept a peer's WIP
  into the wrong commit). Check `git status` before every commit; if something
  you didn't author is modified, leave it.

### 3. While working — stay alive and stay resumable
- **Heartbeat each meaningful step** (it also renews your claim leases):
  `node .agents/agent-coord.mjs heartbeat --as <id> --status active --task <t>`
- **Keep the handoff note current** — it is what a peer reads to continue if you
  vanish. Treat it as "if I disappeared right now, the next agent needs this":
  `node .agents/agent-coord.mjs handoff --as <id> --task <t> --note "done A,B; next: C in screens.js drawHud; gotcha: D"`
- **Commit early and often.** Committed WIP + a current handoff note = seamless
  pickup. Uncommitted work dies with you. (This repo grants standing commit +
  push permission — use it at every coherent boundary.)

### 4. Talking to a peer — and waiting
```bash
node .agents/agent-coord.mjs send  --as <id> --to <peer|all> --subject "..." --body "..." [--reply]
node .agents/agent-coord.mjs inbox --as <id>            # poll for replies
node .agents/agent-coord.mjs read  --as <id> --msg <id> # read + mark handled
```
Agents are turn-based and cannot truly block. **"Pause and wait" means:**
1. Set `--status paused-waiting` on a heartbeat and say what you await.
2. Do other **unblocked** work meanwhile (claim a different task).
3. Re-check `inbox` each turn. Re-send if the peer is `active` but silent.
4. If you are fully blocked, surface it to the user rather than spinning — and
   leave your handoff current so the work isn't stranded.

### 5. A peer went quiet — detect and take over
```bash
node .agents/agent-coord.mjs agents   # heartbeat age → active / stale / offline
node .agents/agent-coord.mjs tasks    # claims + lease state
```
- **active** (< 10m): coordinate normally.
- **stale** (10–20m): probably stepped away. `ping` them; wait a bit.
- **offline** (≥ 20m, or status=offline): presumed gone. Their claims are
  reclaimable:
  ```bash
  node .agents/agent-coord.mjs takeover --as <id> --task <t>
  #   → prints "RESUME FROM HANDOFF: ..." — start there + read their last commits.
  ```
  Takeover **refuses** while the owner still looks alive (use `--force` only if
  you are certain). It records the previous owner + their handoff in the claim
  history, so nothing is lost.

### 6. Going offline — leave the camp clean
Before you stop (or when a task is done):
```bash
node .agents/agent-coord.mjs handoff --as <id> --task <t> --note "<final state + next steps>"
node .agents/agent-coord.mjs release --as <id> --task <t> --status done   # or 'released' if unfinished
node .agents/agent-coord.mjs heartbeat --as <id> --status offline
git add <your files> && git commit && git push        # never leave WIP uncommitted
```
If you crash without doing this, the lease simply expires and a peer takes over
from your last commit + handoff note. That is the whole point — **graceful exit
is nicer, but ungraceful exit is survivable by design.**

---

## Quick reference

| Goal | Command |
|---|---|
| Join / see peers | `register --name <n> --role <r>` · `agents` |
| Stay alive | `heartbeat --as <id>` (renews leases) |
| Own work | `claim --as <id> --task <t> --files <a,b>` |
| Stay resumable | `handoff --as <id> --task <t> --note "..."` |
| Finish | `release --as <id> --task <t> --status done` |
| Recover a dead peer's task | `takeover --as <id> --task <t>` |
| Talk | `send` · `inbox` · `read` · `ping` |
| Audit | `tasks` · `log --tail 30` |

Liveness thresholds (override with `AGENT_STALE_MIN` / `AGENT_LEASE_MIN`):
**active < 10m**, **stale < 20m**, **offline ≥ 20m**.

## Cross-machine note

This protocol assumes a **shared working tree** (the common case here: parallel
sessions editing the same checkout). If agents ever run from separate clones,
the runtime dirs would have to be committed and synced through git instead of
read directly — at which point a claim is "first to push the claim file wins."
Not needed today; documented so the assumption is explicit.
