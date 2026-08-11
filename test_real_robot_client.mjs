import test from 'node:test';
import assert from 'node:assert/strict';
import { RealRobotClient } from './real-robot-client.mjs';

class FakeSocket { constructor(url){this.url=url;this.readyState=0;FakeSocket.last=this;} send(value){this.sent=value;} close(){this.closed=true;} }
FakeSocket.OPEN = 1;
test('client sends pairing as first application message and cannot approve', () => {
  const client = new RealRobotClient({WebSocketImpl: FakeSocket});
  const socket = client.connect('ephemeral-token');
  assert.equal(socket.url,'wss://localhost:8766'); socket.readyState=1; socket.onopen();
  assert.deepEqual(JSON.parse(socket.sent),{type:'pair',token:'ephemeral-token'});
  assert.equal(typeof client.approve,'undefined');
});
