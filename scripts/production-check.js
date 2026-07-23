'use strict';

const fs = require('fs');
const path = require('path');
require('dotenv').config({ quiet: true });
const pool = require('../database/db');

const root = path.resolve(__dirname, '..');
const failures = [];
const external = [];
const passed = [];

function pass(message) { passed.push(message); }
function fail(message) { failures.push(message); }
function waitForExternal(message) { external.push(message); }
function exists(relativePath) { return fs.existsSync(path.join(root, relativePath)); }

function parseProperties(file) {
    if (!fs.existsSync(file)) return {};
    return Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/)
        .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
        .map((line) => line.split(/=(.*)/s).slice(0, 2).map((part) => part.trim())));
}

async function run() {
    const requiredFiles = [
        'render.yaml', 'public/manifest.webmanifest', 'public/icon-192.png', 'public/icon-512.png',
        'public/apple-touch-icon.png', 'public/sw.js', 'public/privacy.html',
        'scripts/backup-postgres.ps1', 'scripts/verify-backup.ps1', 'scripts/build-android-release.ps1',
        'android/app/src/main/AndroidManifest.xml', 'android/app/src/release/AndroidManifest.xml'
    ];
    for (const file of requiredFiles) exists(file) ? pass(`${file} present`) : fail(`${file} absent`);

    const secretLength = String(process.env.SESSION_SECRET || '').length;
    secretLength >= 32 ? pass('SESSION_SECRET robuste') : fail('SESSION_SECRET doit contenir au moins 32 caracteres');
    String(process.env.ADMIN_PASSWORD || '').length >= 12 ? pass('Mot de passe admin de longueur suffisante') :
        fail('ADMIN_PASSWORD doit contenir au moins 12 caracteres');
    process.env.PHOTO_STORAGE === 'database' ? pass('Photos stockees dans PostgreSQL') :
        fail('PHOTO_STORAGE=database est requis pour la production');
    process.env.DATABASE_FALLBACK === 'disabled' ? pass('Fallback memoire desactive') :
        fail('DATABASE_FALLBACK=disabled est requis');
    process.env.ADMIN_RESET_PASSWORD === 'true' ?
        fail('ADMIN_RESET_PASSWORD doit rester false hors reinitialisation exceptionnelle') :
        pass('Reinitialisation automatique du mot de passe admin desactivee');
    Number(process.env.DATA_RETENTION_DAYS) > 0 ? pass(`Retention active (${process.env.DATA_RETENTION_DAYS} jours)`) :
        fail('DATA_RETENTION_DAYS doit etre superieur a zero');

    const releaseManifestPath = path.join(root, 'android', 'app', 'src', 'release', 'AndroidManifest.xml');
    const releaseManifest = exists('android/app/src/release/AndroidManifest.xml') ?
        fs.readFileSync(releaseManifestPath, 'utf8') : '';
    /usesCleartextTraffic="false"/.test(releaseManifest) ?
        pass('Trafic HTTP Android release interdit') :
        fail('Le manifeste Android release doit interdire le trafic HTTP');

    try {
        const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public', 'manifest.webmanifest'), 'utf8'));
        const iconSizes = new Set((manifest.icons || []).filter((icon) => icon.type === 'image/png').map((icon) => icon.sizes));
        iconSizes.has('192x192') && iconSizes.has('512x512') ?
            pass('Icones PWA 192x192 et 512x512 declarees') :
            fail('Le manifeste PWA doit declarer les icones PNG 192x192 et 512x512');
    } catch (error) {
        fail(`Manifest PWA invalide: ${error.message}`);
    }

    try {
        await pool.query('SELECT 1');
        if (pool.isMemory()) fail('La connexion utilise une base temporaire');
        else pass('PostgreSQL persistant accessible');
        const columns = (await pool.query(
            `SELECT table_name, column_name FROM information_schema.columns
             WHERE (table_name = 'verifications' AND column_name IN ('client_request_id', 'captured_at'))
                OR (table_name = 'admins' AND column_name = 'session_version')`
        )).rows.map((row) => `${row.table_name}.${row.column_name}`);
        for (const expected of ['verifications.client_request_id', 'verifications.captured_at', 'admins.session_version']) {
            columns.includes(expected) ? pass(`Schema ${expected}`) : fail(`Migration absente: ${expected}`);
        }
    } catch (error) {
        fail(`PostgreSQL inaccessible: ${error.message}`);
    } finally {
        await pool.end();
    }

    const backupDirectory = path.join(root, '.backups');
    const backups = fs.existsSync(backupDirectory) ? fs.readdirSync(backupDirectory)
        .filter((name) => /^wave-verification-\d{8}-\d{6}\.dump$/.test(name))
        .map((name) => ({ name, mtime: fs.statSync(path.join(backupDirectory, name)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime) : [];
    if (!backups.length) fail('Aucune sauvegarde PostgreSQL locale');
    else if (Date.now() - backups[0].mtime > 48 * 60 * 60 * 1000) fail(`Derniere sauvegarde trop ancienne: ${backups[0].name}`);
    else pass(`Sauvegarde recente: ${backups[0].name}`);

    const serverUrl = String(process.env.CAPACITOR_SERVER_URL || '');
    if (/^https:\/\//.test(serverUrl)) pass('URL Android HTTPS configuree');
    else waitForExternal('Definir CAPACITOR_SERVER_URL avec l URL HTTPS publique definitive');

    const keyFile = path.join(root, 'android', 'key.properties');
    const keyProperties = parseProperties(keyFile);
    if (!fs.existsSync(keyFile)) {
        waitForExternal('Creer android/key.properties avec la cle de signature proprietaire');
    } else {
        const keyStore = keyProperties.storeFile ?
            path.resolve(root, 'android', 'app', keyProperties.storeFile) : null;
        if (!keyStore || !fs.existsSync(keyStore)) fail('Keystore Android reference introuvable');
        else if (Object.values(keyProperties).some((value) => /CHANGE_ME/i.test(value))) fail('Valeurs CHANGE_ME dans key.properties');
        else pass('Keystore Android configure');
    }

    exists('artifacts/PortefeuilleDemo-debug.apk') ? pass('APK debug disponible') : fail('APK debug absent');

    console.log('\nPREPARATION PRODUCTION');
    passed.forEach((item) => console.log(`OK  ${item}`));
    failures.forEach((item) => console.log(`ERREUR  ${item}`));
    external.forEach((item) => console.log(`EXTERNE  ${item}`));
    console.log(`\nResultat: ${passed.length} OK, ${failures.length} erreur(s), ${external.length} prerequis externe(s).`);
    if (failures.length) process.exitCode = 1;
    else if (external.length) process.exitCode = 2;
}

run().catch((error) => {
    console.error(`Controle production interrompu: ${error.message}`);
    process.exitCode = 1;
});
