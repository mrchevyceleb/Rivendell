import assert from 'node:assert/strict';
import test from 'node:test';
import { WebSocketServer, type WebSocket } from 'ws';
import { HallBrain } from './hallBrain.ts';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const inbox = new WeakMap<WebSocket, any[]>();

async function withServer(run: (url: string, connections: WebSocket[]) => Promise<void>): Promise<void> {
  const connections: WebSocket[] = [];
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  server.on('connection', (socket) => {
    connections.push(socket);
    const messages: any[] = [];
    inbox.set(socket, messages);
    socket.on('message', (raw) => messages.push(JSON.parse(String(raw))));
  });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (typeof address === 'string' || !address) throw new Error('missing websocket address');
  try {
    await run(`ws://127.0.0.1:${address.port}`, connections);
  } finally {
    for (const socket of connections) socket.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function send(socket: WebSocket, value: object): void {
  socket.send(JSON.stringify(value));
}

async function waitForMessage(socket: WebSocket, predicate: (value: any) => boolean, timeoutMs = 2_000): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const messages = inbox.get(socket) ?? [];
    const index = messages.findIndex(predicate);
    if (index >= 0) return messages.splice(index, 1)[0];
    await delay(5);
  }
  throw new Error('message timeout');
}

test('named voice emits only text after its matching durable user echo', async () => {
  await withServer(async (url, connections) => {
    const brain = new HallBrain({
      wsUrl: url,
      repo: '/workspace',
      chatId: 'bot-kate',
      settings: { cli: 'xai', model: 'grok-4.6', effort: 'max' },
      threadVoice: true,
    });
    const connected = brain.connect();
    while (!connections[0]) await delay(5);
    const socket = connections[0];
    await waitForMessage(socket, (message) => message.type === 'hello');
    send(socket, {
      type: 'ready',
      cli: 'claude',
      model: 'claude-fable-5-1',
      effort: 'high',
      busy: false,
      activeCli: 'claude',
      latestSeq: 0,
      queuedClientMsgIds: [],
    });
    assert.equal(await connected, true);

    const events = brain.runTurn('check it');
    const first = events.next();
    const outbound = await waitForMessage(socket, (message) => message.type === 'send');
    assert.equal(outbound.chatId, 'bot-kate');
    assert.equal(outbound.repo, '/workspace');
    assert.equal(outbound.voice, true);
    assert.deepEqual(
      [outbound.cli, outbound.model, outbound.effort],
      ['claude', 'claude-fable-5-1', 'high'],
    );

    send(socket, { type: 'stream', seq: 1, event: { type: 'assistant', message: { content: [{ type: 'text', text: 'OLD TURN' }] } } });
    assert.equal(await Promise.race([first.then(() => 'event'), delay(60).then(() => 'quiet')]), 'quiet');

    send(socket, { type: 'stream', seq: 2, event: { type: '_user_echo', clientMsgId: outbound.clientMsgId, text: 'check it' } });
    send(socket, { type: 'stream', seq: 3, event: { type: 'assistant', message: { content: [{ type: 'text', text: 'VOICE RESULT' }] } } });
    assert.deepEqual(await first, { done: false, value: { kind: 'text', text: 'VOICE RESULT' } });
    const terminal = events.next();
    send(socket, { type: 'turnEnd', seq: 4 });
    assert.deepEqual(await terminal, { done: false, value: { kind: 'turnEnd' } });
    brain.close();
  });
});

test('external busy work finishes before voice rebinds to the selected engine', async () => {
  await withServer(async (url, connections) => {
    const brain = new HallBrain({
      wsUrl: url,
      repo: '/workspace',
      chatId: 'bot-kate',
      settings: { cli: 'xai', model: 'grok-4.6', effort: 'max' },
      threadVoice: true,
    });
    const connected = brain.connect();
    while (!connections[0]) await delay(5);
    const firstSocket = connections[0];
    await waitForMessage(firstSocket, (message) => message.type === 'hello');
    send(firstSocket, { type: 'ready', busy: true, activeCli: 'codex', latestSeq: 10, queuedClientMsgIds: [] });
    assert.equal(await connected, true);

    const events = brain.runTurn('use my selected model');
    const firstEvent = events.next();
    await delay(80);
    assert.equal(firstSocket.listenerCount('message') > 0, true);
    send(firstSocket, { type: 'stream', seq: 11, event: { type: 'assistant', message: { content: [{ type: 'text', text: 'OLD CODEX OUTPUT' }] } } });
    assert.equal(await Promise.race([firstEvent.then(() => 'event'), delay(60).then(() => 'quiet')]), 'quiet');

    send(firstSocket, { type: 'turnEnd', seq: 12 });
    while (!connections[1]) await delay(5);
    const secondSocket = connections[1];
    const hello = await waitForMessage(secondSocket, (message) => message.type === 'hello');
    assert.equal(hello.cli, 'xai');
    send(secondSocket, { type: 'ready', busy: false, activeCli: 'xai', latestSeq: 12, queuedClientMsgIds: [] });
    const outbound = await waitForMessage(secondSocket, (message) => message.type === 'send');
    assert.equal(outbound.cli, 'xai');
    assert.equal(outbound.model, 'grok-4.6');

    send(secondSocket, { type: 'stream', seq: 13, event: { type: '_user_echo', clientMsgId: outbound.clientMsgId, text: outbound.text } });
    send(secondSocket, { type: 'stream', seq: 14, event: { type: 'assistant', message: { content: [{ type: 'text', text: 'SELECTED XAI OUTPUT' }] } } });
    assert.deepEqual(await firstEvent, { done: false, value: { kind: 'text', text: 'SELECTED XAI OUTPUT' } });
    const terminal = events.next();
    send(secondSocket, { type: 'turnEnd', seq: 15 });
    assert.deepEqual(await terminal, { done: false, value: { kind: 'turnEnd' } });
    brain.close();
  });
});

test('barge-in cancels only the obsolete speech waiter and ignores its late rejection', async () => {
  await withServer(async (url, connections) => {
    const brain = new HallBrain({
      wsUrl: url,
      repo: '/workspace',
      chatId: 'bot-kate',
      settings: { cli: 'xai', model: 'grok-4.6', effort: 'max' },
      threadVoice: true,
    });
    const connected = brain.connect();
    while (!connections[0]) await delay(5);
    const socket = connections[0];
    await waitForMessage(socket, (message) => message.type === 'hello');
    send(socket, { type: 'ready', busy: false, activeCli: 'xai', latestSeq: 0, queuedClientMsgIds: [] });
    assert.equal(await connected, true);

    const firstAborter = new AbortController();
    const firstTurn = brain.runTurn('first', firstAborter.signal);
    const firstEvent = firstTurn.next();
    const firstOutbound = await waitForMessage(socket, (message) => message.type === 'send');
    send(socket, { type: 'stream', seq: 1, event: { type: '_user_echo', clientMsgId: firstOutbound.clientMsgId, text: 'first' } });
    await delay(20);
    firstAborter.abort();
    assert.deepEqual(await firstEvent, { done: false, value: { kind: 'cancelled' } });

    const secondTurn = brain.runTurn('second');
    const secondEvent = secondTurn.next();
    const secondOutbound = await waitForMessage(socket, (message) => message.type === 'steer');
    send(socket, { type: 'steerRejected', clientMsgId: firstOutbound.clientMsgId, message: 'obsolete' });
    send(socket, { type: 'error', message: 'preceding turn error' });
    assert.equal(await Promise.race([secondEvent.then(() => 'event'), delay(60).then(() => 'quiet')]), 'quiet');
    send(socket, { type: 'stream', seq: 2, event: { type: '_user_echo', clientMsgId: secondOutbound.clientMsgId, text: 'second' } });
    send(socket, { type: 'stream', seq: 3, event: { type: 'assistant', message: { content: [{ type: 'text', text: 'SECOND ANSWER' }] } } });
    assert.deepEqual(await secondEvent, { done: false, value: { kind: 'text', text: 'SECOND ANSWER' } });
    const terminal = secondTurn.next();
    send(socket, { type: 'turnEnd', seq: 4 });
    assert.deepEqual(await terminal, { done: false, value: { kind: 'turnEnd' } });
    brain.close();
  });
});
