import test from 'node:test';
import assert from 'node:assert/strict';
import { createRealRobotBatch, reduceRealRobotEvent, REAL_ROBOT_ENDPOINT } from './real-robot-batch.mjs';

test('physical batch contains only allowlisted actions and no source', () => {
  const batch = createRealRobotBatch({sessionId:'sess-1', pointsRevision:'sha256:'+'a'.repeat(64), actions:[{name:'move_to',args:['P2'],line:4}]});
  assert.equal(batch.v, 1); assert.equal(batch.commands[0].name, 'move_to'); assert.equal('source' in batch, false);
});
test('unsupported camera, joints, and malformed actions fail closed', () => {
  for (const action of [{name:'capture',args:[],line:1},{name:'MoveJ',args:[[1]],line:1},{name:'move_up',args:['x'],line:1}]) {
    assert.throws(() => createRealRobotBatch({sessionId:'s',pointsRevision:'r',actions:[action]}));
  }
});
test('event reducer ignores stale run and tracks state', () => {
  let state = {runId:'run-1',sessionId:'s',status:'paired'};
  state = reduceRealRobotEvent(state,{runId:'other',type:'faulted'}); assert.equal(state.status,'paired');
  state = reduceRealRobotEvent(state,{runId:'run-1',type:'pending_approval'}); assert.equal(state.status,'pending_approval');
  assert.equal(REAL_ROBOT_ENDPOINT,'wss://localhost:8766');
});

test('browser reducer accepts every terminal event emitted by the local bridge', () => {
  let state = {runId:'run-1',sessionId:'sess-1',status:'paired'};
  for (const event of [
    {runId:'run-1',type:'pending_approval'},
    {runId:'run-1',type:'approved'},
    {runId:'run-1',type:'command_started',index:0},
    {runId:'run-1',type:'command_completed',index:0},
    {runId:'run-1',type:'run_completed'},
  ]) state = reduceRealRobotEvent(state,event);
  assert.equal(state.status,'completed');
  assert.equal(state.completedIndex,0);
});

test('browser reducer tracks bridge connected and approved lifecycle events', () => {
  let state = {runId:'run-1',sessionId:'sess-1',status:'connecting'};
  state = reduceRealRobotEvent(state,{sessionId:'sess-1',type:'connected'});
  assert.equal(state.status,'paired');
  state = reduceRealRobotEvent(state,{runId:'run-1',sessionId:'sess-1',type:'approved'});
  assert.equal(state.status,'approved');
});
