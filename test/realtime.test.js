const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const realtime = require('../services/realtime');

test('diffuse les nouvelles localisations aux administrateurs connectes', () => {
    const req = new EventEmitter();
    const chunks = [];
    const res = {
        set() {},
        flushHeaders() {},
        write(chunk) { chunks.push(chunk); }
    };
    realtime.subscribe(req, res);
    realtime.publish('verification', { verification_id: 'VER-REALTIME', event_type: 'wallet_deposit_intent' });
    req.emit('close');
    const output = chunks.join('');
    assert.match(output, /event: ready/);
    assert.match(output, /event: verification/);
    assert.match(output, /VER-REALTIME/);
});
