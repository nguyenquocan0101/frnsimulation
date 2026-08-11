import { REAL_ROBOT_ENDPOINT } from './real-robot-batch.mjs';

export class RealRobotClient {
  constructor({ endpoint = REAL_ROBOT_ENDPOINT, WebSocketImpl = globalThis.WebSocket } = {}) {
    if (endpoint !== REAL_ROBOT_ENDPOINT) throw new Error('Real Robot endpoint is fixed to localhost WSS');
    this.endpoint = endpoint;
    this.WebSocketImpl = WebSocketImpl;
    this.socket = null;
    this.handlers = new Set();
  }
  onEvent(handler) { this.handlers.add(handler); return () => this.handlers.delete(handler); }
  connect(token) {
    if (typeof token !== 'string' || !token) throw new Error('Pairing token required');
    this.socket = new this.WebSocketImpl(this.endpoint);
    this.socket.onopen = () => this.socket.send(JSON.stringify({ type: 'pair', token }));
    this.socket.onmessage = event => { try { const value = JSON.parse(event.data); this.handlers.forEach(handler => handler(value)); } catch {} };
    return this.socket;
  }
  submit(batch) { if (!this.socket || this.socket.readyState !== 1) throw new Error('Control bridge is not paired'); this.socket.send(JSON.stringify({ type: 'submit', batch })); }
  requestStop() { if (this.socket?.readyState === 1) this.socket.send(JSON.stringify({ type: 'stop' })); }
  close() { this.socket?.close(); this.socket = null; }
}
