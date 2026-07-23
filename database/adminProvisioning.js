const bcrypt = require('bcrypt');

async function provisionAdmin(db, {
    username,
    password,
    resetPassword = false,
    bcryptImpl = bcrypt
}) {
    if (!username || !password) throw new Error('Identifiants administrateur requis');

    const existing = await db.query(
        'SELECT id FROM admins WHERE username = $1',
        [username]
    );
    if (existing.rows[0] && !resetPassword) {
        return { action: 'preserved', id: existing.rows[0].id };
    }

    const passwordHash = await bcryptImpl.hash(password, 12);
    if (existing.rows[0]) {
        const updated = await db.query(
            `UPDATE admins
             SET password_hash = $1, session_version = session_version + 1
             WHERE id = $2
             RETURNING id`,
            [passwordHash, existing.rows[0].id]
        );
        return { action: 'reset', id: updated.rows[0].id };
    }

    const inserted = await db.query(
        `INSERT INTO admins (username, password_hash)
         VALUES ($1, $2)
         RETURNING id`,
        [username, passwordHash]
    );
    return { action: 'created', id: inserted.rows[0].id };
}

module.exports = { provisionAdmin };
