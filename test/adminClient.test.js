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
    const detailDialog = window.document.getElementById('detailDialog');
    detailDialog.showModal = () => { detailDialog.open = true; };
    detailDialog.close = () => { detailDialog.open = false; };
    window.fetch = async (url, options = {}) => {
        calls.push({ url, options });
        let data;
        if (url === '/health') data = { success: true, persistent: false, storage: 'memory' };
        else if (url === '/api/admin/status') data = { success: true, authenticated: false };
        else if (url === '/api/admin/login') data = { success: true, admin: { username: 'admin' } };
        else if (url.startsWith('/api/admin/verifications/search')) data = { success: true, data: [item], count: 1 };
        else if (url.startsWith('/api/admin/verifications?')) data = { success: true, data: [item], pagination: { total: 1, currentPage: 1, totalPages: 1 } };
        else if (url === '/api/admin/stats') data = { success: true, data: { overview: { total: 1, success: 1, with_location: 1, with_photo: 1 } } };
        else if (url === `/api/admin/verification/${item.verification_id}`) data = { success: true, data: { ...item, accuracy: 12 } };
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
    window.document.getElementById('closeDetailButton').click();
    assert.equal(detailDialog.open, false);

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

    window.document.getElementById('logoutButton').click();
    await flush();
    assert.equal(window.document.getElementById('loginPage').style.display, 'flex');
    dom.window.close();
});
