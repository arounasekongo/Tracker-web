const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'admin.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'public', 'admin.js'), 'utf8');
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('parcours interface admin et rendu sans injection HTML', async () => {
    const dom = new JSDOM(html, { url: 'http://localhost:3000/admin', runScripts: 'outside-only', pretendToBeVisual: true });
    const { window } = dom;
    const calls = [];
    const item = {
        id: '11111111-1111-4111-8111-111111111111',
        verification_id: 'VER-ADMIN-TEST',
        event_type: 'wallet_transfer',
        created_at: '2026-07-21T12:00:00.000Z',
        ip_address: '127.0.0.1',
        latitude: '0.00000000',
        longitude: '0.00000000',
        browser_info: '<img src=x onerror=alert(1)>',
        has_photo: true,
        location_permission: 'granted',
        photo_permission: 'granted',
        status: 'success'
    };
    window.alert = () => {};
    window.confirm = () => true;
    window.prompt = () => 'SUPPRIMER';
    const detailDialog = window.document.getElementById('detailDialog');
    detailDialog.showModal = () => { detailDialog.open = true; };
    detailDialog.close = () => { detailDialog.open = false; };
    const passwordDialog = window.document.getElementById('passwordDialog');
    passwordDialog.showModal = () => { passwordDialog.open = true; };
    passwordDialog.close = () => { passwordDialog.open = false; };
    window.fetch = async (url, options = {}) => {
        calls.push({ url, options });
        let data;
        if (url === '/health') data = { success: true, persistent: false, storage: 'memory' };
        else if (url === '/api/admin/status') data = { success: true, authenticated: false };
        else if (url === '/api/admin/login') data = { success: true, admin: { username: 'admin' } };
        else if (url.startsWith('/api/admin/verifications/search')) data = { success: true, data: [item], count: 1 };
        else if (url.startsWith('/api/admin/verifications?')) data = { success: true, data: [item], pagination: { total: 1, currentPage: 1, totalPages: 1 } };
        else if (url === '/api/admin/stats') data = { success: true, data: { overview: { total: 1, success: 1, with_location: 1, with_photo: 1 } } };
        else if (url === '/api/admin/operations') data = { success: true, data: { storage: 'memory', records: 1, photo_bytes: 1024, uptime_seconds: 120 } };
        else if (url.startsWith('/api/admin/audit')) data = { success: true, data: [], count: 0 };
        else if (url === '/api/admin/retention') data = { success: true, data: { enabled: true, days: 90, expired: 0 } };
        else if (url === '/api/admin/password') data = { success: true, message: 'Mot de passe modifie' };
        else if (url === `/api/admin/verification/${item.verification_id}`) data = { success: true, data: { ...item, accuracy: 12 } };
        else if (url === `/api/admin/verification/${item.verification_id}/track`) data = { success: true, data: [item, { ...item, latitude: 0.001, longitude: 0.002 }], count: 2 };
        else if (url === `/api/admin/verification/${item.id}` && options.method === 'DELETE') data = { success: true };
        else if (url === '/api/admin/logout') data = { success: true };
        else throw new Error(`Fetch inattendu: ${url}`);
        return { ok: true, status: 200, json: async () => data };
    };

    const loaded = new Promise((resolve) => window.document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    window.eval(script);
    await loaded;
    await flush();
    assert.equal(window.document.getElementById('storageStatus').textContent, 'Base temporaire');
    assert.equal(window.document.getElementById('loginPage').style.display, 'flex');

    window.document.getElementById('username').value = 'admin';
    window.document.getElementById('password').value = 'secret';
    window.document.getElementById('loginForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    await flush();
    assert.equal(window.document.getElementById('dashboardPage').style.display, 'block');
    assert.equal(window.document.getElementById('statTotal').textContent, '1');
    assert.match(window.document.getElementById('operationsSummary').textContent, /1 enregistrement/);
    assert.match(window.document.getElementById('operationsSummary').textContent, /90 jours/);
    assert.match(window.document.getElementById('verificationsTable').textContent, /0\.000000, 0\.000000/);
    assert.match(window.document.getElementById('verificationsTable').textContent, /Transfert simule/);
    assert.equal(window.document.querySelector('#verificationsTable img'), null);
    assert.match(window.document.getElementById('verificationsTable').textContent, /<img src=x/);

    const viewButton = [...window.document.querySelectorAll('#verificationsTable button')]
        .find((button) => button.textContent === 'Voir');
    viewButton.click();
    await flush();
    assert.equal(detailDialog.open, true);
    assert.equal(window.document.getElementById('detailLocation').textContent, '0.000000, 0.000000');
    assert.equal(window.document.getElementById('detailLocationPermission').textContent, 'Accordee');
    assert.equal(window.document.getElementById('detailEventType').textContent, 'Transfert simule');
    assert.equal(window.document.getElementById('detailTrackingSession').textContent, 'Non applicable');
    assert.match(window.document.getElementById('detailMapLink').href, /openstreetmap\.org/);
    assert.equal(window.document.getElementById('detailPhotoPermission').textContent, 'Accordee');
    assert.match(window.document.getElementById('detailPhoto').src, /VER-ADMIN-TEST\/photo$/);
    assert.equal(window.document.getElementById('detailTrackSection').hidden, false);
    assert.equal(window.document.querySelectorAll('#detailTrackMap circle').length, 2);
    assert.match(window.document.getElementById('detailTrackCount').textContent, /2 point/);
    assert.match(window.document.getElementById('detailBaseMap').dataset.src, /openstreetmap\.org\/export\/embed\.html/);
    assert.equal(window.document.getElementById('detailBaseMap').hidden, true);
    window.document.getElementById('loadBaseMapButton').click();
    assert.equal(window.document.getElementById('detailBaseMap').hidden, false);
    assert.match(window.document.getElementById('detailBaseMap').src, /marker=0\.001/);
    window.document.getElementById('closeDetailButton').click();
    assert.equal(detailDialog.open, false);
    assert.equal(window.document.getElementById('detailBaseMap').getAttribute('src'), null);

    const search = window.document.getElementById('searchInput');
    search.value = 'VER-ADMIN';
    search.dispatchEvent(new window.Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.ok(calls.some((call) => call.url.startsWith('/api/admin/verifications/search')));

    const deleteButton = [...window.document.querySelectorAll('#verificationsTable button')]
        .find((button) => button.textContent === 'Supprimer');
    deleteButton.click();
    await flush();
    assert.ok(calls.some((call) => call.url === `/api/admin/verification/${item.id}` && call.options.method === 'DELETE'));

    window.document.getElementById('passwordButton').click();
    assert.equal(passwordDialog.open, true);
    window.document.getElementById('currentPassword').value = 'secret';
    window.document.getElementById('newPassword').value = 'NouveauSecret2026!';
    window.document.getElementById('confirmPassword').value = 'NouveauSecret2026!';
    window.document.getElementById('passwordForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    const passwordCall = calls.find((call) => call.url === '/api/admin/password');
    assert.ok(passwordCall);
    assert.equal(JSON.parse(passwordCall.options.body).new_password, 'NouveauSecret2026!');
    assert.equal(passwordDialog.open, false);

    window.document.getElementById('logoutButton').click();
    await flush();
    assert.equal(window.document.getElementById('loginPage').style.display, 'flex');
    dom.window.close();
});

test('affiche l erreur exacte lorsque les identifiants admin sont incorrects', async () => {
    const dom = new JSDOM(html, { url: 'http://localhost:3000/admin', runScripts: 'outside-only', pretendToBeVisual: true });
    const { window } = dom;
    window.fetch = async (url) => {
        if (url === '/health') {
            return { ok: true, status: 200, json: async () => ({ success: true, persistent: false }) };
        }
        if (url === '/api/admin/status') {
            return { ok: true, status: 200, json: async () => ({ success: true, authenticated: false }) };
        }
        if (url === '/api/admin/login') {
            return { ok: false, status: 401, json: async () => ({ success: false, error: 'Identifiants incorrects' }) };
        }
        throw new Error(`Fetch inattendu: ${url}`);
    };

    const loaded = new Promise((resolve) => window.document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    window.eval(script);
    await loaded;
    await flush();
    window.document.getElementById('username').value = 'admin';
    window.document.getElementById('password').value = 'incorrect';
    window.document.getElementById('loginForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    assert.equal(window.document.getElementById('loginError').textContent, 'Identifiants incorrects');
    assert.equal(window.document.getElementById('loginPage').style.display, 'flex');
    dom.window.close();
});
