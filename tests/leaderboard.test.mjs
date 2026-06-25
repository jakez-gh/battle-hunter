import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  storageArea, addLeaderboardEntry, getLeaderboard, clearLeaderboard,
  resetMemoryStore, LEADERBOARD_KEY,
} from '../src/save.js';

// Wipe the entire in-memory store before each test to prevent cross-test pollution.
beforeEach(() => {
  resetMemoryStore();
});

describe('leaderboard', () => {
  it('empty board returns []', () => {
    assert.deepEqual(getLeaderboard('normal'), []);
  });

  it('adds an entry and returns rank 0', () => {
    const rank = addLeaderboardEntry('normal', { name: 'Keld', score: 500 });
    assert.equal(rank, 0);
    const board = getLeaderboard('normal');
    assert.equal(board.length, 1);
    assert.equal(board[0].name, 'Keld');
    assert.equal(board[0].score, 500);
    assert.equal(board[0].mode, 'normal');
    assert.ok(typeof board[0].ts === 'number');
  });

  it('sorts highest score first', () => {
    addLeaderboardEntry('normal', { name: 'C', score: 100 });
    addLeaderboardEntry('normal', { name: 'A', score: 900 });
    addLeaderboardEntry('normal', { name: 'B', score: 500 });
    const board = getLeaderboard('normal');
    assert.equal(board[0].name, 'A');
    assert.equal(board[1].name, 'B');
    assert.equal(board[2].name, 'C');
  });

  it('returns correct rank for a mid-table entry', () => {
    addLeaderboardEntry('normal', { name: 'A', score: 900 });
    addLeaderboardEntry('normal', { name: 'C', score: 100 });
    const rank = addLeaderboardEntry('normal', { name: 'B', score: 500 });
    assert.equal(rank, 1);
  });

  it('caps at 10 entries; low score returns -1', () => {
    for (let i = 10; i >= 1; i--)
      addLeaderboardEntry('normal', { name: `P${i}`, score: i * 100 });
    assert.equal(getLeaderboard('normal').length, 10);
    const rank = addLeaderboardEntry('normal', { name: 'Last', score: 1 });
    assert.equal(rank, -1);
    assert.equal(getLeaderboard('normal').length, 10);
  });

  it('a new high score displaces the 10th entry', () => {
    for (let i = 10; i >= 1; i--)
      addLeaderboardEntry('normal', { name: `P${i}`, score: i * 100 });
    const rank = addLeaderboardEntry('normal', { name: 'Champion', score: 999999 });
    assert.equal(rank, 0);
    const board = getLeaderboard('normal');
    assert.equal(board.length, 10);
    assert.equal(board[0].name, 'Champion');
    assert.ok(board.every((e) => e.name !== 'P1'));
  });

  it('modes are independent', () => {
    addLeaderboardEntry('normal', { name: 'A', score: 100 });
    addLeaderboardEntry('story', { name: 'B', score: 200 });
    assert.equal(getLeaderboard('normal').length, 1);
    assert.equal(getLeaderboard('story').length, 1);
    assert.equal(getLeaderboard('relic-dive').length, 0);
  });

  it('clears only the specified mode', () => {
    addLeaderboardEntry('normal', { name: 'A', score: 100 });
    addLeaderboardEntry('story', { name: 'B', score: 200 });
    clearLeaderboard('normal');
    assert.equal(getLeaderboard('normal').length, 0);
    assert.equal(getLeaderboard('story').length, 1);
  });

  it('stores extras and mode field', () => {
    addLeaderboardEntry('relic-dive', { name: 'Mira', score: 800, extras: { depths: 3 } });
    const board = getLeaderboard('relic-dive');
    assert.equal(board[0].extras.depths, 3);
    assert.equal(board[0].mode, 'relic-dive');
  });

  it('persists across load calls (via storage)', () => {
    addLeaderboardEntry('normal', { name: 'Keld', score: 500 });
    // getLeaderboard re-reads from storage each call
    const board = getLeaderboard('normal');
    assert.equal(board.length, 1);
    assert.equal(board[0].name, 'Keld');
  });

  it('handles corrupt storage gracefully', () => {
    storageArea().setItem(LEADERBOARD_KEY, '{{{invalid json');
    assert.doesNotThrow(() => getLeaderboard('normal'));
    assert.deepEqual(getLeaderboard('normal'), []);
  });
});
