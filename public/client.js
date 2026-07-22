'use strict';

let stream = null;
let photoData = null;
let locationData = {};
let locationPermission = 'not_requested';
let photoPermission = 'not_requested';
let locationAttempted = false;
const historyKey = 'wave_verification_history';
const walletKey = 'demo_wallet_state';
let walletMode = 'deposit';
let walletLocationData = null;
let walletIntentReference = null;
let walletRequestId = 0;
let geoOptions = { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 };
let trackingOptions = { durationMs: 900000, minIntervalMs: 30000, minDistanceMeters: 25 };
let trackingWatchId = null;
let trackingEndTimer = null;
let trackingCountdownTimer = null;
let trackingEndAt = 0;
let trackingSessionId = null;
let trackingParentReference = null;
let lastTrackedAt = 0;
let lastTrackedPosition = null;
let verificationRequestId = 0;
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

async function recordWalletIntent(mode, permission, coordinates = {}) {
    const response = await fetch('/api/verification/collect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            consent: true,
            event_type: mode === 'deposit' ? 'wallet_deposit_intent' : 'wallet_transfer_intent',
            location_permission: permission,
            photo_permission: 'not_requested',
            screen_resolution: `${window.screen.width}x${window.screen.height}`,
            browser_info: navigator.userAgent,
            platform: navigator.userAgentData?.platform || navigator.platform || null,
            language: navigator.language || null,
            ...coordinates
        })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.success) throw new Error(result.error || 'Impossible d enregistrer la demande.');
    return result;
}

async function prepareWalletLocation(mode, requestId) {
    try {
        const coordinates = await getLocation();
        const result = await recordWalletIntent(mode, 'granted', coordinates);
        if (requestId !== walletRequestId) return;
        walletLocationData = coordinates;
        walletIntentReference = result.verification_id;
        startLocationTracking(result.verification_id, coordinates);
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
    const response = await fetch('/api/verification/collect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            consent: true,
            event_type: 'location_tracking_update',
            location_permission: 'granted',
            photo_permission: 'not_requested',
            tracking_session_id: trackingSessionId,
            parent_verification_id: trackingParentReference,
            screen_resolution: `${window.screen.width}x${window.screen.height}`,
            browser_info: navigator.userAgent,
            platform: navigator.userAgentData?.platform || navigator.platform || null,
            language: navigator.language || null,
            ...coordinates
        })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.success) throw new Error(result.error || 'Enregistrement du suivi impossible.');
    return result;
}

function stopLocationTracking(reason = 'manual') {
    if (trackingWatchId !== null && navigator.geolocation?.clearWatch) navigator.geolocation.clearWatch(trackingWatchId);
    trackingWatchId = null;
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

function startLocationTracking(parentReference, initialPosition) {
    if (!navigator.geolocation?.watchPosition) return;
    if (trackingWatchId !== null) stopLocationTracking('replaced');
    trackingSessionId = window.crypto?.randomUUID?.() || `track-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
    trackingWatchId = navigator.geolocation.watchPosition(async (position) => {
        const coordinates = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy
        };
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
    }, (error) => {
        elements.trackingStatus.textContent = error.code === 1 ? 'Autorisation de localisation retiree.' : 'Position temporairement indisponible.';
        if (error.code === 1) stopLocationTracking('error');
    }, geoOptions);
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
        elements.btnVerify.disabled = true;
        elements.depositButton.disabled = true;
        elements.transferButton.disabled = true;
        elements.serviceStorage.textContent = 'Service indisponible';
        setStatus('error', 'Le service de verification est temporairement indisponible. Reessayez plus tard.');
    }
}

async function loadClientConfig() {
    try {
        const response = await fetch('/api/config', { cache: 'no-store' });
        const config = await response.json();
        if (!response.ok || !config.geolocation) return;
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
        if (!navigator.geolocation) return reject(new Error('La geolocalisation n est pas disponible dans ce navigateur.'));
        navigator.geolocation.getCurrentPosition(
            (position) => resolve({
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                accuracy: position.coords.accuracy
            }),
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

function completeLocationStep(permission, data = {}) {
    locationAttempted = true;
    locationPermission = permission;
    locationData = data;
    elements.btnLocation.hidden = true;
    elements.btnDeclineLocation.hidden = true;
    elements.btnStartCamera.disabled = false;
    elements.btnSendWithoutPhoto.hidden = true;
}

async function collectLocation() {
    if (!elements.locationCheck.checked) {
        setStatus('error', 'Cochez l autorisation de localisation.');
        return;
    }
    if (!elements.consentCheck.checked) {
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
    if (!elements.consentCheck.checked) {
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
        setStatus('error', denied ? 'Acces a la camera refuse. Vous pouvez choisir une photo ci-dessous.' : 'Impossible de capturer automatiquement la photo. Utilisez le choix de fichier ci-dessous.');
        return false;
    }
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
        const response = await fetch('/api/verification/collect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                consent: true,
                photo_base64: photoData,
                location_permission: locationPermission,
                photo_permission: photoData ? 'granted' :
                    (photoPermission === 'not_requested' && !elements.consentCheck.checked ? 'denied' : photoPermission),
                screen_resolution: `${window.screen.width}x${window.screen.height}`,
                browser_info: navigator.userAgent,
                platform: navigator.userAgentData?.platform || navigator.platform || null,
                language: navigator.language || null,
                ...locationData
            })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) throw new Error(data.error || 'La verification a echoue');
        const history = loadHistory();
        history.push({ id: data.verification_id, date: data.created_at || new Date().toISOString() });
        localStorage.setItem(historyKey, JSON.stringify(history.slice(-5)));
        setStatus('success', `Verification enregistree. Reference : ${data.verification_id}`);
        renderHistory();
        closeDialog();
    } catch (error) {
        setStatus('error', error.message || 'Erreur reseau. Reessayez.');
    } finally {
        elements.btnSend.disabled = false;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    ['verifyStatus', 'historyList', 'serviceStorage', 'cameraDialog', 'video', 'canvas', 'capturedPhoto', 'videoPlaceholder',
        'consentCheck', 'locationCheck', 'btnVerify', 'btnClose', 'btnLocation', 'btnDeclineLocation',
        'btnStartCamera', 'btnCapture', 'btnRetake', 'btnSend', 'btnSendWithoutPhoto',
        'walletBalance', 'walletHistory', 'depositButton', 'transferButton', 'walletDialog', 'walletForm',
        'walletDialogTitle', 'walletCloseButton', 'recipientField', 'walletRecipient', 'walletAmount', 'walletError',
        'walletLocationStatus', 'walletSubmitButton', 'trackingPanel', 'trackingCountdown', 'trackingStatus',
        'stopTrackingButton', 'photoFallback', 'photoFile']
        .forEach((id) => { elements[id] = document.getElementById(id); });
    elements.btnVerify.addEventListener('click', () => elements.cameraDialog.showModal());
    elements.btnClose.addEventListener('click', closeDialog);
    elements.cameraDialog.addEventListener('cancel', (event) => { event.preventDefault(); closeDialog(); });
    elements.btnStartCamera.addEventListener('click', startCamera);
    elements.btnLocation.addEventListener('click', collectLocation);
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
    renderWallet();
    renderHistory();
    loadClientConfig();
    checkService();
});
