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
    ok('politique geolocalisation', /geolocation=\(self\)/.test(clientPage.response.headers.get('permissions-policy') || ''));
    result = await request('/api/config', { auth: false });
    ok('configuration geolocalisation', result.response.status === 200 && result.data.geolocation.timeoutMs >= 3000);
    ok('page admin', (await request('/admin', { auth: false })).response.status === 200);
    ok('protection admin', (await request('/api/admin/verifications', { auth: false })).response.status === 401);

    result = await request('/api/admin/login', { method: 'POST', body: { username, password: 'incorrect' }, auth: false });
    ok('refus mauvais mot de passe', result.response.status === 401);
    result = await request('/api/admin/login', { method: 'POST', body: { username, password }, auth: false });
    ok('connexion admin', result.response.status === 200 && result.data.success);
    result = await request('/api/admin/status');
    ok('session admin', result.data.authenticated === true);
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
        body: { consent: true, photo_base64: png, screen_resolution: '1920x1080', browser_info: 'E2E Browser', platform: 'Windows', language: 'fr' }
    });
    ok('collecte photo', first.response.status === 201 && first.data.verification_id);
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
        body: { consent: true, event_type: 'wallet_transfer_intent', latitude: 14.7167, longitude: -17.4677, accuracy: 9, location_permission: 'granted', photo_permission: 'not_requested' }
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
    result = await request('/api/admin/export/csv');
    ok('export CSV', result.response.status === 200 && result.raw.includes('ID,Evenement,Date,IP'));
    result = await request('/api/admin/export/json');
    ok('export JSON masque', result.response.status === 200 && !/photo_base64|photo_path/.test(result.raw));
    result = await request('/health', { headers: { Origin: 'https://evil.example' }, auth: false });
    ok('CORS origine refusee', result.response.status === 403);

    const firstRow = list.data.data.find((item) => item.verification_id === first.data.verification_id);
    result = await request(`/api/admin/verification/${firstRow.id}`, { method: 'DELETE' });
    ok('suppression individuelle', result.response.status === 200 && result.data.success);
    result = await request('/api/admin/verifications/all', { method: 'DELETE' });
    ok('suppression globale', result.response.status === 200 && result.data.count === 5);
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
