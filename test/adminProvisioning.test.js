const test = require('node:test');
const assert = require('node:assert/strict');
const { provisionAdmin } = require('../database/adminProvisioning');

function fakeDatabase(existingAdmin = null) {
    const calls = [];
    return {
        calls,
        async query(sql, params) {
            calls.push({ sql, params });
            if (sql.includes('SELECT id FROM admins')) {
                return { rows: existingAdmin ? [{ id: existingAdmin.id }] : [] };
            }
            if (sql.includes('UPDATE admins')) return { rows: [{ id: existingAdmin.id }] };
            if (sql.includes('INSERT INTO admins')) return { rows: [{ id: 'new-admin-id' }] };
            throw new Error(`Requete inattendue: ${sql}`);
        }
    };
}

const fakeBcrypt = {
    async hash(password, rounds) {
        return `hash:${rounds}:${password}`;
    }
};

test('cree le compte administrateur lors de la premiere initialisation', async () => {
    const db = fakeDatabase();
    const result = await provisionAdmin(db, {
        username: 'admin',
        password: 'Initiale2026!',
        bcryptImpl: fakeBcrypt
    });

    assert.equal(result.action, 'created');
    assert.equal(db.calls.filter(({ sql }) => sql.includes('INSERT INTO admins')).length, 1);
});

test('preserve le mot de passe administrateur existant par defaut', async () => {
    const db = fakeDatabase({ id: 'admin-id' });
    const result = await provisionAdmin(db, {
        username: 'admin',
        password: 'ValeurEnv2026!',
        bcryptImpl: fakeBcrypt
    });

    assert.equal(result.action, 'preserved');
    assert.equal(db.calls.length, 1);
});

test('reinitialise explicitement le mot de passe et invalide les sessions', async () => {
    const db = fakeDatabase({ id: 'admin-id' });
    const result = await provisionAdmin(db, {
        username: 'admin',
        password: 'Nouvelle2026!',
        resetPassword: true,
        bcryptImpl: fakeBcrypt
    });

    assert.equal(result.action, 'reset');
    const update = db.calls.find(({ sql }) => sql.includes('UPDATE admins'));
    assert.ok(update);
    assert.match(update.sql, /session_version = session_version \+ 1/);
});
