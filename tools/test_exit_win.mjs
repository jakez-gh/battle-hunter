import * as G from '../src/engine/game.js';

// Build a minimal config with 1 hunter positioned next to the exit and holding the target
const cfg = { hunters: [{ id:'h0', slot:0, name:'Tester', spriteId:0, palette:'cobalt', human:true, level:1, internal:{}, maxHp:10, items:[] }], seed: 99999 };
let state = G.createGame(cfg);
// find exit
const ex = state.board.exit;
if (!ex) { console.log('no exit on board'); process.exit(1); }
// place hunter adjacent to exit if possible
const adj = [{x:ex.x-1,y:ex.y},{x:ex.x+1,y:ex.y},{x:ex.x,y:ex.y-1},{x:ex.x,y:ex.y+1}].find(p=>p.x>=0 && p.y>=0 && state.board.floor[p.y][p.x]);
if (!adj) { console.log('no adjacent floor to exit'); process.exit(1); }
state.hunters[0].pos = adj;
state.hunters[0].hasTarget = true;
state.targetFound = true;
state.targetHolder = { kind: 'hunter', index: 0 };
state.current = { kind: 'hunter', index: 0 };
state.phase = 'turn.action';
console.log('Hunter at', adj, 'exit at', ex);
// compute legal actions
const acts = G.legalActions(state);
console.log('legal actions:', acts);
// find move action and apply
const move = acts.find(a=>a.type==='move');
if (!move) { console.log('no move action available'); process.exit(1); }
state = (G.applyAction(state, move).state || G.applyAction(state, move));
// now in steering; pick a step that goes to exit
const steerActs = G.legalActions(state);
console.log('steer actions:', steerActs);
const step = steerActs.find(a=>{
  if (a.type!=='step') return false;
  const d = {N:{x:0,y:-1},S:{x:0,y:1},W:{x:-1,y:0},E:{x:1,y:0}}[a.dir];
  return state.hunters[0].pos.x + d.x === ex.x && state.hunters[0].pos.y + d.y === ex.y;
});
if (!step) { console.log('no step to exit available'); process.exit(1); }
let out = G.applyAction(state, step);
state = out.state || out;
console.log('After step, phase=', state.phase, 'events=', (out.events||[]).map(e=>e.type));
// if movement ended, endMovement may have applied mission over
if (state.phase === 'mission.over' || state._missionEnd) {
  console.log('Mission ended:', state._missionEnd);
} else {
  // maybe need to stop
  const stopAct = G.legalActions(state).find(a=>a.type==='stop');
  if (stopAct) { out = G.applyAction(state, stopAct); state = out.state || out; console.log('After stop, phase=', state.phase, 'events=', (out.events||[]).map(e=>e.type)); }
  if (state.phase === 'mission.over' || state._missionEnd) console.log('Mission ended:', state._missionEnd);
  else console.log('Mission not ended; phase=', state.phase);
}
