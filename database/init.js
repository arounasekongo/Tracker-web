process.env.DATABASE_FALLBACK = 'disabled';
const pool = require('./db');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');

async function initDatabase() {
    try {
        const sql = fs.readFileSync(path.join(__dirname, 'init.sql'), 'utf8');
        await pool.query(sql);
        const username = process.env.ADMIN_USERNAME || 'admin';
        const password = process.env.ADMIN_PASSWORD;
        if (!password || (process.env.NODE_ENV === 'production' && password.length < 12)) {
            throw new Error('ADMIN_PASSWORD est requis et doit contenir au moins 12 caracteres en production');
        }
        const passwordHash = await bcrypt.hash(password, 12);
        await pool.query(
            `INSERT INTO admins (username, password_hash) VALUES ($1, $2)
             ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
            [username, passwordHash]
        );
        console.log('Base de donnees initialisee');
    } catch (error) {
        console.error('Erreur initialisation:', error);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

initDatabase();
