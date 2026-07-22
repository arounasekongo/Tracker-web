'use strict';

let currentPage = 0;
const pageSize = 50;
let totalPages = 1;
let searchTimer;
let refreshTimer;
let eventStream;
let realtimeRefreshTimer;
const eventLabels = {
    identity_verification: 'Verification d identite', wallet_deposit: 'Depot simule', wallet_transfer: 'Transfert simule',
    wallet_deposit_intent: 'Ouverture depot', wallet_transfer_intent: 'Ouverture transfert',
    location_tracking_update: 'Position de suivi'
};

const byId = (id) => document.getElementById(id);

function showLogin() {
    clearInterval(refreshTimer);
    eventStream?.close();
    eventStream = null;
    byId('loginPage').style.display = 'flex';
    byId('dashboardPage').style.display = 'none';
}

function showDashboard(username) {
    byId('loginPage').style.display = 'none';
    byId('dashboardPage').style.display = 'block';
    byId('adminUser').textContent = username || 'Admin';
    clearInterval(refreshTimer);
    refreshTimer = setInterval(() => Promise.all([loadData(), loadStats()]), 10000);
    startRealtime();
}

function startRealtime() {
    if (typeof EventSource === 'undefined' || eventStream) return;
    eventStream = new EventSource('/api/admin/events');
    eventStream.addEventListener('verification', () => {
        clearTimeout(realtimeRefreshTimer);
        realtimeRefreshTimer = setTimeout(() => Promise.all([loadData(), loadStats()]), 250);
    });
    eventStream.onerror = () => { byId('realtimeStatus').textContent = 'Reconnexion...'; };
    eventStream.onopen = () => { byId('realtimeStatus').textContent = 'Temps reel actif'; loadStorageStatus(); };
}

async function apiFetch(url, options) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) { showLogin(); throw new Error('Session expiree'); }
    if (!response.ok || data.success === false) throw new Error(data.error || 'Erreur serveur');
    return data;
}

async function loadStorageStatus() {
    try {
        const response = await fetch('/health', { cache: 'no-store' });
        const health = await response.json();
        byId('storageStatus').textContent = health.persistent ? 'PostgreSQL' : 'Base temporaire';
    } catch (error) {
        byId('storageStatus').textContent = 'Stockage indisponible';
    }
}

async function login(event) {
    event.preventDefault();
    const errorBox = byId('loginError');
    errorBox.style.display = 'none';
    try {
        const data = await apiFetch('/api/admin/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: byId('username').value.trim(), password: byId('password').value })
        });
        showDashboard(data.admin.username);
        await Promise.all([loadData(), loadStats()]);
    } catch (error) {
        errorBox.textContent = error.message;
        errorBox.style.display = 'block';
    }
}

async function logout() {
    try { await apiFetch('/api/admin/logout', { method: 'POST' }); } catch (error) { /* Always clear the local UI. */ }
    byId('password').value = '';
    if (byId('detailDialog').open) byId('detailDialog').close();
    showLogin();
}

function filterParams() {
    const params = new URLSearchParams();
    [['status', 'filterStatus'], ['startDate', 'filterStart'], ['endDate', 'filterEnd']]
        .forEach(([key, id]) => { const value = byId(id).value; if (value) params.set(key, value); });
    return params;
}

async function loadData() {
    const params = filterParams();
    params.set('limit', pageSize);
    params.set('offset', currentPage * pageSize);
    try {
        const data = await apiFetch(`/api/admin/verifications?${params}`);
        totalPages = data.pagination.totalPages;
        if (currentPage >= totalPages) { currentPage = Math.max(0, totalPages - 1); return loadData(); }
        renderTable(data.data);
        updatePagination(data.pagination);
    } catch (error) {
        renderMessage(error.message, 'text-danger');
    }
}

async function loadStats() {
    try {
        const data = await apiFetch('/api/admin/stats');
        const stats = data.data.overview;
        byId('statTotal').textContent = stats.total || 0;
        byId('statSuccess').textContent = stats.success || 0;
        byId('statLocation').textContent = stats.with_location || 0;
        byId('statPhoto').textContent = stats.with_photo || 0;
    } catch (error) { /* loadData reports visible errors. */ }
}

function renderMessage(message, className = 'text-muted') {
    const cell = document.createElement('td');
    cell.colSpan = 9;
    cell.className = `text-center ${className}`;
    cell.textContent = message;
    const row = document.createElement('tr');
    row.append(cell);
    byId('verificationsTable').replaceChildren(row);
}

function appendCell(row, value) {
    const cell = document.createElement('td');
    cell.textContent = value ?? '';
    row.append(cell);
    return cell;
}

function renderTable(rows) {
    const tbody = byId('verificationsTable');
    if (!rows?.length) { renderMessage('Aucune donnee'); return; }
    const fragment = document.createDocumentFragment();
    rows.forEach((item) => {
        const row = document.createElement('tr');
        appendCell(row, item.verification_id).className = 'font-monospace';
        appendCell(row, eventLabels[item.event_type] || 'Verification d identite');
        appendCell(row, new Date(item.created_at).toLocaleString('fr-FR'));
        appendCell(row, item.ip_address || 'Non disponible');
        const latitude = Number(item.latitude);
        const longitude = Number(item.longitude);
        appendCell(row, Number.isFinite(latitude) && Number.isFinite(longitude) ? `${latitude.toFixed(6)}, ${longitude.toFixed(6)}` :
            item.location_permission === 'denied' ? 'Permission refusee' : 'Non disponible');
        appendCell(row, item.browser_info ? String(item.browser_info).slice(0, 35) : 'Non disponible');
        appendCell(row, item.has_photo ? 'Oui' : item.photo_permission === 'denied' ? 'Permission refusee' : 'Non');
        const statusCell = appendCell(row, '');
        const statusBadge = document.createElement('span');
        statusBadge.className = `badge-status ${item.status === 'success' ? 'badge-success' : item.status === 'failed' ? 'badge-danger' : 'badge-warning'}`;
        statusBadge.textContent = item.status;
        statusCell.append(statusBadge);
        const actions = appendCell(row, '');
        const view = document.createElement('button');
        view.type = 'button'; view.className = 'btn btn-sm btn-info'; view.textContent = 'Voir';
        view.addEventListener('click', () => viewVerification(item.verification_id));
        const remove = document.createElement('button');
        remove.type = 'button'; remove.className = 'btn btn-sm btn-danger'; remove.textContent = 'Supprimer';
        remove.addEventListener('click', () => deleteVerification(item.id));
        actions.append(view, remove);
        fragment.append(row);
    });
    tbody.replaceChildren(fragment);
}

function updatePagination(pagination) {
    byId('paginationInfo').textContent = `Page ${pagination.currentPage} sur ${pagination.totalPages} - ${pagination.total} resultat(s)`;
    byId('currentPageDisplay').textContent = pagination.currentPage;
    byId('prevPageButton').disabled = currentPage === 0;
    byId('nextPageButton').disabled = currentPage + 1 >= totalPages;
}

async function deleteVerification(id) {
    if (!window.confirm('Supprimer definitivement cette verification ?')) return;
    try { await apiFetch(`/api/admin/verification/${encodeURIComponent(id)}`, { method: 'DELETE' }); await Promise.all([loadData(), loadStats()]); }
    catch (error) { window.alert(error.message); }
}

async function deleteAll() {
    if (!window.confirm('Supprimer definitivement toutes les verifications ?')) return;
    try { await apiFetch('/api/admin/verifications/all', { method: 'DELETE' }); currentPage = 0; await Promise.all([loadData(), loadStats()]); }
    catch (error) { window.alert(error.message); }
}

function exportData(format) {
    window.location.assign(`/api/admin/export/${format}?${filterParams()}`);
}

async function searchVerifications() {
    const query = byId('searchInput').value.trim();
    if (!query) return loadData();
    if (query.length < 2) return;
    try {
        const data = await apiFetch(`/api/admin/verifications/search?q=${encodeURIComponent(query)}`);
        renderTable(data.data);
        byId('paginationInfo').textContent = `${data.count} resultat(s)`;
    } catch (error) { renderMessage(error.message, 'text-danger'); }
}

async function viewVerification(id) {
    try {
        const { data } = await apiFetch(`/api/admin/verification/${encodeURIComponent(id)}`);
        const latitude = Number(data.latitude);
        const longitude = Number(data.longitude);
        const hasLocation = Number.isFinite(latitude) && Number.isFinite(longitude);
        byId('detailId').textContent = data.verification_id;
        byId('detailEventType').textContent = eventLabels[data.event_type] || 'Verification d identite';
        byId('detailTrackingSession').textContent = data.tracking_session_id || 'Non applicable';
        byId('detailParentVerification').textContent = data.parent_verification_id || 'Non applicable';
        byId('detailDate').textContent = new Date(data.created_at).toLocaleString('fr-FR');
        byId('detailIp').textContent = data.ip_address || 'Non disponible';
        byId('detailLocation').textContent = hasLocation ? `${latitude.toFixed(6)}, ${longitude.toFixed(6)}` : 'Non disponible';
        byId('detailMapLink').hidden = !hasLocation;
        if (hasLocation) byId('detailMapLink').href = `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=18/${latitude}/${longitude}`;
        byId('detailAccuracy').textContent = data.accuracy === null || data.accuracy === undefined ? 'Non disponible' : `${data.accuracy} m`;
        const permissionLabels = { granted: 'Accordee', denied: 'Refusee', unavailable: 'Indisponible', not_requested: 'Non demandee' };
        byId('detailLocationPermission').textContent = permissionLabels[data.location_permission] || 'Non renseignee';
        byId('detailPhotoPermission').textContent = permissionLabels[data.photo_permission] || 'Non renseignee';
        byId('detailStatus').textContent = data.status;
        byId('detailPhotoSection').hidden = !data.has_photo;
        if (data.has_photo) byId('detailPhoto').src = `/api/admin/verification/${encodeURIComponent(id)}/photo`;
        else byId('detailPhoto').removeAttribute('src');
        byId('detailDialog').showModal();
    } catch (error) { window.alert(error.message); }
}

document.addEventListener('DOMContentLoaded', async () => {
    byId('loginForm').addEventListener('submit', login);
    byId('logoutButton').addEventListener('click', logout);
    ['filterStatus', 'filterStart', 'filterEnd'].forEach((id) => byId(id).addEventListener('change', () => { currentPage = 0; loadData(); }));
    byId('prevPageButton').addEventListener('click', () => { if (currentPage > 0) { currentPage--; loadData(); } });
    byId('nextPageButton').addEventListener('click', () => { if (currentPage + 1 < totalPages) { currentPage++; loadData(); } });
    byId('exportCsvButton').addEventListener('click', () => exportData('csv'));
    byId('exportJsonButton').addEventListener('click', () => exportData('json'));
    byId('deleteAllButton').addEventListener('click', deleteAll);
    byId('closeDetailButton').addEventListener('click', () => byId('detailDialog').close());
    byId('searchInput').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(searchVerifications, 250); });
    await loadStorageStatus();
    try {
        const data = await apiFetch('/api/admin/status');
        if (data.authenticated) { showDashboard(data.admin.username); await Promise.all([loadData(), loadStats()]); } else showLogin();
    } catch (error) { showLogin(); }
});
