const { EventEmitter } = require('events');

const events = new EventEmitter();
events.setMaxListeners(0);

function publish(type, data) {
    events.emit('message', { type, data, sent_at: new Date().toISOString() });
}

function subscribe(req, res) {
    res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
    });
    res.flushHeaders?.();
    res.write('retry: 5000\n');
    res.write(`event: ready\ndata: ${JSON.stringify({ connected: true })}\n\n`);

    const send = (message) => {
        res.write(`event: ${message.type}\ndata: ${JSON.stringify(message.data)}\n\n`);
    };
    const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 25000);
    events.on('message', send);
    req.on('close', () => {
        clearInterval(heartbeat);
        events.off('message', send);
    });
}

module.exports = { publish, subscribe };
