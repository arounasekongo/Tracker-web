process.env.DATABASE_FALLBACK = 'disabled';
const pool = require('./db');
const fs = require('fs');
const path = require('path');
const { provisionAdmin } = require('./adminProvisioning');

async function initDatabase() {
    try {
        const sql = fs.readFileSync(path.join(__dirname, 'init.sql'), 'utf8');
        await pool.query(sql);
        const username = process.env.ADMIN_USERNAME || 'admin';
        const password = process.env.ADMIN_PASSWORD;
        if (!password || (process.env.NODE_ENV === 'production' && password.length < 12)) {
            throw new Error('ADMIN_PASSWORD est requis et doit contenir au moins 12 caracteres en production');
        }
        const result = await provisionAdmin(pool, {
            username,
            password,
            resetPassword: process.env.ADMIN_RESET_PASSWORD === 'true'
        });
        const message = result.action === 'created' ? 'compte administrateur cree' :
            result.action === 'reset' ? 'mot de passe administrateur reinitialise' :
                'mot de passe administrateur existant conserve';
        console.log(`Base de donnees initialisee (${message})`);
    } catch (error) {
        console.error('Erreur initialisation:', error);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

initDatabase();
