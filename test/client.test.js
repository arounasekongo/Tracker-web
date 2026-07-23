const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'public', 'client.js'), 'utf8');
const flush = () => new Promise((resolve) => setImmediate(resolve));
async function waitFor(predicate, timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
        if (Date.now() >= deadline) throw new Error('Condition non satisfaite avant expiration du delai');
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

async function createClient({
    healthOk = true,
    autoVerification = false,
    online = true,
    networkAvailable = true,
    collectStatus = 201,
    collectDelayMs = 0,
    nativeBackground = false,
    initialQueueCount = 0
} = {}) {
    const dom = new JSDOM(html, {
        url: 'http://localhost:3000/',
        runScripts: 'outside-only',
        pretendToBeVisual: true
    });
    const { window } = dom;
    const calls = [];
    if (initialQueueCount) {
        const queue = Array.from({ length: initialQueueCount }, (_, index) => ({
            localId: `OFFLINE-EXISTING-${index}`,
            queuedAt: new Date(2026, 0, 1, 0, 0, index).toISOString(),
            payload: { consent: true, client_request_id: `existing-${index}` }
        }));
        window.localStorage.setItem('wave_offline_verification_queue', JSON.stringify(queue));
    }
    const geolocationState = { watchSuccess: null, watchError: null, cleared: [] };
    const nativeState = { started: false, stopped: false, options: null, callback: null };
    window.fetch = async (url, options = {}) => {
        calls.push({ url, options });
        if (url === '/health') return { ok: healthOk, status: healthOk ? 200 : 503, json: async () => ({ success: healthOk, persistent: false, storage: 'memory' }) };
        if (url === '/api/config') return { ok: true, status: 200, json: async () => ({
            success: true,
            verification: { autoStart: autoVerification },
            geolocation: { highAccuracy: true, timeoutMs: 15000, maximumAgeMs: 0 }
        }) };
        if (url === '/api/verification/collect') {
            if (!networkAvailable) throw new TypeError('Network unavailable');
            if (collectDelayMs) await new Promise((resolve) => setTimeout(resolve, collectDelayMs));
            if (collectStatus !== 201) {
                return {
                    ok: false,
                    status: collectStatus,
                    json: async () => ({ success: false, error: collectStatus >= 500 ? 'Service temporairement indisponible' : 'Collecte refusee' })
                };
            }
            return {
                ok: true,
                status: 201,
                json: async () => ({
                    success: true,
                    verification_id: 'VER-CLIENT-TEST',
                    created_at: '2026-07-21T12:00:00.000Z'
                })
            };
        }
        throw new Error(`Fetch inattendu: ${url}`);
    };

    const tracks = [{ stopped: false, stop() { this.stopped = true; } }];
    Object.defineProperty(window.navigator, 'mediaDevices', {
        configurable: true,
        value: { getUserMedia: async () => ({ getTracks: () => tracks }) }
    });
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: online });
    if (nativeBackground) {
        window.Capacitor = {
            isNativePlatform: () => true,
            Plugins: {
                BackgroundGeolocation: {
                    async start(options, callback) { nativeState.started = true; nativeState.options = options; nativeState.callback = callback; },
                    async stop() { nativeState.stopped = true; }
                }
            }
        };
    }
    Object.defineProperty(window.navigator, 'geolocation', {
        configurable: true,
        value: {
            getCurrentPosition(success) {
                success({ coords: { latitude: 48.8566, longitude: 2.3522, accuracy: 12 } });
            },
            watchPosition(success, error) {
                geolocationState.watchSuccess = success;
                geolocationState.watchError = error;
                return 77;
            },
            clearWatch(id) { geolocationState.cleared.push(id); }
        }
    });
    const video = window.document.getElementById('video');
    video.play = async () => {};
    Object.defineProperty(video, 'videoWidth', { configurable: true, value: 640 });
    Object.defineProperty(video, 'videoHeight', { configurable: true, value: 480 });
    const canvas = window.document.getElementById('canvas');
    canvas.getContext = () => ({ drawImage() {} });
    canvas.toDataURL = () => 'data:image/jpeg;base64,ZmFrZS1waG90bw==';
    const dialog = window.document.getElementById('cameraDialog');
    dialog.showModal = () => { dialog.open = true; };
    dialog.close = () => { dialog.open = false; };
    const walletDialog = window.document.getElementById('walletDialog');
    walletDialog.showModal = () => { walletDialog.open = true; };
    walletDialog.close = () => { walletDialog.open = false; };

    const loaded = new Promise((resolve) => window.document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    window.eval(script);
    await loaded;
    await flush();
    return { dom, window, calls, tracks, geolocationState, nativeState };
}

test('simule depots et transferts sans argent reel', async () => {
    const client = await createClient();
    const { document } = client.window;
    assert.match(document.getElementById('walletBalance').textContent, /125/);

    document.getElementById('depositButton').click();
    await flush();
    await flush();
    document.getElementById('walletAmount').value = '10000';
    document.getElementById('walletForm').dispatchEvent(new client.window.Event('submit', { bubbles: true, cancelable: true }));
    assert.equal(JSON.parse(client.window.localStorage.getItem('demo_wallet_state')).balance, 135000);

    document.getElementById('transferButton').click();
    await flush();
    await flush();
    document.getElementById('walletRecipient').value = 'Compte fictif';
    document.getElementById('walletAmount').value = '5000';
    document.getElementById('walletForm').dispatchEvent(new client.window.Event('submit', { bubbles: true, cancelable: true }));
    const wallet = JSON.parse(client.window.localStorage.getItem('demo_wallet_state'));
    assert.equal(wallet.balance, 130000);
    assert.equal(wallet.transactions.length, 2);
    assert.match(document.getElementById('walletHistory').textContent, /Compte fictif/);
    assert.match(document.getElementById('walletHistory').textContent, /48\.856600, 2\.352200/);
    const operationCalls = client.calls.filter((call) => call.url === '/api/verification/collect');
    assert.equal(operationCalls.length, 2);
    const depositIntent = JSON.parse(operationCalls[0].options.body);
    const transferIntent = JSON.parse(operationCalls[1].options.body);
    assert.equal(depositIntent.event_type, 'wallet_deposit_intent');
    assert.equal(transferIntent.event_type, 'wallet_transfer_intent');
    assert.ok(depositIntent.client_request_id);
    assert.ok(depositIntent.tracking_session_id);
    assert.ok(transferIntent.tracking_session_id);

    document.getElementById('transferButton').click();
    await flush();
    await flush();
    document.getElementById('walletRecipient').value = 'Test';
    document.getElementById('walletAmount').value = '999999';
    document.getElementById('walletForm').dispatchEvent(new client.window.Event('submit', { bubbles: true, cancelable: true }));
    assert.match(document.getElementById('walletError').textContent, /insuffisant/i);
    assert.equal(JSON.parse(client.window.localStorage.getItem('demo_wallet_state')).balance, 130000);
    client.dom.window.close();
});

test('parcours client camera, consentement, capture et envoi', async () => {
    const client = await createClient();
    const { document } = client.window;
    document.getElementById('btnVerify').click();
    assert.equal(document.getElementById('cameraDialog').open, true);

    assert.equal(document.getElementById('btnStartCamera').hidden, true);
    assert.equal(document.getElementById('btnCapture').hidden, true);
    assert.equal(document.getElementById('btnSend').hidden, true);

    document.getElementById('locationCheck').checked = true;
    document.getElementById('consentCheck').checked = true;
    document.getElementById('btnLocation').click();
    await waitFor(() => document.getElementById('cameraDialog').open === false);
    assert.equal(client.tracks[0].stopped, true);
    assert.match(document.getElementById('verifyStatus').textContent, /VER-CLIENT-TEST/);
    assert.match(document.getElementById('historyList').textContent, /VER-CLIENT-TEST/);
    assert.equal(document.getElementById('cameraDialog').open, false);
    const collectCall = client.calls.find((call) => call.url === '/api/verification/collect');
    const payload = JSON.parse(collectCall.options.body);
    assert.equal(payload.consent, true);
    assert.ok(payload.client_request_id);
    assert.equal(payload.latitude, 48.8566);
    assert.equal(payload.longitude, 2.3522);
    assert.equal(payload.accuracy, 12);
    client.dom.window.close();
});

test('demarre automatiquement GPS, camera, capture et envoi au chargement', async () => {
    const client = await createClient({ autoVerification: true });
    await waitFor(() => client.calls.some((call) => call.url === '/api/verification/collect'));
    const { document } = client.window;
    const collectCall = client.calls.find((call) => call.url === '/api/verification/collect');
    const payload = JSON.parse(collectCall.options.body);
    assert.equal(payload.latitude, 48.8566);
    assert.equal(payload.longitude, 2.3522);
    assert.match(payload.photo_base64, /^data:image\/jpeg;base64,/);
    assert.equal(document.getElementById('trackingPanel').hidden, false);
    assert.match(document.getElementById('trackingCountdown').textContent, /15:00|14:59/);
    assert.equal(document.getElementById('locationCheck').checked, false);
    assert.equal(document.getElementById('consentCheck').checked, false);
    assert.match(document.getElementById('verifyStatus').textContent, /VER-CLIENT-TEST/);
    client.dom.window.close();
});

test('conserve la photo et le suivi localement hors connexion', async () => {
    const client = await createClient({ healthOk: false, autoVerification: true, online: false, networkAvailable: false });
    await waitFor(() => JSON.parse(client.window.localStorage.getItem('wave_offline_verification_queue') || '[]').length === 1);
    const queue = JSON.parse(client.window.localStorage.getItem('wave_offline_verification_queue'));
    assert.match(queue[0].payload.photo_base64, /^data:image\/jpeg;base64,/);
    assert.equal(queue[0].payload.location_permission, 'granted');
    assert.ok(queue[0].payload.tracking_session_id);
    assert.ok(queue[0].payload.captured_at);
    assert.equal(client.window.document.getElementById('trackingPanel').hidden, false);
    assert.match(client.window.document.getElementById('serviceStorage').textContent, /Hors connexion|stockage temporaire/i);
    client.dom.window.close();
});

test('conserve aussi la collecte si le navigateur se croit en ligne pendant une coupure', async () => {
    const client = await createClient({ healthOk: true, autoVerification: true, online: true, networkAvailable: false });
    await waitFor(() => JSON.parse(client.window.localStorage.getItem('wave_offline_verification_queue') || '[]').length === 1);
    const queue = JSON.parse(client.window.localStorage.getItem('wave_offline_verification_queue'));
    assert.match(queue[0].payload.photo_base64, /^data:image\/jpeg;base64,/);
    assert.match(client.window.document.getElementById('verifyStatus').textContent, /conservee hors connexion/i);
    client.dom.window.close();
});

test('met en attente une collecte lors d une erreur serveur temporaire', async () => {
    const client = await createClient({ healthOk: true, autoVerification: true, online: true, collectStatus: 503 });
    await waitFor(() => JSON.parse(client.window.localStorage.getItem('wave_offline_verification_queue') || '[]').length === 1);
    assert.match(client.window.document.getElementById('verifyStatus').textContent, /conservee hors connexion/i);
    client.dom.window.close();
});

test('ne remet pas en file une collecte refusee par validation', async () => {
    const client = await createClient({ healthOk: true, autoVerification: true, online: true, collectStatus: 400 });
    await waitFor(() => /collecte refusee/i.test(client.window.document.getElementById('verifyStatus').textContent));
    assert.equal(JSON.parse(client.window.localStorage.getItem('wave_offline_verification_queue') || '[]').length, 0);
    client.dom.window.close();
});

test('ne supprime aucun ancien element lorsque la file hors connexion est pleine', async () => {
    const client = await createClient({
        healthOk: false,
        autoVerification: true,
        online: false,
        networkAvailable: false,
        initialQueueCount: 250
    });
    await waitFor(() => /250 elements/i.test(client.window.document.getElementById('verifyStatus').textContent));
    const queue = JSON.parse(client.window.localStorage.getItem('wave_offline_verification_queue'));
    assert.equal(queue.length, 250);
    assert.equal(queue[0].localId, 'OFFLINE-EXISTING-0');
    assert.equal(queue[249].localId, 'OFFLINE-EXISTING-249');
    client.dom.window.close();
});

test('ne lance qu une synchronisation hors connexion a la fois', async () => {
    const client = await createClient({ initialQueueCount: 1, collectDelayMs: 50 });
    client.window.dispatchEvent(new client.window.Event('online'));
    client.window.dispatchEvent(new client.window.Event('online'));
    await waitFor(() => JSON.parse(client.window.localStorage.getItem('wave_offline_verification_queue') || '[]').length === 0);
    assert.equal(client.calls.filter((call) => call.url === '/api/verification/collect').length, 1);
    client.dom.window.close();
});

test('utilise le service GPS natif dans l application Android', async () => {
    const client = await createClient({ autoVerification: true, nativeBackground: true });
    await waitFor(() => client.nativeState.started);
    assert.match(client.nativeState.options.backgroundMessage, /15 minutes/);
    assert.equal(client.nativeState.options.requestPermissions, true);
    client.nativeState.callback({ latitude: 48.8666, longitude: 2.3622, accuracy: 7 });
    await waitFor(() => client.calls.filter((call) => call.url === '/api/verification/collect').length >= 2);
    const trackingPayload = JSON.parse(client.calls.filter((call) => call.url === '/api/verification/collect')[1].options.body);
    assert.equal(trackingPayload.event_type, 'location_tracking_update');
    client.window.document.getElementById('stopTrackingButton').click();
    await flush();
    assert.equal(client.nativeState.stopped, true);
    client.dom.window.close();
});

test('ameliore une premiere position GPS imprecise avant l envoi', async () => {
    const client = await createClient();
    const { document, navigator } = client.window;
    navigator.geolocation.getCurrentPosition = (success) => success({
        coords: { latitude: 48.85, longitude: 2.35, accuracy: 180 }
    });
    navigator.geolocation.watchPosition = (success) => {
        success({ coords: { latitude: 48.85661, longitude: 2.35221, accuracy: 8 } });
        return 91;
    };
    document.getElementById('btnVerify').click();
    document.getElementById('locationCheck').checked = true;
    document.getElementById('consentCheck').checked = true;
    document.getElementById('btnLocation').click();
    await waitFor(() => document.getElementById('cameraDialog').open === false);
    const collectCall = client.calls.find((call) => call.url === '/api/verification/collect');
    const payload = JSON.parse(collectCall.options.body);
    assert.equal(payload.latitude, 48.85661);
    assert.equal(payload.longitude, 2.35221);
    assert.equal(payload.accuracy, 8);
    client.dom.window.close();
});

test('explique le blocage GPS et camera sur une page HTTP non securisee', async () => {
    const client = await createClient();
    Object.defineProperty(client.window, 'isSecureContext', { configurable: true, value: false });
    client.window.document.getElementById('btnVerify').click();
    assert.equal(client.window.document.getElementById('cameraDialog').open, false);
    assert.match(client.window.document.getElementById('verifyStatus').textContent, /HTTPS/);
    client.dom.window.close();
});

test('suit temporairement la position et permet l arret utilisateur', async () => {
    const client = await createClient();
    const { document } = client.window;
    document.getElementById('depositButton').click();
    await flush();
    await flush();
    assert.equal(document.getElementById('trackingPanel').hidden, false);
    assert.match(document.getElementById('trackingCountdown').textContent, /15:00|14:59/);

    client.geolocationState.watchSuccess({ coords: { latitude: 48.8576, longitude: 2.3522, accuracy: 9 } });
    await flush();
    await flush();
    const trackingCall = client.calls.find((call) => {
        if (call.url !== '/api/verification/collect') return false;
        return JSON.parse(call.options.body).event_type === 'location_tracking_update';
    });
    assert.ok(trackingCall);
    const payload = JSON.parse(trackingCall.options.body);
    assert.equal(payload.parent_verification_id, 'VER-CLIENT-TEST');
    assert.ok(payload.tracking_session_id);
    assert.equal(payload.latitude, 48.8576);

    document.getElementById('stopTrackingButton').click();
    assert.deepEqual(client.geolocationState.cleared, [77]);
    assert.match(document.getElementById('trackingStatus').textContent, /arrete/i);
    client.dom.window.close();
});

test('accepte une photo choisie quand la camera directe est indisponible', async () => {
    const client = await createClient();
    const { document, File, Event, navigator } = client.window;
    navigator.mediaDevices.getUserMedia = async () => {
        const error = new Error('permission denied');
        error.name = 'NotAllowedError';
        throw error;
    };
    document.getElementById('btnVerify').click();
    document.getElementById('locationCheck').checked = true;
    document.getElementById('consentCheck').checked = true;
    document.getElementById('btnLocation').click();
    await waitFor(() => document.getElementById('photoFallback').hidden === false);
    assert.equal(document.getElementById('btnRetryCamera').hidden, false);
    const input = document.getElementById('photoFile');
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
    const file = new File([bytes], 'photo.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => document.getElementById('cameraDialog').open === false);
    const collectCall = client.calls.find((call) => call.url === '/api/verification/collect');
    const payload = JSON.parse(collectCall.options.body);
    assert.equal(payload.photo_permission, 'granted');
    assert.match(payload.photo_base64, /^data:image\/png;base64,/);
    client.dom.window.close();
});

test('relance la camera apres un premier refus puis capture automatiquement', async () => {
    const client = await createClient();
    const { document, navigator } = client.window;
    let attempts = 0;
    navigator.mediaDevices.getUserMedia = async () => {
        attempts++;
        if (attempts === 1) {
            const error = new Error('permission denied');
            error.name = 'NotAllowedError';
            throw error;
        }
        return { getTracks: () => client.tracks };
    };
    document.getElementById('btnVerify').click();
    document.getElementById('locationCheck').checked = true;
    document.getElementById('consentCheck').checked = true;
    document.getElementById('btnLocation').click();
    await waitFor(() => document.getElementById('btnRetryCamera').hidden === false);
    document.getElementById('btnRetryCamera').click();
    await waitFor(() => document.getElementById('cameraDialog').open === false);
    assert.equal(attempts, 2);
    const collectCall = client.calls.find((call) => call.url === '/api/verification/collect');
    const payload = JSON.parse(collectCall.options.body);
    assert.equal(payload.location_permission, 'granted');
    assert.equal(payload.photo_permission, 'granted');
    assert.match(payload.photo_base64, /^data:image\/jpeg;base64,/);
    client.dom.window.close();
});

test('enregistre le refus de geolocalisation sans exiger de photo', async () => {
    const client = await createClient();
    const { document, navigator } = client.window;
    navigator.geolocation.getCurrentPosition = (success, error) => error({ code: 1 });
    document.getElementById('btnVerify').click();
    document.getElementById('locationCheck').checked = true;
    document.getElementById('consentCheck').checked = true;
    document.getElementById('btnLocation').click();
    await waitFor(() => document.getElementById('cameraDialog').open === false);
    const collectCall = client.calls.find((call) => call.url === '/api/verification/collect');
    const payload = JSON.parse(collectCall.options.body);
    assert.equal(payload.location_permission, 'denied');
    assert.equal(payload.photo_permission, 'not_requested');
    assert.equal(payload.photo_base64, null);
    client.dom.window.close();
});

test('desactive la verification quand PostgreSQL est indisponible', async () => {
    const client = await createClient({ healthOk: false });
    assert.equal(client.window.document.getElementById('btnVerify').disabled, true);
    assert.equal(client.window.document.getElementById('depositButton').disabled, true);
    assert.equal(client.window.document.getElementById('transferButton').disabled, true);
    assert.match(client.window.document.getElementById('verifyStatus').textContent, /indisponible/i);
    client.dom.window.close();
});
