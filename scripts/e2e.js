const assert = require('node:assert/strict');

const baseUrl = process.env.E2E_BASE_URL || 'http://127.0.0.1:3100';
const username = process.env.E2E_ADMIN_USERNAME || 'admin';
const password = process.env.E2E_ADMIN_PASSWORD;
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
let cookie = '';

if (!password) throw new Error('E2E_ADMIN_PASSWORD est requis');

async function request(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (cookie && options.auth !== false) headers.Cookie = cookie;
    if (options.body && typeof options.body !== 'string') {
        headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(options.body);
    }
    const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
    const raw = await response.text();
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';', 1)[0];
    let data = null;
    try { data = JSON.parse(raw); } catch (error) { data = raw; }
    return { response, data, raw };
}

function ok(name, condition) {
    assert.ok(condition, name);
    console.log(`OK ${name}`);
}

async function run() {
    let result = await request('/health', { auth: false });
    ok('sante PostgreSQL', result.response.status === 200 && result.data.success);
    const clientPage = await request('/', { auth: false });
    ok('page client', clientPage.response.status === 200);
    ok('manifest PWA', (await request('/manifest.webmanifest', { auth: false })).response.status === 200);
    const privacy = await request('/privacy.html', { auth: false });
    ok('notice de confidentialite', privacy.response.status === 200 && privacy.raw.includes('15 minutes'));
    const serviceWorker = await request('/sw.js', { auth: false });
    ok('service worker PWA', serviceWorker.response.status === 200 && serviceWorker.raw.includes('portefeuille-demo-v4'));
    ok('politique geolocalisation', /geolocation=\(self\)/.test(clientPage.response.headers.get('permissions-policy') || ''));
    result = await request('/api/config', { auth: false });
    ok('configuration geolocalisation', result.response.status === 200 && result.data.geolocation.timeoutMs >= 3000);
    ok('verification automatique configuree', result.data.verification?.autoStart === true);
    const adminPage = await request('/admin', { auth: false });
    ok('page admin', adminPage.response.status === 200 && adminPage.raw.includes('Charger la carte OpenStreetMap'));
    ok('protection admin', (await request('/api/admin/verifications', { auth: false })).response.status === 401);

    result = await request('/api/admin/login', { method: 'POST', body: { username, password: 'incorrect' }, auth: false });
    ok('refus mauvais mot de passe', result.response.status === 401);
    result = await request('/api/admin/login', { method: 'POST', body: { username, password }, auth: false });
    ok('connexion admin', result.response.status === 200 && result.data.success);
    result = await request('/api/admin/status');
    ok('session admin', result.data.authenticated === true);
    const previousSessionCookie = cookie;
    const temporaryPassword = 'E2eTemporaire2026!';
    result = await request('/api/admin/password', {
        method: 'POST', body: { current_password: password, new_password: temporaryPassword }
    });
    ok('changement mot de passe admin', result.response.status === 200 && /invalidees/.test(result.data.message));
    const invalidatedResponse = await fetch(`${baseUrl}/api/admin/status`, { headers: { Cookie: previousSessionCookie } });
    const invalidatedStatus = await invalidatedResponse.json();
    ok('ancienne session invalidee', invalidatedStatus.authenticated === false);
    result = await request('/api/admin/password', {
        method: 'POST', body: { current_password: temporaryPassword, new_password: password }
    });
    ok('restauration mot de passe admin', result.response.status === 200);
    result = await request('/api/admin/operations');
    ok('etat operationnel admin', result.response.status === 200 && result.data.data.storage);
    result = await request('/api/admin/audit');
    ok('journal audit connexion', result.response.status === 200 && result.data.data.some((item) => item.action === 'login_success'));
    result = await request('/api/admin/retention');
    ok('politique de retention', result.response.status === 200 && typeof result.data.data.enabled === 'boolean');
    const streamController = new AbortController();
    const streamResponse = await fetch(`${baseUrl}/api/admin/events`, { headers: { Cookie: cookie }, signal: streamController.signal });
    const streamChunk = await streamResponse.body.getReader().read();
    streamController.abort();
    ok('canal admin temps reel', streamResponse.status === 200 && new TextDecoder().decode(streamChunk.value).includes('event: ready'));

    result = await request('/api/verification/collect', {
        method: 'POST', body: { consent: true, photo_base64: 'data:image/png;base64,***' }, auth: false
    });
    ok('refus image invalide', result.response.status === 400);

    const first = await request('/api/verification/collect', {
        method: 'POST', auth: false,
        body: { consent: true, client_request_id: 'e2e-photo-request-1', photo_base64: png, screen_resolution: '1920x1080', browser_info: 'E2E Browser', platform: 'Windows', language: 'fr' }
    });
    ok('collecte photo', first.response.status === 201 && first.data.verification_id);
    const duplicate = await request('/api/verification/collect', {
        method: 'POST', auth: false,
        body: { consent: true, client_request_id: 'e2e-photo-request-1', photo_base64: png }
    });
    ok('collecte idempotente sans doublon', duplicate.response.status === 200 && duplicate.data.duplicate && duplicate.data.verification_id === first.data.verification_id);
    const second = await request('/api/verification/collect', {
        method: 'POST', auth: false,
        body: { consent: true, photo_base64: png, latitude: 0, longitude: 0, accuracy: 5, browser_info: 'Zero Coordinates' }
    });
    ok('collecte coordonnees zero', second.response.status === 201);
    const locationOnly = await request('/api/verification/collect', {
        method: 'POST', auth: false,
        body: { consent: true, latitude: 12.34, longitude: 56.78, accuracy: 18, location_permission: 'granted', photo_permission: 'denied' }
    });
    ok('position enregistree sans photo', locationOnly.response.status === 201);
    const refused = await request('/api/verification/collect', {
        method: 'POST', auth: false,
        body: { consent: true, location_permission: 'denied', photo_permission: 'denied' }
    });
    ok('refus et IP enregistres sans photo', refused.response.status === 201);
    const transfer = await request('/api/verification/collect', {
        method: 'POST', auth: false,
        body: { consent: true, event_type: 'wallet_transfer_intent', tracking_session_id: 'track-e2e-1', latitude: 14.7167, longitude: -17.4677, accuracy: 9, location_permission: 'granted', photo_permission: 'not_requested' }
    });
    ok('ouverture transfert localisee', transfer.response.status === 201);
    const tracking = await request('/api/verification/collect', {
        method: 'POST', auth: false,
        body: { consent: true, event_type: 'location_tracking_update', tracking_session_id: 'track-e2e-1', parent_verification_id: transfer.data.verification_id, latitude: 14.7172, longitude: -17.4681, accuracy: 7, location_permission: 'granted', photo_permission: 'not_requested' }
    });
    ok('point de suivi localise', tracking.response.status === 201);
    result = await request(`/api/admin/verification/${first.data.verification_id}/photo`, { auth: false });
    ok('photo refusee sans authentification', result.response.status === 401);

    result = await request(`/api/verification/${first.data.verification_id}/status`, { auth: false });
    ok('statut public minimal', result.data.data.status === 'success' && !result.raw.includes('ip_address'));
    const list = await request('/api/admin/verifications?limit=10&offset=0');
    ok('liste et pagination', list.data.pagination.total === 6 && list.data.data.length === 6);
    const zero = list.data.data.find((item) => item.verification_id === second.data.verification_id);
    ok('latitude zero preservee', Number(zero.latitude) === 0 && Number(zero.longitude) === 0);
    const locationOnlyRow = list.data.data.find((item) => item.verification_id === locationOnly.data.verification_id);
    ok('permissions visibles sans photo', Number(locationOnlyRow.latitude) === 12.34 && locationOnlyRow.photo_permission === 'denied' && !locationOnlyRow.has_photo);
    const refusedRow = list.data.data.find((item) => item.verification_id === refused.data.verification_id);
    ok('refus de position visible', refusedRow.location_permission === 'denied' && refusedRow.ip_address);
    const transferRow = list.data.data.find((item) => item.verification_id === transfer.data.verification_id);
    ok('type de transfert visible', transferRow.event_type === 'wallet_transfer_intent' && Number(transferRow.latitude) === 14.7167);
    const trackingRow = list.data.data.find((item) => item.verification_id === tracking.data.verification_id);
    ok('session de suivi visible', trackingRow.tracking_session_id === 'track-e2e-1' && trackingRow.parent_verification_id === transfer.data.verification_id);
    result = await request(`/api/admin/verification/${transfer.data.verification_id}/track`);
    ok('trajet de suivi admin', result.response.status === 200 && result.data.count === 2 && Number(result.data.data[1].latitude) === 14.7172 && result.data.data[1].captured_at);
    ok('photos masquees dans liste', !/photo_base64|photo_path/.test(list.raw));

    result = await request('/api/admin/stats');
    ok('statistiques', result.data.data.overview.total === 6 && result.data.data.overview.success === 6);
    result = await request('/api/admin/stats/advanced');
    ok('statistiques avancees', result.response.status === 200 && Array.isArray(result.data.data.hourly));
    result = await request(`/api/admin/verifications/search?q=${encodeURIComponent(first.data.verification_id)}`);
    ok('recherche', result.data.count === 1);
    result = await request(`/api/admin/verification/${first.data.verification_id}`);
    ok('detail protege et masque', result.data.data.verification_id === first.data.verification_id && !/photo_base64|photo_path/.test(result.raw));
    result = await request(`/api/admin/verification/${first.data.verification_id}/photo`);
    ok('photo admin protegee', result.response.status === 200 && result.response.headers.get('content-type').startsWith('image/jpeg'));

    result = await request('/api/admin/verifications?status=unknown');
    ok('validation filtre', result.response.status === 400);
    result = await request('/api/admin/verifications?startDate=2026-02-31');
    ok('validation date calendaire', result.response.status === 400 && /Date de debut invalide/.test(result.raw));
    result = await request('/api/admin/export/csv');
    ok('export CSV', result.response.status === 200 && result.raw.includes('ID,Evenement,Date,IP'));
    result = await request('/api/admin/export/json');
    ok('export JSON masque', result.response.status === 200 && !/photo_base64|photo_path/.test(result.raw));
    result = await request('/api/admin/retention/run', { method: 'POST', body: {} });
    ok('confirmation purge obligatoire', result.response.status === 400);
    result = await request('/api/admin/retention/run', { method: 'POST', body: { confirmation: 'PURGER' } });
    ok('purge controlee sans donnees expirees', result.response.status === 200 && result.data.data.deleted === 0);
    const localBrowserOrigin = 'http://127.0.0.1:3000';
    result = await request('/health', { headers: { Origin: localBrowserOrigin }, auth: false });
    ok('CORS origine locale autorisee', result.response.status === 200 && result.response.headers.get('access-control-allow-origin') === localBrowserOrigin);
    const androidEmulatorOrigin = 'http://10.0.2.2:3000';
    result = await request('/health', { headers: { Origin: androidEmulatorOrigin }, auth: false });
    ok('CORS emulateur Android autorisee', result.response.status === 200 && result.response.headers.get('access-control-allow-origin') === androidEmulatorOrigin);
    result = await request('/health', { headers: { Origin: 'https://evil.example' }, auth: false });
    ok('CORS origine refusee', result.response.status === 403);

    const firstRow = list.data.data.find((item) => item.verification_id === first.data.verification_id);
    result = await request(`/api/admin/verification/${firstRow.id}`, { method: 'DELETE' });
    ok('suppression individuelle', result.response.status === 200 && result.data.success);
    result = await request(`/api/admin/verification/${transferRow.id}`, { method: 'DELETE' });
    ok('suppression du trajet associe', result.response.status === 200 && result.data.count === 2);
    result = await request('/api/admin/verifications/all', { method: 'DELETE', body: { confirmation: 'SUPPRIMER' } });
    ok('suppression globale', result.response.status === 200 && result.data.count === 3);
    result = await request('/api/admin/verifications');
    ok('base vide apres suppression', result.data.pagination.total === 0);

    result = await request('/api/admin/logout', { method: 'POST', body: {} });
    ok('deconnexion', result.response.status === 200);
    result = await request('/api/admin/status');
    ok('session fermee', result.data.authenticated === false);
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
