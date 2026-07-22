const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const app = require('../server');

async function withServer(run) {
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
        await run(`http://127.0.0.1:${server.address().port}`);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

test('sert les interfaces client et admin', async () => {
    await withServer(async (baseUrl) => {
        const home = await fetch(`${baseUrl}/`);
        assert.equal(home.status, 200);
        assert.match(await home.text(), /Portefeuille Demo/);

        const admin = await fetch(`${baseUrl}/admin`);
        assert.equal(admin.status, 200);
        assert.match(await admin.text(), /Administration Demo/);

        const config = await fetch(`${baseUrl}/api/config`);
        assert.equal(config.status, 200);
        assert.equal(typeof (await config.json()).geolocation.timeoutMs, 'number');
        assert.match(home.headers.get('permissions-policy'), /geolocation=\(self\)/);
    });
});

test('protege les routes admin', async () => {
    await withServer(async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/admin/verifications`);
        assert.equal(response.status, 401);
        assert.equal((await response.json()).success, false);
    });
});

test('refuse une collecte sans consentement explicite', async () => {
    await withServer(async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/verification/collect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ consent: false })
        });
        assert.equal(response.status, 403);
        assert.match((await response.json()).error, /Consentement/);
    });
});

test('enregistre une visite sans photo apres refus des permissions', async () => {
    await withServer(async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/verification/collect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ consent: true, location_permission: 'denied', photo_permission: 'denied' })
        });
        assert.equal(response.status, 201);
        assert.equal((await response.json()).success, true);
    });
});

test('traite les JSON invalides comme des erreurs client', async () => {
    await withServer(async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/verification/collect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{'
        });
        assert.equal(response.status, 400);
        assert.equal((await response.json()).success, false);
    });
});

test('retourne une erreur JSON pour une route API inconnue', async () => {
    await withServer(async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/inconnue`);
        assert.equal(response.status, 404);
        assert.equal((await response.json()).success, false);
    });
});

test('refuse un type d evenement inconnu', async () => {
    await withServer(async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/verification/collect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ consent: true, event_type: 'paiement_reel' })
        });
        assert.equal(response.status, 400);
        assert.match((await response.json()).error, /evenement invalide/i);
    });
});

test('exige une position autorisee pour une operation de portefeuille', async () => {
    await withServer(async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/verification/collect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ consent: true, event_type: 'wallet_transfer', location_permission: 'denied' })
        });
        assert.equal(response.status, 400);
        assert.match((await response.json()).error, /position autorisee/i);
    });
});

test('enregistre le refus d une demande de localisation au clic', async () => {
    await withServer(async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/verification/collect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ consent: true, event_type: 'wallet_deposit_intent', location_permission: 'denied' })
        });
        assert.equal(response.status, 201);
        assert.equal((await response.json()).status, 'failed');
    });
});

test('valide les points d une session de suivi', async () => {
    await withServer(async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/verification/collect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                consent: true,
                event_type: 'location_tracking_update',
                location_permission: 'granted',
                tracking_session_id: 'track-test-1',
                parent_verification_id: 'VER-PARENT',
                latitude: 14.71,
                longitude: -17.46,
                accuracy: 8
            })
        });
        assert.equal(response.status, 201);
        assert.equal((await response.json()).status, 'success');
    });
});
