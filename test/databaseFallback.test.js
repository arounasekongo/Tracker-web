const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('active une base temporaire en developpement si PostgreSQL est inaccessible', () => {
    const root = path.resolve(__dirname, '..');
    const code = `
        const pool = require('./database/db');
        (async () => {
            const selected = await pool.query('SELECT 1 AS value');
            const admins = await pool.query('SELECT username FROM admins');
            console.log(JSON.stringify({ memory: pool.isMemory(), value: selected.rows[0].value, admins: admins.rowCount }));
            await pool.end();
        })().catch((error) => { console.error(error); process.exit(1); });
    `;
    const output = execFileSync(process.execPath, ['-e', code], {
        cwd: root,
        encoding: 'utf8',
        timeout: 20000,
        env: {
            ...process.env,
            NODE_ENV: 'test',
            DATABASE_URL: 'postgresql://postgres@127.0.0.1:1/unavailable',
            DATABASE_FALLBACK: 'memory',
            ADMIN_USERNAME: 'fallback-admin',
            ADMIN_PASSWORD: 'fallback-password'
        }
    });
    const result = JSON.parse(output.trim().split(/\r?\n/).at(-1));
    assert.deepEqual(result, { memory: true, value: 1, admins: 1 });
});
