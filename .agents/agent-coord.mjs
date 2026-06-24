#!/usr/bin/env node
// Agent coordination CLI — a file-based mailbox + work-claim + presence system
// so multiple Claude agents working the SAME repo can collaborate, hand off
// work, and recover when a peer goes offline.
//
// Why this exists: two agents on one working tree clobber each other. We hit it
// for real — a `git add -A` swept another agent's uncommitted board section into
// an unrelated commit, and two agents both claimed the same task. This tool
// gives every agent a shared, low-ceremony protocol so that never silently
// happens: claim before you touch files, heartbeat so peers know you're alive,
// keep a handoff note + commit often so anyone can resume your work, and detect
// + take over a peer whose lease has expired.
//
// Pure Node built-ins, no deps (matches the repo's zero-dependency ethos).
// Runtime state lives under .agents/{registry,mailbox,claims,log} and is
// gitignored; this script + the README are the durable, committed parts.
//
// Same-working-tree model: agents share one filesystem, so coordination is
// plain local files (no network, no git round-trip). For separate clones the
// runtime dirs would need to be committed/synced — see README "Cross-machine".

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// --- locations -------------------------------------------------------------
const HOME = process.env.AGENT_COORD_HOME
  ? path.resolve(process.env.AGENT_COORD_HOME)
  : path.dirname(fileURLToPath(import.meta.url));
const DIRS = {
  registry: path.join(HOME, 'registry'),
  mailbox: path.join(HOME, 'mailbox'),
  claims: path.join(HOME, 'claims'),
  log: path.join(HOME, 'log'),
};
const LOG_FILE = path.join(DIRS.log, 'activity.ndjson');

// --- tunables (minutes) ----------------------------------------------------
// A heartbeat older than STALE_MIN means "maybe stepped away"; older than
// LEASE_MIN means "presumed offline — claims are reclaimable".
const STALE_MIN = Number(process.env.AGENT_STALE_MIN ?? 10);
const LEASE_MIN = Number(process.env.AGENT_LEASE_MIN ?? 20);

// --- tiny fs helpers -------------------------------------------------------
const ensureDirs = () => {
  for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true });
};
const nowISO = () => new Date().toISOString();
const minutesSince = (iso) => (Date.now() - new Date(iso).getTime()) / 60000;
const readJSON = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const writeJSONAtomic = (f, obj) => {
  const tmp = `${f}.tmp-${crypto.randomBytes(4).toString('hex')}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, f); // atomic on the same filesystem
};
const listFiles = (d) => { try { return fs.readdirSync(d).filter((n) => !n.startsWith('.')); } catch { return []; } };
const shortId = () => crypto.randomBytes(3).toString('hex');

const appendLog = (entry) => {
  ensureDirs();
  fs.appendFileSync(LOG_FILE, JSON.stringify({ ts: nowISO(), ...entry }) + '\n');
};

// --- presence / liveness ---------------------------------------------------
const agentFile = (id) => path.join(DIRS.registry, `${id}.json`);
const readAgent = (id) => readJSON(agentFile(id));
const allAgents = () => listFiles(DIRS.registry)
  .filter((n) => n.endsWith('.json'))
  .map((n) => readJSON(path.join(DIRS.registry, n)))
  .filter(Boolean);

function liveness(agent) {
  if (!agent?.lastHeartbeat) return 'unknown';
  if (agent.status === 'offline') return 'offline';
  const age = minutesSince(agent.lastHeartbeat);
  if (age >= LEASE_MIN) return 'offline';   // presumed gone; claims reclaimable
  if (age >= STALE_MIN) return 'stale';     // maybe away
  return 'active';
}
const livenessTag = (a) => {
  const l = liveness(a);
  const age = a?.lastHeartbeat ? `${minutesSince(a.lastHeartbeat).toFixed(0)}m ago` : '?';
  return `${l} (${age})`;
};

// --- claims ----------------------------------------------------------------
const claimFile = (taskId) => path.join(DIRS.claims, `${taskId.replace(/[^\w.-]/g, '_')}.json`);
const readClaim = (taskId) => readJSON(claimFile(taskId));
const allClaims = () => listFiles(DIRS.claims)
  .filter((n) => n.endsWith('.json'))
  .map((n) => readJSON(path.join(DIRS.claims, n)))
  .filter(Boolean);

function claimLive(claim) {
  if (!claim || ['done', 'released', 'abandoned'].includes(claim.status)) return false;
  if (!claim.leaseUntil) return false;
  return new Date(claim.leaseUntil).getTime() > Date.now();
}

// --- mailbox ---------------------------------------------------------------
const inboxDir = (id) => path.join(DIRS.mailbox, id, 'inbox');
function deliver(toId, msg) {
  const dir = inboxDir(toId);
  fs.mkdirSync(dir, { recursive: true });
  const fname = `${Date.now()}-${msg.from}-${msg.id}.json`;
  const tmp = path.join(dir, `.tmp-${msg.id}`);
  fs.writeFileSync(tmp, JSON.stringify(msg, null, 2));
  fs.renameSync(tmp, path.join(dir, fname));
}

// --- arg parsing -----------------------------------------------------------
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) { out[key] = true; }
      else { out[key] = next; i++; }
    } else out._.push(a);
  }
  return out;
}
const need = (args, key) => {
  if (args[key] === undefined) { console.error(`error: --${key} is required`); process.exit(2); }
  return args[key];
};

// --- commands --------------------------------------------------------------
const cmds = {};

cmds.register = (args) => {
  ensureDirs();
  const name = args.name ?? args.role ?? 'agent';
  const id = args.id ?? `${String(name).toLowerCase().replace(/[^\w-]/g, '-')}-${shortId()}`;
  const existing = readAgent(id);
  const rec = {
    id, name: String(name), role: args.role ?? null,
    model: args.model ?? null,
    startedAt: existing?.startedAt ?? nowISO(),
    lastHeartbeat: nowISO(),
    status: 'active',
    currentTask: existing?.currentTask ?? null,
    note: args.note ?? existing?.note ?? null,
    pid: process.pid,
  };
  writeJSONAtomic(agentFile(id), rec);
  appendLog({ event: 'register', id, name: rec.name });
  console.log(`registered as: ${id}`);
  console.log(`pass --as ${id} on every later call. Heartbeat each meaningful step.`);
  return rec;
};

cmds.heartbeat = (args) => {
  const id = need(args, 'as');
  const rec = readAgent(id);
  if (!rec) { console.error(`unknown agent ${id} — run register first`); process.exit(1); }
  rec.lastHeartbeat = nowISO();
  if (args.status) rec.status = args.status;
  if (args.task) rec.currentTask = args.task === 'none' ? null : args.task;
  if (args.note) rec.note = args.note;
  writeJSONAtomic(agentFile(id), rec);
  // Renew leases on every claim this agent owns.
  let renewed = 0;
  for (const c of allClaims()) {
    if (c.owner === id && !['done', 'released', 'abandoned'].includes(c.status)) {
      c.leaseUntil = new Date(Date.now() + LEASE_MIN * 60000).toISOString();
      c.updatedAt = nowISO();
      writeJSONAtomic(claimFile(c.taskId), c);
      renewed++;
    }
  }
  console.log(`heartbeat ok (${rec.status})${renewed ? ` — renewed ${renewed} claim lease(s)` : ''}`);
};

cmds.agents = () => {
  const list = allAgents().sort((a, b) => (a.name > b.name ? 1 : -1));
  if (!list.length) { console.log('(no agents registered)'); return; }
  console.log('AGENTS:');
  for (const a of list) {
    console.log(`  ${a.id}  [${livenessTag(a)}]  status=${a.status}  task=${a.currentTask ?? '-'}${a.note ? `  "${a.note}"` : ''}`);
  }
};

cmds.whoami = (args) => {
  const id = need(args, 'as');
  console.log(JSON.stringify(readAgent(id), null, 2));
};

cmds.claim = (args) => {
  ensureDirs();
  const id = need(args, 'as');
  const taskId = need(args, 'task');
  const ttl = Number(args.ttl ?? LEASE_MIN);
  const file = claimFile(taskId);
  const existing = readClaim(taskId);
  if (existing && claimLive(existing) && existing.owner !== id) {
    const owner = readAgent(existing.owner);
    console.error(`DENIED: task "${taskId}" is held by ${existing.owner} [${owner ? livenessTag(owner) : 'unknown'}]`);
    console.error(`  lease until ${existing.leaseUntil}; handoff: ${existing.handoff ?? '(none)'}`);
    console.error(owner && liveness(owner) === 'offline'
      ? '  owner looks OFFLINE — you may: agent-coord takeover --task ' + taskId + ' --as ' + id
      : '  coordinate first: agent-coord send --to ' + existing.owner + ' --as ' + id + ' --subject "..."');
    process.exit(1);
  }
  const claim = {
    taskId,
    owner: id,
    status: 'in-progress',
    files: args.files ? String(args.files).split(',').map((s) => s.trim()).filter(Boolean) : [],
    note: args.note ?? null,
    handoff: existing?.owner === id ? existing.handoff : (args.handoff ?? null),
    leaseUntil: new Date(Date.now() + ttl * 60000).toISOString(),
    createdAt: existing?.createdAt ?? nowISO(),
    updatedAt: nowISO(),
    history: [...(existing?.history ?? []), { ts: nowISO(), by: id, action: existing ? 'reclaim' : 'claim' }],
  };
  writeJSONAtomic(file, claim);
  const rec = readAgent(id); if (rec) { rec.currentTask = taskId; rec.lastHeartbeat = nowISO(); writeJSONAtomic(agentFile(id), rec); }
  appendLog({ event: 'claim', id, taskId });
  console.log(`claimed "${taskId}" (lease ${ttl}m). Keep --handoff current and commit often so a peer can resume.`);
};

cmds.renew = (args) => {
  const id = need(args, 'as');
  const taskId = need(args, 'task');
  const c = readClaim(taskId);
  if (!c) { console.error(`no claim for ${taskId}`); process.exit(1); }
  if (c.owner !== id) { console.error(`not owner (held by ${c.owner})`); process.exit(1); }
  c.leaseUntil = new Date(Date.now() + Number(args.ttl ?? LEASE_MIN) * 60000).toISOString();
  if (args.progress) c.progress = args.progress;
  if (args.handoff) c.handoff = args.handoff;
  if (args.files) c.files = String(args.files).split(',').map((s) => s.trim()).filter(Boolean);
  c.updatedAt = nowISO();
  writeJSONAtomic(claimFile(taskId), c);
  console.log(`renewed "${taskId}"`);
};

cmds.handoff = (args) => {
  const id = need(args, 'as');
  const taskId = need(args, 'task');
  const note = need(args, 'note');
  const c = readClaim(taskId);
  if (!c) { console.error(`no claim for ${taskId}`); process.exit(1); }
  if (c.owner !== id) { console.error(`not owner (held by ${c.owner})`); process.exit(1); }
  c.handoff = note;
  c.updatedAt = nowISO();
  writeJSONAtomic(claimFile(taskId), c);
  appendLog({ event: 'handoff', id, taskId });
  console.log(`handoff updated for "${taskId}"`);
};

cmds.release = (args) => {
  const id = need(args, 'as');
  const taskId = need(args, 'task');
  const c = readClaim(taskId);
  if (!c) { console.error(`no claim for ${taskId}`); process.exit(1); }
  if (c.owner !== id && !args.force) { console.error(`not owner (held by ${c.owner}); use --force to override`); process.exit(1); }
  c.status = args.status ?? 'released';
  if (args.note) c.note = args.note;
  c.updatedAt = nowISO();
  c.history.push({ ts: nowISO(), by: id, action: c.status });
  writeJSONAtomic(claimFile(taskId), c);
  const rec = readAgent(id); if (rec && rec.currentTask === taskId) { rec.currentTask = null; writeJSONAtomic(agentFile(id), rec); }
  appendLog({ event: 'release', id, taskId, status: c.status });
  console.log(`released "${taskId}" as ${c.status}`);
};

cmds.takeover = (args) => {
  const id = need(args, 'as');
  const taskId = need(args, 'task');
  const c = readClaim(taskId);
  if (!c) { console.error(`no claim for ${taskId} — just 'claim' it`); process.exit(1); }
  const owner = readAgent(c.owner);
  const ownerLive = owner && liveness(owner) !== 'offline' && claimLive(c);
  if (ownerLive && !args.force) {
    console.error(`owner ${c.owner} still looks alive [${livenessTag(owner)}] and lease is live.`);
    console.error('  coordinate via send/inbox, or use --force only if you are certain.');
    process.exit(1);
  }
  const prevOwner = c.owner;
  c.history.push({ ts: nowISO(), by: id, action: 'takeover', from: prevOwner, prevHandoff: c.handoff ?? null });
  c.owner = id;
  c.status = 'in-progress';
  c.leaseUntil = new Date(Date.now() + Number(args.ttl ?? LEASE_MIN) * 60000).toISOString();
  c.updatedAt = nowISO();
  writeJSONAtomic(claimFile(taskId), c);
  const rec = readAgent(id); if (rec) { rec.currentTask = taskId; writeJSONAtomic(agentFile(id), rec); }
  appendLog({ event: 'takeover', id, taskId, from: prevOwner });
  console.log(`took over "${taskId}" from ${prevOwner}.`);
  console.log(`RESUME FROM HANDOFF: ${c.handoff ?? '(no handoff note — check git log + WORK.md)'}`);
};

cmds.tasks = () => {
  const list = allClaims().sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  if (!list.length) { console.log('(no claims)'); return; }
  console.log('CLAIMS:');
  for (const c of list) {
    const owner = readAgent(c.owner);
    const live = claimLive(c) ? 'LIVE' : 'EXPIRED';
    const ownerState = owner ? liveness(owner) : 'unknown';
    console.log(`  [${c.status}/${live}] ${c.taskId}  owner=${c.owner}(${ownerState})`);
    if (c.files?.length) console.log(`      files: ${c.files.join(', ')}`);
    if (c.handoff) console.log(`      handoff: ${c.handoff}`);
  }
};

cmds.send = (args) => {
  ensureDirs();
  const id = need(args, 'as');
  const to = need(args, 'to');
  const subject = need(args, 'subject');
  const msg = {
    id: shortId(), from: id, to, ts: nowISO(),
    subject, body: args.body ?? '',
    thread: args.re ?? null,
    requiresReply: !!args.reply,
  };
  let targets;
  if (to === 'all') targets = allAgents().map((a) => a.id).filter((t) => t !== id);
  else targets = [to];
  for (const t of targets) deliver(t, { ...msg, to: t });
  appendLog({ event: 'message', from: id, to, subject, msgId: msg.id });
  console.log(`sent "${subject}" to ${to}${to === 'all' ? ` (${targets.length} agents)` : ''} [msg ${msg.id}]`);
};

cmds.inbox = (args) => {
  const id = need(args, 'as');
  const dir = inboxDir(id);
  const files = listFiles(dir).filter((n) => n.endsWith('.json'));
  const showAll = !!args.all;
  const msgs = files.map((n) => ({ n, m: readJSON(path.join(dir, n)) }))
    .filter((x) => x.m && (showAll || !x.m.read))
    .sort((a, b) => (a.n < b.n ? -1 : 1));
  if (!msgs.length) { console.log(args.all ? '(inbox empty)' : '(no unread messages)'); return; }
  console.log(`INBOX (${msgs.length}${showAll ? '' : ' unread'}):`);
  for (const { m } of msgs) {
    console.log(`  [${m.id}] from ${m.from} — ${m.subject}${m.requiresReply ? '  (REPLY REQUESTED)' : ''}${m.read ? '' : '  *'}`);
    if (m.body) console.log(`      ${String(m.body).split('\n').join('\n      ')}`);
  }
  console.log(`read a message: agent-coord read --as ${id} --msg <id>`);
};

cmds.read = (args) => {
  const id = need(args, 'as');
  const msgId = need(args, 'msg');
  const dir = inboxDir(id);
  for (const n of listFiles(dir)) {
    const f = path.join(dir, n);
    const m = readJSON(f);
    if (m?.id === msgId) {
      m.read = true; m.readAt = nowISO();
      writeJSONAtomic(f, m);
      console.log(JSON.stringify(m, null, 2));
      return;
    }
  }
  console.error(`no message ${msgId}`); process.exit(1);
};

cmds.ping = (args) => {
  const id = need(args, 'as');
  const to = need(args, 'to');
  cmds.send({ as: id, to, subject: 'ping — are you there?', reply: true, body: args.body ?? 'Checking liveness.' });
};

cmds.log = (args) => {
  const n = Number(args.tail ?? 25);
  let lines = [];
  try { lines = fs.readFileSync(LOG_FILE, 'utf8').trim().split('\n').filter(Boolean); } catch { /* none */ }
  for (const l of lines.slice(-n)) {
    const e = JSON.parse(l);
    console.log(`  ${e.ts}  ${e.event}  ${JSON.stringify(Object.fromEntries(Object.entries(e).filter(([k]) => !['ts', 'event'].includes(k))))}`);
  }
};

cmds.help = () => {
  console.log(`Agent coordination CLI — file-based mailbox + claims + presence.

USAGE: node .agents/agent-coord.mjs <command> [--flags]

PRESENCE
  register --name <n> [--role r] [--model m] [--id id]   join; prints your id
  heartbeat --as <id> [--status s] [--task t] [--note n]  prove you're alive; renews your leases
  agents                                                  list everyone + liveness
  whoami --as <id>                                        your registry record

WORK CLAIMS (touch only files you've claimed; never 'git add -A')
  claim   --as <id> --task <t> [--files a,b] [--note n] [--handoff h] [--ttl m]
  renew   --as <id> --task <t> [--progress p] [--handoff h] [--ttl m]
  handoff --as <id> --task <t> --note "<how to resume from here>"
  release --as <id> --task <t> [--status done|released|abandoned] [--note n]
  takeover --as <id> --task <t> [--force]                 reclaim an OFFLINE peer's task
  tasks                                                   list all claims + lease state

MAILBOX
  send  --as <id> --to <id|all> --subject "s" [--body "b"] [--re thread] [--reply]
  inbox --as <id> [--all]                                 unread (or all) messages
  read  --as <id> --msg <msgId>                           print + mark read
  ping  --as <id> --to <id>                               quick liveness probe
  log   [--tail N]                                        recent activity

Liveness: heartbeat < ${STALE_MIN}m = active, < ${LEASE_MIN}m = stale, >= ${LEASE_MIN}m = offline (claims reclaimable).
See .agents/README.md for the full protocol.`);
};

// --- dispatch --------------------------------------------------------------
function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const args = parseArgs(argv.slice(1));
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') return cmds.help();
  const fn = cmds[cmd];
  if (!fn) { console.error(`unknown command: ${cmd}\n`); cmds.help(); process.exit(2); }
  fn(args);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();

// Exported for tests.
export { liveness, claimLive, minutesSince, parseArgs, cmds, DIRS, STALE_MIN, LEASE_MIN };
