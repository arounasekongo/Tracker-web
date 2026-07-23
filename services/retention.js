const pool = require('../database/db');
const ImageProcessor = require('../utils/imageProcessor');
const AuditLog = require('../models/AuditLog');

let interval = null;
let lastRunAt = null;
let lastDeleted = 0;

function configuredDays() {
    const value = Number.parseInt(process.env.DATA_RETENTION_DAYS, 10);
    return Number.isInteger(value) && value > 0 ? Math.min(value, 3650) : 0;
}

function cutoffDate(days = configuredDays()) {
    return days ? new Date(Date.now() - days * 86400000) : null;
}

async function status() {
    const days = configuredDays();
    const cutoff = cutoffDate(days);
    let expired = 0;
    if (cutoff) {
        const result = await pool.query(
            'SELECT COUNT(*)::int AS total FROM verifications WHERE deleted_at IS NULL AND created_at < $1',
            [cutoff]
        );
        expired = result.rows[0].total;
    }
    return { enabled: days > 0, days, cutoff, expired, last_run_at: lastRunAt, last_deleted: lastDeleted };
}

async function run(context = {}) {
    const days = configuredDays();
    if (!days) return { enabled: false, deleted: 0, days };
    const cutoff = cutoffDate(days);
    const result = await pool.query(
        'DELETE FROM verifications WHERE deleted_at IS NULL AND created_at < $1 RETURNING photo_path',
        [cutoff]
    );
    await Promise.all(result.rows.filter((row) => row.photo_path).map((row) => ImageProcessor.deleteFromDisk(row.photo_path)));
    lastRunAt = new Date().toISOString();
    lastDeleted = result.rowCount;
    await AuditLog.write(context.adminId, 'retention_cleanup', context.ip, {
        reason: context.reason || 'scheduled', days, deleted: result.rowCount, cutoff: cutoff.toISOString()
    });
    return { enabled: true, deleted: result.rowCount, days, cutoff };
}

function schedule() {
    if (!configuredDays() || interval) return;
    const execute = () => run({ reason: 'scheduled' }).catch((error) => console.error('Purge automatique impossible:', error.message));
    const initial = setTimeout(execute, 15000);
    initial.unref?.();
    interval = setInterval(execute, 24 * 60 * 60 * 1000);
    interval.unref?.();
}

function stop() {
    if (interval) clearInterval(interval);
    interval = null;
}

module.exports = { configuredDays, status, run, schedule, stop };
