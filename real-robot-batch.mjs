export const REAL_ROBOT_ENDPOINT = 'wss://localhost:8766';
export const REAL_ROBOT_COMMANDS = Object.freeze(['move_to', 'move_down', 'move_up', 'grip', 'release']);

function id(prefix) {
  const bytes = globalThis.crypto?.getRandomValues ? globalThis.crypto.getRandomValues(new Uint8Array(16)) : new Uint8Array(16).fill(7);
  return `${prefix}-${Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')}`;
}

export function createRealRobotBatch({ actions, sessionId, model = 'FR5', profile = 'fr5-default', pointsRevision }) {
  if (!Array.isArray(actions) || actions.length > 200) throw new Error('Invalid physical action list');
  const commands = actions.map(action => {
    if (!action || !REAL_ROBOT_COMMANDS.includes(action.name) || !Number.isInteger(action.line) || action.line < 1) {
      throw new Error('Unsupported physical command');
    }
    const args = Array.isArray(action.args) ? [...action.args] : [];
    if (action.name === 'move_to' && (args.length !== 1 || typeof args[0] !== 'string')) throw new Error('Invalid move_to');
    if (action.name !== 'move_to' && args.length) throw new Error('Unexpected command arguments');
    return Object.freeze({ name: action.name, args: Object.freeze(args), line: action.line });
  });
  if (typeof sessionId !== 'string' || typeof pointsRevision !== 'string') throw new Error('Session and calibration revision are required');
  return Object.freeze({ v: 1, runId: id('run'), sessionId, model, profile, pointsRevision, commands: Object.freeze(commands) });
}

export function reduceRealRobotEvent(state, event) {
  if (!event) return state;
  if (event.type === 'connected') {
    return state.sessionId && event.sessionId === state.sessionId
      ? { ...state, status: 'paired', lastEvent: event.type }
      : state;
  }
  if (event.runId !== state.runId || (state.sessionId && event.sessionId && event.sessionId !== state.sessionId)) return state;
  const next = { ...state, lastEvent: event.type };
  if (event.type === 'paired') next.status = 'paired';
  else if (event.type === 'pending_approval') next.status = 'pending_approval';
  else if (event.type === 'approved') next.status = 'approved';
  else if (event.type === 'running' || event.type === 'command_started') next.status = 'running';
  else if (event.type === 'command_completed') next.completedIndex = event.index;
  else if (event.type === 'completed' || event.type === 'run_completed') next.status = 'completed';
  else if (event.type === 'stopped' || event.type === 'faulted' || event.type === 'rejected') next.status = event.type;
  return next;
}
