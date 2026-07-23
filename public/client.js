'use strict';

let stream = null;
let photoData = null;
let locationData = {};
let locationPermission = 'not_requested';
let photoPermission = 'not_requested';
let locationAttempted = false;
const historyKey = 'wave_verification_history';
const walletKey = 'demo_wallet_state';
const offlineQueueKey = 'wave_offline_verification_queue';
const offlineDatabaseName = 'portefeuille_demo_offline';
const offlineStoreName = 'verification_queue';
const offlineQueueLimit = 250;
let walletMode = 'deposit';
let walletLocationData = null;
let walletIntentReference = null;
let walletRequestId = 0;
let geoOptions = { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 };
let geoAccuracyOptions = { targetMeters: 30, acquisitionMs: 12000 };
let trackingOptions = { durationMs: 900000, minIntervalMs: 30000, minDistanceMeters: 25 };
let trackingWatchId = null;
let trackingEndTimer = null;
let trackingCountdownTimer = null;
let trackingEndAt = 0;
let trackingSessionId = null;
let trackingParentReference = null;
let trackingUsesNativePlugin = false;
let lastTrackedAt = 0;
let lastTrackedPosition = null;
let verificationRequestId = 0;
let autoVerificationOnLoad = false;
let installPrompt = null;
let offlineFlushPromise = null;
const elements = {};

function loadWallet() {
    try {
        const stored = JSON.parse(localStorage.getItem(walletKey) || 'null');
        if (stored && Number.isFinite(stored.balance) && Array.isArray(stored.transactions)) return stored;
    } catch (error) {
        localStorage.removeItem(walletKey);
    }
    return { balance: 125000, transactions: [] };
}

function saveWallet(wallet) {
    localStorage.setItem(walletKey, JSON.stringify(wallet));
}

function formatMoney(amount) {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'XOF', maximumFractionDigits: 0 }).format(amount);
}

function renderWallet() {
    const wallet = loadWallet();
    elements.walletBalance.textContent = formatMoney(wallet.balance);
    if (!wallet.transactions.length) {
        elements.walletHistory.textContent = 'Aucune operation.';
        return;
    }
    elements.walletHistory.replaceChildren(...wallet.transactions.slice(-6).reverse().map((transaction) => {
        const row = document.createElement('div');
        row.className = 'wallet-row';
        const description = document.createElement('span');
        description.textContent = `${transaction.label} - ${new Date(transaction.date).toLocaleString('fr-FR')}`;
        if (Number.isFinite(transaction.latitude) && Number.isFinite(transaction.longitude)) {
            const coordinates = document.createElement('small');
            coordinates.className = 'wallet-meta';
            coordinates.textContent = `GPS ${transaction.latitude.toFixed(6)}, ${transaction.longitude.toFixed(6)}`;
            description.append(coordinates);
        }
        const amount = document.createElement('strong');
        amount.className = transaction.type;
        amount.textContent = `${transaction.type === 'credit' ? '+' : '-'} ${formatMoney(transaction.amount)}`;
        row.append(description, amount);
        return row;
    }));
}

function openWalletOperation(mode) {
    walletMode = mode;
    const requestId = ++walletRequestId;
    walletLocationData = null;
    walletIntentReference = null;
    elements.walletDialogTitle.textContent = mode === 'deposit' ? 'Depot simule' : 'Transfert simule';
    elements.recipientField.hidden = mode !== 'transfer';
    elements.walletRecipient.required = mode === 'transfer';
    elements.walletAmount.value = '';
    elements.walletRecipient.value = '';
    elements.walletError.hidden = true;
    elements.walletLocationStatus.className = 'wallet-location-status';
    elements.walletLocationStatus.textContent = 'Demande de localisation au navigateur...';
    elements.walletSubmitButton.disabled = true;
    elements.walletSubmitButton.textContent = 'Localisation en cours...';
    elements.walletDialog.showModal();
    prepareWalletLocation(mode, requestId);
}

function closeWalletOperation() {
    walletRequestId++;
    if (elements.walletDialog.open) elements.walletDialog.close();
}

function createRequestId(prefix = 'request') {
    return window.crypto?.randomUUID?.() || `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

async function recordWalletIntent(mode, permission, coordinates = {}, sessionId = null) {
    return postOrQueueVerification({
        consent: true,
        event_type: mode === 'deposit' ? 'wallet_deposit_intent' : 'wallet_transfer_intent',
        location_permission: permission,
        photo_permission: 'not_requested',
        tracking_session_id: sessionId,
        screen_resolution: `${window.screen.width}x${window.screen.height}`,
        browser_info: navigator.userAgent,
        platform: navigator.userAgentData?.platform || navigator.platform || null,
        language: navigator.language || null,
        ...coordinates
    });
}

async function prepareWalletLocation(mode, requestId) {
    try {
        const coordinates = await getLocation();
        const sessionId = createRequestId('track');
        const result = await recordWalletIntent(mode, 'granted', coordinates, sessionId);
        if (requestId !== walletRequestId) return;
        walletLocationData = coordinates;
        walletIntentReference = result.verification_id;
        startLocationTracking(result.verification_id, coordinates, sessionId);
        elements.walletLocationStatus.className = 'wallet-location-status success';
        elements.walletLocationStatus.textContent = `Position enregistree : ${coordinates.latitude.toFixed(6)}, ${coordinates.longitude.toFixed(6)} (precision ${Math.round(coordinates.accuracy)} m).`;
        elements.walletSubmitButton.disabled = false;
        elements.walletSubmitButton.textContent = 'Confirmer la simulation';
    } catch (failure) {
        const permission = failure.permissionStatus || 'unavailable';
        try { await recordWalletIntent(mode, permission); } catch (recordError) { /* The visible error below remains sufficient. */ }
        if (requestId !== walletRequestId) return;
        elements.walletLocationStatus.className = 'wallet-location-status error';
        elements.walletLocationStatus.textContent = `${failure.message} L operation ne peut pas etre confirmee sans position.`;
        elements.walletSubmitButton.disabled = true;
        elements.walletSubmitButton.textContent = 'Position requise';
    }
}

function distanceInMeters(first, second) {
    if (!first || !second) return Infinity;
    const radians = (value) => value * Math.PI / 180;
    const deltaLatitude = radians(second.latitude - first.latitude);
    const deltaLongitude = radians(second.longitude - first.longitude);
    const latitude1 = radians(first.latitude);
    const latitude2 = radians(second.latitude);
    const value = Math.sin(deltaLatitude / 2) ** 2 +
        Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(deltaLongitude / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function updateTrackingCountdown() {
    const remainingSeconds = Math.max(0, Math.ceil((trackingEndAt - Date.now()) / 1000));
    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = String(remainingSeconds % 60).padStart(2, '0');
    elements.trackingCountdown.textContent = `- ${minutes}:${seconds}`;
}

async function recordTrackingPosition(coordinates) {
    return postOrQueueVerification({
        consent: true,
        event_type: 'location_tracking_update',
        location_permission: 'granted',
        photo_permission: 'not_requested',
        tracking_session_id: trackingSessionId,
        parent_verification_id: trackingParentReference,
        captured_at: new Date().toISOString(),
        screen_resolution: `${window.screen.width}x${window.screen.height}`,
        browser_info: navigator.userAgent,
        platform: navigator.userAgentData?.platform || navigator.platform || null,
        language: navigator.language || null,
        ...coordinates
    });
}

function stopLocationTracking(reason = 'manual') {
    if (trackingUsesNativePlugin) {
        const nativePlugin = getNativeBackgroundGeolocation();
        nativePlugin?.stop?.().catch(() => {});
    } else if (trackingWatchId !== null && navigator.geolocation?.clearWatch) navigator.geolocation.clearWatch(trackingWatchId);
    trackingWatchId = null;
    trackingUsesNativePlugin = false;
    clearTimeout(trackingEndTimer);
    clearInterval(trackingCountdownTimer);
    trackingEndTimer = null;
    trackingCountdownTimer = null;
    if (!elements.trackingPanel || elements.trackingPanel.hidden) return;
    elements.stopTrackingButton.hidden = true;
    elements.trackingCountdown.textContent = '';
    elements.trackingStatus.textContent = reason === 'expired' ?
        'Duree de suivi terminee. Aucune nouvelle position ne sera envoyee.' :
        reason === 'error' ? 'Suivi interrompu a cause d une erreur de localisation.' :
            'Suivi arrete. Aucune nouvelle position ne sera envoyee.';
}

function getNativeBackgroundGeolocation() {
    if (!window.Capacitor?.isNativePlatform?.()) return null;
    return window.Capacitor.Plugins?.BackgroundGeolocation || window.Capacitor.registerPlugin?.('BackgroundGeolocation') || null;
}

async function startLocationTracking(parentReference, initialPosition, existingSessionId = null) {
    const nativePlugin = getNativeBackgroundGeolocation();
    if (!nativePlugin && !navigator.geolocation?.watchPosition) return;
    if (trackingWatchId !== null) stopLocationTracking('replaced');
    trackingSessionId = existingSessionId || window.crypto?.randomUUID?.() || `track-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    trackingParentReference = parentReference;
    lastTrackedAt = Date.now();
    lastTrackedPosition = initialPosition;
    trackingEndAt = Date.now() + trackingOptions.durationMs;
    elements.trackingPanel.hidden = false;
    elements.stopTrackingButton.hidden = false;
    elements.trackingStatus.textContent = `Position initiale enregistree. Nouveau point apres un deplacement de ${trackingOptions.minDistanceMeters} m ou ${Math.round(trackingOptions.minIntervalMs / 1000)} s.`;
    updateTrackingCountdown();
    trackingCountdownTimer = setInterval(updateTrackingCountdown, 1000);
    trackingEndTimer = setTimeout(() => stopLocationTracking('expired'), trackingOptions.durationMs);
    const handlePosition = async (coordinates) => {
        const elapsed = Date.now() - lastTrackedAt;
        const distance = distanceInMeters(lastTrackedPosition, coordinates);
        if (elapsed < trackingOptions.minIntervalMs && distance < trackingOptions.minDistanceMeters) return;
        lastTrackedAt = Date.now();
        lastTrackedPosition = coordinates;
        try {
            await recordTrackingPosition(coordinates);
            elements.trackingStatus.textContent = `Derniere position : ${coordinates.latitude.toFixed(6)}, ${coordinates.longitude.toFixed(6)}, precision ${Math.round(coordinates.accuracy)} m.`;
        } catch (error) {
            elements.trackingStatus.textContent = error.message;
        }
    };
    const handleError = (error) => {
        elements.trackingStatus.textContent = error.code === 1 ? 'Autorisation de localisation retiree.' : 'Position temporairement indisponible.';
        if (error.code === 1 || error.code === 'NOT_AUTHORIZED') stopLocationTracking('error');
    };
    if (nativePlugin) {
        trackingUsesNativePlugin = true;
        trackingWatchId = 'native';
        try {
            await nativePlugin.start({
                backgroundTitle: 'Suivi GPS actif',
                backgroundMessage: 'Votre position est suivie pendant 15 minutes. Touchez pour revenir a l application.',
                requestPermissions: true,
                stale: false,
                distanceFilter: trackingOptions.minDistanceMeters
            }, (location, error) => {
                if (error) return handleError(error);
                if (location) handlePosition({ latitude: Number(location.latitude), longitude: Number(location.longitude), accuracy: Number(location.accuracy) });
            });
        } catch (error) {
            handleError(error);
        }
        return;
    }
    trackingWatchId = navigator.geolocation.watchPosition((position) => handlePosition({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy
    }), handleError, geoOptions);
}

function submitWalletOperation(event) {
    event.preventDefault();
    const amount = Number(elements.walletAmount.value);
    const recipient = elements.walletRecipient.value.trim();
    const wallet = loadWallet();
    let error = '';
    if (!Number.isFinite(amount) || amount < 100 || !Number.isInteger(amount)) error = 'Saisissez un montant entier d au moins 100 F CFA.';
    else if (walletMode === 'transfer' && !recipient) error = 'Indiquez un destinataire fictif.';
    else if (walletMode === 'transfer' && amount > wallet.balance) error = 'Solde fictif insuffisant.';
    else if (!walletLocationData || !walletIntentReference) error = 'Attendez l enregistrement de la position avant de confirmer.';
    if (error) {
        elements.walletError.textContent = error;
        elements.walletError.hidden = false;
        return;
    }
    const credit = walletMode === 'deposit';
    wallet.balance += credit ? amount : -amount;
    wallet.transactions.push({
        type: credit ? 'credit' : 'debit', amount,
        label: credit ? 'Depot simule' : `Transfert simule vers ${recipient}`,
        date: new Date().toISOString(), reference: walletIntentReference,
        ...walletLocationData
    });
    wallet.transactions = wallet.transactions.slice(-20);
    saveWallet(wallet);
    renderWallet();
    closeWalletOperation();
}

function setStatus(type, message) {
    elements.verifyStatus.className = type;
    elements.verifyStatus.textContent = message;
}

function openVerificationDialog() {
    if (window.isSecureContext === false) {
        setStatus('error', 'GPS et camera bloques : ouvrez cette application avec HTTPS. Une adresse IP en HTTP ne permet pas ces fonctions sur mobile.');
        return false;
    }
    if (!navigator.geolocation) {
        setStatus('error', 'GPS indisponible : activez la localisation de l appareil et autorisez-la dans le navigateur.');
        return false;
    }
    elements.cameraDialog.showModal();
    if (!navigator.mediaDevices?.getUserMedia) {
        elements.photoFallback.hidden = false;
        setStatus('error', 'Camera directe indisponible. Utilisez un navigateur compatible en HTTPS ou choisissez une photo.');
    }
    return true;
}

function loadHistory() {
    try {
        const value = JSON.parse(localStorage.getItem(historyKey) || '[]');
        return Array.isArray(value) ? value.filter((item) => item && item.id && item.date).slice(-5) : [];
    } catch (error) {
        localStorage.removeItem(historyKey);
        return [];
    }
}

function renderHistory() {
    const history = loadHistory().reverse();
    if (!history.length) {
        elements.historyList.className = 'muted';
        elements.historyList.textContent = 'Aucune verification effectuee.';
        return;
    }
    elements.historyList.className = '';
    elements.historyList.replaceChildren(...history.map((item) => {
        const row = document.createElement('div');
        row.className = 'history-row';
        const id = document.createElement('strong');
        id.textContent = item.id;
        const date = document.createElement('span');
        date.className = 'muted';
        date.textContent = new Date(item.date).toLocaleString('fr-FR');
        row.append(id, date);
        return row;
    }));
}

async function checkService() {
    try {
        const response = await fetch('/health', { cache: 'no-store' });
        if (!response.ok) throw new Error('unavailable');
        const health = await response.json();
        elements.serviceStorage.textContent = health.persistent ? 'Stockage PostgreSQL' : 'Mode test - stockage temporaire';
    } catch (error) {
        if (navigator.onLine === false) {
            elements.serviceStorage.textContent = 'Hors connexion - envoi differe';
            setStatus('info', 'Mode hors connexion : les donnees seront conservees sur cet appareil puis synchronisees.');
        } else {
            elements.btnVerify.disabled = true;
            elements.depositButton.disabled = true;
            elements.transferButton.disabled = true;
            elements.serviceStorage.textContent = 'Service indisponible';
            setStatus('error', 'Le service de verification est temporairement indisponible. Reessayez plus tard.');
        }
    }
}

async function loadClientConfig() {
    try {
        const response = await fetch('/api/config', { cache: 'no-store' });
        const config = await response.json();
        if (!response.ok || !config.geolocation) return;
        autoVerificationOnLoad = config.verification?.autoStart === true;
        geoOptions = {
            enableHighAccuracy: config.geolocation.highAccuracy !== false,
            timeout: Number(config.geolocation.timeoutMs) || 15000,
            maximumAge: Number(config.geolocation.maximumAgeMs) || 0
        };
        trackingOptions = {
            durationMs: Number(config.geolocation.trackingDurationMs) || 900000,
            minIntervalMs: Number(config.geolocation.trackingMinIntervalMs) || 30000,
            minDistanceMeters: Number(config.geolocation.trackingMinDistanceMeters) || 25
        };
        geoAccuracyOptions = {
            targetMeters: Number(config.geolocation.targetAccuracyMeters) || 30,
            acquisitionMs: Number(config.geolocation.acquisitionMs) || 12000
        };
    } catch (error) { /* The safe defaults remain active. */ }
}

function stopCamera() {
    if (stream) stream.getTracks().forEach((track) => track.stop());
    stream = null;
    elements.video.srcObject = null;
    elements.video.style.display = 'none';
}

function resetCapture() {
    photoData = null;
    elements.capturedPhoto.removeAttribute('src');
    elements.capturedPhoto.style.display = 'none';
    elements.videoPlaceholder.style.display = 'block';
    elements.btnCapture.disabled = true;
    elements.btnCapture.hidden = true;
    elements.btnRetake.hidden = true;
    elements.btnSend.hidden = true;
    elements.btnSendWithoutPhoto.hidden = true;
    elements.btnStartCamera.hidden = true;
    elements.btnStartCamera.disabled = true;
    elements.btnLocation.hidden = false;
    elements.btnLocation.disabled = false;
    elements.btnLocation.textContent = 'Autoriser la localisation et la camera';
    elements.btnRetryCamera.hidden = true;
    elements.btnRetryCamera.disabled = false;
    elements.btnDeclineLocation.hidden = true;
    elements.photoFallback.hidden = true;
    elements.consentCheck.checked = false;
    elements.locationCheck.checked = false;
    elements.photoFile.value = '';
    locationData = {};
    locationPermission = 'not_requested';
    photoPermission = 'not_requested';
    locationAttempted = false;
}

function getLocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) return reject(new Error('La geolocalisation n est pas disponible. Ouvrez le site en HTTPS ou sur localhost et activez le GPS.'));
        navigator.geolocation.getCurrentPosition(
            async (position) => {
                const initial = locationFromPosition(position);
                if (!navigator.geolocation.watchPosition || initial.accuracy <= geoAccuracyOptions.targetMeters) {
                    resolve(initial);
                    return;
                }
                resolve(await refineLocation(initial));
            },
            (error) => {
                const denied = error.code === 1;
                const failure = new Error(denied ?
                    'Autorisation de geolocalisation refusee.' :
                    'Position geographique indisponible.');
                failure.permissionStatus = denied ? 'denied' : 'unavailable';
                reject(failure);
            },
            geoOptions
        );
    });
}

function locationFromPosition(position) {
    return {
        latitude: Number(position.coords.latitude),
        longitude: Number(position.coords.longitude),
        accuracy: Number.isFinite(Number(position.coords.accuracy)) ? Number(position.coords.accuracy) : 100000
    };
}

function refineLocation(initial) {
    return new Promise((resolve) => {
        let best = initial;
        let watchId;
        let finished = false;
        const finish = () => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            if (watchId !== undefined) navigator.geolocation.clearWatch(watchId);
            resolve(best);
        };
        const timer = setTimeout(finish, geoAccuracyOptions.acquisitionMs);
        try {
            watchId = navigator.geolocation.watchPosition((position) => {
                const candidate = locationFromPosition(position);
                if (candidate.accuracy < best.accuracy) best = candidate;
                if (best.accuracy <= geoAccuracyOptions.targetMeters) finish();
            }, finish, geoOptions);
            if (finished && watchId !== undefined) navigator.geolocation.clearWatch(watchId);
        } catch (error) {
            finish();
        }
    });
}

function completeLocationStep(permission, data = {}) {
    locationAttempted = true;
    locationPermission = permission;
    locationData = data;
    elements.btnLocation.hidden = true;
    elements.btnDeclineLocation.hidden = true;
    elements.btnStartCamera.disabled = false;
    elements.btnSendWithoutPhoto.hidden = true;
}

async function collectLocation(automatic = false) {
    if (!automatic && !elements.locationCheck.checked) {
        setStatus('error', 'Cochez l autorisation de localisation.');
        return;
    }
    if (!automatic && !elements.consentCheck.checked) {
        setStatus('error', 'Cochez aussi l autorisation de prise et de traitement automatique de la photo.');
        return;
    }
    const requestId = ++verificationRequestId;
    const cameraPromise = navigator.mediaDevices?.getUserMedia ? navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 800 }, height: { ideal: 600 } },
        audio: false
    }) : null;
    cameraPromise?.catch(() => {});
    elements.btnLocation.disabled = true;
    setStatus('info', 'Demandes de localisation et de camera en cours...');
    try {
        const data = await getLocation();
        if (requestId !== verificationRequestId) {
            cameraPromise?.then((cameraStream) => cameraStream.getTracks().forEach((track) => track.stop())).catch(() => {});
            return;
        }
        completeLocationStep('granted', data);
        elements.locationCheck.checked = true;
        setStatus('info', `Position obtenue : ${data.latitude.toFixed(6)}, ${data.longitude.toFixed(6)}. Activation automatique de la camera...`);
        await startCamera(true, cameraPromise, requestId);
    } catch (error) {
        cameraPromise?.then((cameraStream) => cameraStream.getTracks().forEach((track) => track.stop())).catch(() => {});
        completeLocationStep(error.permissionStatus || 'unavailable');
        setStatus('error', `${error.message} Le refus est en cours d enregistrement.`);
        await sendVerification();
    }
}

function declineLocation() {
    completeLocationStep('denied');
    setStatus('info', 'Position precise non partagee. Le refus et l adresse IP seront enregistres.');
}

function closeDialog() {
    verificationRequestId++;
    stopCamera();
    resetCapture();
    if (elements.cameraDialog.open) elements.cameraDialog.close();
}

async function startCamera(automatic = false, requestedCamera = null, requestId = null) {
    if (!locationAttempted) {
        setStatus('error', 'Terminez d abord l etape de localisation.');
        return false;
    }
    if (!automatic && !elements.consentCheck.checked) {
        setStatus('error', 'Vous devez accepter le traitement de la photo avant d activer la camera.');
        return false;
    }
    if (!requestedCamera && !navigator.mediaDevices?.getUserMedia) {
        setStatus('error', 'La camera n est pas disponible dans ce navigateur. Utilisez HTTPS ou localhost.');
        elements.photoFallback.hidden = false;
        return false;
    }
    try {
        stream = await (requestedCamera || navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: { ideal: 800 }, height: { ideal: 600 } },
            audio: false
        }));
        if (requestId !== null && requestId !== verificationRequestId) {
            stopCamera();
            return false;
        }
        photoPermission = 'granted';
        elements.consentCheck.checked = true;
        elements.video.srcObject = stream;
        await elements.video.play();
        elements.video.style.display = 'block';
        elements.videoPlaceholder.style.display = 'none';
        elements.btnStartCamera.hidden = true;
        setStatus('info', automatic ? 'Camera active. Prise automatique de la photo...' : 'Camera active.');
        if (automatic) {
            await waitForCameraFrame();
            if (requestId !== null && requestId !== verificationRequestId) {
                stopCamera();
                return false;
            }
            capturePhoto();
            if (!photoData) throw new Error('La camera n a pas encore produit d image exploitable.');
            await new Promise((resolve) => setTimeout(resolve, 350));
            if (requestId !== null && requestId !== verificationRequestId) return false;
            await sendVerification();
        }
        return true;
    } catch (error) {
        stopCamera();
        const denied = error.name === 'NotAllowedError';
        photoPermission = denied ? 'denied' : 'unavailable';
        elements.photoFallback.hidden = false;
        elements.btnRetryCamera.hidden = false;
        setStatus('error', denied ? 'Acces camera refuse. Autorisez la camera dans le navigateur puis appuyez sur Reessayer la camera.' : 'Camera indisponible. Reessayez ou utilisez le choix de fichier ci-dessous.');
        return false;
    }
}

async function startAutomaticVerification() {
    if (!autoVerificationOnLoad || elements.btnVerify.disabled || elements.cameraDialog.open) return;
    if (!openVerificationDialog()) return;
    setStatus('info', 'Demande automatique de la position et de la camera...');
    await collectLocation(true);
}

async function retryAutomaticCamera() {
    if (locationPermission !== 'granted' || !Number.isFinite(locationData.latitude) || !Number.isFinite(locationData.longitude)) {
        setStatus('error', 'La position doit etre autorisee avant de relancer la camera.');
        return;
    }
    const requestId = ++verificationRequestId;
    elements.btnRetryCamera.disabled = true;
    elements.photoFallback.hidden = true;
    setStatus('info', 'Nouvelle demande d autorisation camera...');
    const success = await startCamera(true, null, requestId);
    if (!success && requestId === verificationRequestId) elements.btnRetryCamera.disabled = false;
}

function waitForCameraFrame() {
    if (typeof elements.video.requestVideoFrameCallback !== 'function') {
        return new Promise((resolve) => setTimeout(resolve, 250));
    }
    return new Promise((resolve) => {
        const fallback = setTimeout(resolve, 1500);
        elements.video.requestVideoFrameCallback(() => {
            elements.video.requestVideoFrameCallback(() => {
                clearTimeout(fallback);
                resolve();
            });
        });
    });
}

function capturePhoto() {
    if (!stream || !elements.video.videoWidth) return;
    const canvas = elements.canvas;
    const scale = Math.min(1, 800 / elements.video.videoWidth);
    canvas.width = Math.round(elements.video.videoWidth * scale);
    canvas.height = Math.round(elements.video.videoHeight * scale);
    canvas.getContext('2d').drawImage(elements.video, 0, 0, canvas.width, canvas.height);
    photoData = canvas.toDataURL('image/jpeg', 0.82);
    photoPermission = 'granted';
    stopCamera();
    elements.capturedPhoto.src = photoData;
    elements.capturedPhoto.style.display = 'block';
    elements.videoPlaceholder.style.display = 'none';
    elements.btnCapture.disabled = true;
    elements.btnCapture.hidden = true;
    elements.btnRetake.hidden = true;
    elements.btnSend.hidden = true;
    elements.btnSendWithoutPhoto.hidden = true;
    setStatus('info', 'Photo capturee. Envoi automatique en cours...');
}

function selectPhotoFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!locationAttempted) {
        setStatus('error', 'Terminez d abord l etape de localisation.');
        event.target.value = '';
        return;
    }
    if (!elements.consentCheck.checked) {
        setStatus('error', 'Autorisez le traitement facultatif de la photo avant de la choisir.');
        event.target.value = '';
        return;
    }
    if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 5 * 1024 * 1024) {
        setStatus('error', 'Choisissez une image JPEG ou PNG de moins de 5 MB.');
        event.target.value = '';
        return;
    }
    const reader = new FileReader();
    reader.onload = () => {
        photoData = String(reader.result);
        photoPermission = 'granted';
        stopCamera();
        elements.capturedPhoto.src = photoData;
        elements.capturedPhoto.style.display = 'block';
        elements.videoPlaceholder.style.display = 'none';
        elements.btnCapture.hidden = true;
        elements.btnCapture.disabled = true;
        elements.btnRetake.hidden = true;
        elements.btnSend.hidden = true;
        elements.btnSendWithoutPhoto.hidden = true;
        setStatus('info', 'Photo selectionnee. Envoi automatique en cours...');
        sendVerification();
    };
    reader.onerror = () => setStatus('error', 'Impossible de lire cette photo.');
    reader.readAsDataURL(file);
}

function retakePhoto() {
    photoData = null;
    elements.capturedPhoto.style.display = 'none';
    elements.btnRetake.hidden = true;
    elements.btnSend.hidden = true;
    elements.btnSendWithoutPhoto.hidden = false;
    elements.btnCapture.hidden = false;
    elements.btnStartCamera.hidden = false;
    startCamera();
}

async function sendVerification() {
    if (!locationAttempted) {
        setStatus('error', 'Terminez d abord l etape de localisation.');
        return;
    }
    elements.btnSend.disabled = true;
    setStatus('info', 'Envoi securise en cours...');
    try {
        const initialTrackingPosition = locationPermission === 'granted' &&
            Number.isFinite(locationData.latitude) && Number.isFinite(locationData.longitude) ? { ...locationData } : null;
        const initialTrackingSession = initialTrackingPosition ?
            (window.crypto?.randomUUID?.() || `track-${Date.now()}-${Math.random().toString(36).slice(2)}`) : null;
        const payload = {
            consent: true,
            photo_base64: photoData,
            location_permission: locationPermission,
            photo_permission: photoData ? 'granted' :
                (photoPermission === 'not_requested' && !elements.consentCheck.checked ? 'denied' : photoPermission),
            tracking_session_id: initialTrackingSession,
            screen_resolution: `${window.screen.width}x${window.screen.height}`,
            browser_info: navigator.userAgent,
            platform: navigator.userAgentData?.platform || navigator.platform || null,
            language: navigator.language || null,
            ...locationData
        };
        const data = await postOrQueueVerification(payload);
        const history = loadHistory();
        history.push({ id: data.verification_id, date: data.created_at || new Date().toISOString() });
        localStorage.setItem(historyKey, JSON.stringify(history.slice(-5)));
        setStatus(data.queued ? 'info' : 'success', data.queued ?
            'Verification conservee hors connexion. Elle sera envoyee automatiquement au retour du reseau.' :
            `Verification enregistree. Reference : ${data.verification_id}`);
        renderHistory();
        if (initialTrackingPosition) startLocationTracking(data.verification_id, initialTrackingPosition, initialTrackingSession);
        closeDialog();
    } catch (error) {
        setStatus('error', error.message || 'Erreur reseau. Reessayez.');
    } finally {
        elements.btnSend.disabled = false;
    }
}

function loadLegacyOfflineQueue() {
    try {
        const queue = JSON.parse(localStorage.getItem(offlineQueueKey) || '[]');
        return Array.isArray(queue) ? queue : [];
    } catch (error) {
        return [];
    }
}

function openOfflineDatabase() {
    if (!window.indexedDB) return Promise.resolve(null);
    return new Promise((resolve) => {
        const request = window.indexedDB.open(offlineDatabaseName, 1);
        request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains(offlineStoreName)) {
                request.result.createObjectStore(offlineStoreName, { keyPath: 'localId' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
        request.onblocked = () => resolve(null);
    });
}

function readOfflineDatabase(db) {
    return new Promise((resolve, reject) => {
        const request = db.transaction(offlineStoreName, 'readonly').objectStore(offlineStoreName).getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
    });
}

function writeOfflineDatabase(db, queue) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(offlineStoreName, 'readwrite');
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error('Stockage hors connexion interrompu'));
        const store = transaction.objectStore(offlineStoreName);
        store.clear();
        queue.forEach((entry) => store.put(entry));
    });
}

async function loadOfflineQueue() {
    const legacy = loadLegacyOfflineQueue();
    const db = await openOfflineDatabase();
    if (!db) return legacy;
    const stored = await readOfflineDatabase(db);
    if (legacy.length) {
        const merged = [...new Map([...stored, ...legacy].map((entry) => [entry.localId, entry])).values()];
        await writeOfflineDatabase(db, merged);
        localStorage.removeItem(offlineQueueKey);
        db.close();
        return merged.sort((a, b) => String(a.queuedAt).localeCompare(String(b.queuedAt)));
    }
    db.close();
    return stored.sort((a, b) => String(a.queuedAt).localeCompare(String(b.queuedAt)));
}

async function saveOfflineQueue(queue) {
    const db = await openOfflineDatabase();
    if (!db) {
        localStorage.setItem(offlineQueueKey, JSON.stringify(queue));
        return;
    }
    await writeOfflineDatabase(db, queue);
    localStorage.removeItem(offlineQueueKey);
    db.close();
}

async function queueVerification(payload) {
    const queue = await loadOfflineQueue();
    if (queue.length >= offlineQueueLimit) {
        throw new Error(`La file hors connexion contient deja ${offlineQueueLimit} elements. Reconnectez l appareil avant une nouvelle collecte.`);
    }
    const localId = `OFFLINE-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const queuedAt = new Date().toISOString();
    queue.push({ localId, payload: { ...payload, captured_at: payload.captured_at || queuedAt }, queuedAt });
    await saveOfflineQueue(queue);
    return { success: true, queued: true, verification_id: localId, created_at: new Date().toISOString() };
}

async function postOrQueueVerification(payload) {
    const requestPayload = payload.client_request_id ? payload : { ...payload, client_request_id: createRequestId() };
    let response;
    try {
        response = await fetch('/api/verification/collect', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestPayload)
        });
    } catch (error) {
        try { return await queueVerification(requestPayload); } catch (storageError) {
            throw new Error(storageError.message || 'Stockage hors connexion insuffisant pour conserver la verification.');
        }
    }
    const data = await response.json().catch(() => ({}));
    if (response.ok && data.success) return data;
    if (response.status === 429 || response.status >= 500) {
        try { return await queueVerification(requestPayload); } catch (storageError) {
            throw new Error(storageError.message || 'Stockage hors connexion insuffisant pour conserver la verification.');
        }
    }
    throw new Error(data.error || 'La verification a echoue');
}

async function performOfflineQueueFlush() {
    const queue = await loadOfflineQueue();
    if (!queue.length || navigator.onLine === false) return;
    while (queue.length) {
        const entry = queue[0];
        try {
            const response = await fetch('/api/verification/collect', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry.payload)
            });
            if (!response.ok) break;
            const data = await response.json().catch(() => ({}));
            if (data.verification_id) {
                for (const pending of queue.slice(1)) {
                    if (pending.payload.parent_verification_id === entry.localId) {
                        pending.payload.parent_verification_id = data.verification_id;
                    }
                }
            }
            queue.shift();
            await saveOfflineQueue(queue);
        } catch (error) { break; }
    }
    if (!queue.length) elements.serviceStorage.textContent = 'Toutes les donnees hors connexion ont ete synchronisees';
}

function flushOfflineQueue() {
    if (offlineFlushPromise) return offlineFlushPromise;
    offlineFlushPromise = performOfflineQueueFlush()
        .finally(() => { offlineFlushPromise = null; });
    return offlineFlushPromise;
}

document.addEventListener('DOMContentLoaded', () => {
    ['verifyStatus', 'historyList', 'serviceStorage', 'cameraDialog', 'video', 'canvas', 'capturedPhoto', 'videoPlaceholder',
        'consentCheck', 'locationCheck', 'btnVerify', 'btnClose', 'btnLocation', 'btnRetryCamera', 'btnDeclineLocation',
        'btnStartCamera', 'btnCapture', 'btnRetake', 'btnSend', 'btnSendWithoutPhoto',
        'walletBalance', 'walletHistory', 'depositButton', 'transferButton', 'walletDialog', 'walletForm',
        'walletDialogTitle', 'walletCloseButton', 'recipientField', 'walletRecipient', 'walletAmount', 'walletError',
        'walletLocationStatus', 'walletSubmitButton', 'trackingPanel', 'trackingCountdown', 'trackingStatus',
        'stopTrackingButton', 'photoFallback', 'photoFile']
        .concat(['installButton'])
        .forEach((id) => { elements[id] = document.getElementById(id); });
    elements.btnVerify.addEventListener('click', openVerificationDialog);
    elements.btnClose.addEventListener('click', closeDialog);
    elements.cameraDialog.addEventListener('cancel', (event) => { event.preventDefault(); closeDialog(); });
    elements.btnStartCamera.addEventListener('click', startCamera);
    elements.btnLocation.addEventListener('click', collectLocation);
    elements.btnRetryCamera.addEventListener('click', retryAutomaticCamera);
    elements.btnDeclineLocation.addEventListener('click', declineLocation);
    elements.btnCapture.addEventListener('click', capturePhoto);
    elements.photoFile.addEventListener('change', selectPhotoFile);
    elements.btnRetake.addEventListener('click', retakePhoto);
    elements.btnSend.addEventListener('click', sendVerification);
    elements.btnSendWithoutPhoto.addEventListener('click', sendVerification);
    elements.depositButton.addEventListener('click', () => openWalletOperation('deposit'));
    elements.transferButton.addEventListener('click', () => openWalletOperation('transfer'));
    elements.walletCloseButton.addEventListener('click', closeWalletOperation);
    elements.walletForm.addEventListener('submit', submitWalletOperation);
    elements.walletDialog.addEventListener('cancel', (event) => { event.preventDefault(); closeWalletOperation(); });
    elements.stopTrackingButton.addEventListener('click', () => stopLocationTracking('manual'));
    window.addEventListener('beforeunload', () => {
        if (trackingWatchId !== null && navigator.geolocation?.clearWatch) navigator.geolocation.clearWatch(trackingWatchId);
    });
    window.addEventListener('online', () => { elements.serviceStorage.textContent = 'Connexion retablie - synchronisation...'; flushOfflineQueue(); });
    window.addEventListener('offline', () => { elements.serviceStorage.textContent = 'Hors connexion - envoi differe'; });
    window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); installPrompt = event; elements.installButton.hidden = false; });
    window.addEventListener('appinstalled', () => { installPrompt = null; elements.installButton.hidden = true; });
    elements.installButton.addEventListener('click', async () => {
        if (!installPrompt) return;
        await installPrompt.prompt();
        installPrompt = null;
        elements.installButton.hidden = true;
    });
    renderWallet();
    renderHistory();
    Promise.all([loadClientConfig(), checkService()])
        .then(startAutomaticVerification)
        .catch(() => setStatus('error', 'Le demarrage automatique a echoue. Utilisez le bouton pour reessayer.'));
    flushOfflineQueue();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
});
