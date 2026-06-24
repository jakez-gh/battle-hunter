import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The coordination CLI is the multi-agent mailbox/claim/presence layer. These
// tests pin its load-bearing guarantees: a live claim blocks a second agent,
// an OFFLINE peer's task can be taken over (with its handoff surfaced), and
// mailbox messages deliver + mark read. Each test runs against an isolated
// AGENT_COORD_HOME so it never touches the real .agents/ runtime state.

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.agents', 'agent-coord.mjs');

function freshHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agentcoord-'));
}
// Run the CLI; returns { status, stdout, stderr }. Never throws on non-zero.
function run(home, ...argv) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...argv], {
      env: { ...process.env, AGENT_COORD_HOME: home }, encoding: 'utf8',
    });
    return { status: 0, stdout, stderr: '' };
  } catch (e) {
    return { status: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}
// Rewind an agent's heartbeat so it reads as offline (older than the lease).
function makeOffline(home, id, minutesAgo = 60) {
  const f = path.join(home, 'registry', `${id}.json`);
  const rec = JSON.parse(fs.readFileSync(f, 'utf8'));
  rec.lastHeartbeat = new Date(Date.now() - minutesAgo * 60000).toISOString();
  fs.writeFileSync(f, JSON.stringify(rec));
}

test('claim: a live claim blocks a second agent', () => {
  const home = freshHome();
  assert.equal(run(home, 'register', '--name', 'a', '--id', 'a').status, 0);
  assert.equal(run(home, 'register', '--name', 'b', '--id', 'b').status, 0);
  assert.equal(run(home, 'claim', '--as', 'a', '--task', 'T1', '--handoff', 'did half').status, 0);

  const denied = run(home, 'claim', '--as', 'b', '--task', 'T1');
  assert.equal(denied.status, 1, 'second claim must be denied');
  assert.match(denied.stderr, /DENIED/);
  assert.match(denied.stderr, /held by a/);

  // The owner re-claiming its own task is fine (idempotent renew).
  assert.equal(run(home, 'claim', '--as', 'a', '--task', 'T1').status, 0);
  fs.rmSync(home, { recursive: true, force: true });
});

test('takeover: refused while owner alive, allowed once owner is offline', () => {
  const home = freshHome();
  run(home, 'register', '--name', 'a', '--id', 'a');
  run(home, 'register', '--name', 'b', '--id', 'b');
  run(home, 'claim', '--as', 'a', '--task', 'T2', '--handoff', 'resume at step 3: wire the HUD');

  // Owner alive → takeover refused (must coordinate instead).
  const early = run(home, 'takeover', '--as', 'b', '--task', 'T2');
  assert.equal(early.status, 1, 'takeover must refuse a live owner');
  assert.match(early.stderr, /still looks alive/);

  // Owner goes offline → takeover succeeds and surfaces the handoff to resume.
  makeOffline(home, 'a');
  const t = run(home, 'takeover', '--as', 'b', '--task', 'T2');
  assert.equal(t.status, 0, 'takeover of an offline owner must succeed');
  assert.match(t.stdout, /took over "T2" from a/);
  assert.match(t.stdout, /resume at step 3/, 'handoff note must be surfaced for seamless pickup');

  // Ownership actually transferred + history records the takeover.
  const claim = JSON.parse(fs.readFileSync(path.join(home, 'claims', 'T2.json'), 'utf8'));
  assert.equal(claim.owner, 'b');
  assert.ok(claim.history.some((h) => h.action === 'takeover' && h.from === 'a'));
  fs.rmSync(home, { recursive: true, force: true });
});

test('mailbox: messages deliver, list as unread, then mark read', () => {
  const home = freshHome();
  run(home, 'register', '--name', 'a', '--id', 'a');
  run(home, 'register', '--name', 'b', '--id', 'b');

  const sent = run(home, 'send', '--as', 'a', '--to', 'b', '--subject', 'heads up', '--body', 'claiming ai.js');
  assert.equal(sent.status, 0);
  const msgId = sent.stdout.match(/\[msg (\w+)\]/)[1];

  const inbox = run(home, 'inbox', '--as', 'b');
  assert.match(inbox.stdout, /heads up/);
  assert.match(inbox.stdout, /1 unread/);

  assert.equal(run(home, 'read', '--as', 'b', '--msg', msgId).status, 0);
  assert.match(run(home, 'inbox', '--as', 'b').stdout, /no unread messages/);

  // Broadcast reaches every other agent, not the sender.
  run(home, 'register', '--name', 'c', '--id', 'c');
  run(home, 'send', '--as', 'a', '--to', 'all', '--subject', 'sync');
  assert.match(run(home, 'inbox', '--as', 'b').stdout, /sync/);
  assert.match(run(home, 'inbox', '--as', 'c').stdout, /sync/);
  assert.match(run(home, 'inbox', '--as', 'a', '--all').stdout, /inbox empty/);
  fs.rmSync(home, { recursive: true, force: true });
});

test('heartbeat renews the owner lease', () => {
  const home = freshHome();
  run(home, 'register', '--name', 'a', '--id', 'a');
  run(home, 'claim', '--as', 'a', '--task', 'T3', '--ttl', '20');
  const before = JSON.parse(fs.readFileSync(path.join(home, 'claims', 'T3.json'), 'utf8')).leaseUntil;
  // Shorten the lease, then heartbeat should push it back out.
  const f = path.join(home, 'claims', 'T3.json');
  const c = JSON.parse(fs.readFileSync(f, 'utf8'));
  c.leaseUntil = new Date(Date.now() + 60000).toISOString();
  fs.writeFileSync(f, JSON.stringify(c));
  const hb = run(home, 'heartbeat', '--as', 'a');
  assert.match(hb.stdout, /renewed 1 claim/);
  const after = JSON.parse(fs.readFileSync(f, 'utf8')).leaseUntil;
  assert.ok(new Date(after).getTime() > Date.now() + 10 * 60000, 'lease pushed well into the future');
  fs.rmSync(home, { recursive: true, force: true });
});
