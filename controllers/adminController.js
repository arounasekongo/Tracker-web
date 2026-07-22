const Verification = require('../models/Verification');
const ImageProcessor = require('../utils/imageProcessor');
const pool = require('../database/db');
const { createObjectCsvStringifier } = require('csv-writer');

function filtersFrom(query) {
    const status = query.status || null;
    if (status && !['pending', 'success', 'failed'].includes(status)) throw new Error('Statut invalide');
    const startDate = query.startDate || null;
    const endDate = query.endDate || null;
    if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error('Date de debut invalide');
    if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw new Error('Date de fin invalide');
    if (startDate && endDate && startDate > endDate) throw new Error('La date de debut doit preceder la date de fin');
    return { status, startDate, endDate };
}

function sanitize(row) {
    const { photo_base64, photo_path, ...data } = row;
    return { ...data, has_photo: Boolean(photo_base64 || photo_path) };
}

class AdminController {
    static async getVerificationPhoto(req, res) {
        try {
            const verification = await Verification.findByVerificationId(req.params.id);
            if (!verification) return res.status(404).json({ success: false, error: 'Verification non trouvee' });
            let photo = verification.photo_base64 ? ImageProcessor.decode(verification.photo_base64) : null;
            if (!photo && verification.photo_path) photo = await ImageProcessor.readFromDisk(verification.photo_path);
            if (!photo) return res.status(404).json({ success: false, error: 'Photo non disponible' });
            res.set('Cache-Control', 'private, no-store, max-age=0');
            res.type('image/jpeg').send(photo);
        } catch (error) {
            res.status(500).json({ success: false, error: 'Erreur serveur' });
        }
    }

    static async listVerifications(req, res) {
        try {
            const filters = filtersFrom(req.query);
            const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
            const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
            const [rows, total] = await Promise.all([
                Verification.findAll({ ...filters, limit, offset }),
                Verification.count(filters)
            ]);
            res.json({
                success: true,
                data: rows.map(sanitize),
                pagination: {
                    total,
                    limit,
                    offset,
                    currentPage: Math.floor(offset / limit) + 1,
                    totalPages: Math.max(1, Math.ceil(total / limit))
                }
            });
        } catch (error) {
            const badRequest = /invalide|preceder/.test(error.message);
            res.status(badRequest ? 400 : 500).json({ success: false, error: badRequest ? error.message : 'Erreur serveur' });
        }
    }

    static async deleteVerification(req, res) {
        try {
            const verification = await Verification.findById(req.params.id);
            if (!verification) return res.status(404).json({ success: false, error: 'Verification non trouvee' });
            await Verification.hardDelete(req.params.id);
            if (verification.photo_path) await ImageProcessor.deleteFromDisk(verification.photo_path);
            res.json({ success: true, message: 'Verification supprimee definitivement' });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Erreur serveur' });
        }
    }

    static async deleteAllVerifications(req, res) {
        try {
            const result = await pool.query('DELETE FROM verifications WHERE deleted_at IS NULL RETURNING photo_path');
            await Promise.all(result.rows.filter((row) => row.photo_path).map((row) => ImageProcessor.deleteFromDisk(row.photo_path)));
            res.json({ success: true, message: `${result.rowCount} verifications supprimees`, count: result.rowCount });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Erreur serveur' });
        }
    }

    static async exportCSV(req, res) {
        try {
            const rows = await Verification.findAll({ ...filtersFrom(req.query), limit: 10000, offset: 0 });
            const header = [
                ['verification_id', 'ID'], ['event_type', 'Evenement'], ['created_at', 'Date'], ['ip_address', 'IP'],
                ['latitude', 'Latitude'], ['longitude', 'Longitude'], ['accuracy', 'Precision'],
                ['browser_info', 'Navigateur'], ['screen_resolution', 'Ecran'], ['platform', 'Plateforme'],
                ['language', 'Langue'], ['status', 'Statut'], ['has_photo', 'Photo']
            ].map(([id, title]) => ({ id, title }));
            const csv = createObjectCsvStringifier({ header });
            const records = rows.map((row) => ({ ...sanitize(row), has_photo: sanitize(row).has_photo ? 'Oui' : 'Non' }));
            res.type('text/csv; charset=utf-8');
            res.attachment(`verifications_${Date.now()}.csv`);
            res.send('\uFEFF' + csv.getHeaderString() + csv.stringifyRecords(records));
        } catch (error) {
            const badRequest = /invalide|preceder/.test(error.message);
            res.status(badRequest ? 400 : 500).json({ success: false, error: badRequest ? error.message : 'Erreur serveur' });
        }
    }

    static async exportJSON(req, res) {
        try {
            const rows = await Verification.findAll({ ...filtersFrom(req.query), limit: 10000, offset: 0 });
            res.attachment(`verifications_${Date.now()}.json`);
            res.json({ exported_at: new Date().toISOString(), total: rows.length, data: rows.map(sanitize) });
        } catch (error) {
            const badRequest = /invalide|preceder/.test(error.message);
            res.status(badRequest ? 400 : 500).json({ success: false, error: badRequest ? error.message : 'Erreur serveur' });
        }
    }

    static async advancedStats(req, res) {
        try {
            if (pool.isMemory()) {
                const rows = (await pool.query(
                    'SELECT ip_address, status, created_at FROM verifications WHERE deleted_at IS NULL ORDER BY created_at DESC'
                )).rows;
                const now = Date.now();
                const prefixCounts = new Map();
                const statusCounts = new Map();
                const hourCounts = new Map();
                for (const row of rows) {
                    if (row.ip_address) {
                        const prefix = String(row.ip_address).split('.')[0];
                        prefixCounts.set(prefix, (prefixCounts.get(prefix) || 0) + 1);
                    }
                    const timestamp = new Date(row.created_at);
                    if (now - timestamp.getTime() <= 30 * 86400000) {
                        const date = timestamp.toISOString().slice(0, 10);
                        const key = `${date}|${row.status}`;
                        statusCounts.set(key, (statusCounts.get(key) || 0) + 1);
                    }
                    if (now - timestamp.getTime() <= 7 * 86400000) {
                        const hour = timestamp.getUTCHours();
                        hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
                    }
                }
                const by_ip_prefix = [...prefixCounts].map(([ip_prefix, count]) => ({ ip_prefix, count }))
                    .sort((a, b) => b.count - a.count).slice(0, 20);
                const by_status_day = [...statusCounts].map(([key, count]) => {
                    const [date, status] = key.split('|');
                    return { date, status, count };
                }).sort((a, b) => b.date.localeCompare(a.date));
                const hourly = [...hourCounts].map(([hour, count]) => ({ hour, count })).sort((a, b) => a.hour - b.hour);
                return res.json({ success: true, data: { by_ip_prefix, by_status_day, hourly } });
            }
            const [prefixes, byStatusDay, hourly] = await Promise.all([
                pool.query(`SELECT split_part(ip_address, '.', 1) AS ip_prefix, COUNT(*)::int AS count
                    FROM verifications WHERE ip_address IS NOT NULL AND deleted_at IS NULL
                    GROUP BY ip_prefix ORDER BY count DESC LIMIT 20`),
                pool.query(`SELECT DATE(created_at) AS date, status, COUNT(*)::int AS count
                    FROM verifications WHERE deleted_at IS NULL AND created_at > NOW() - INTERVAL '30 days'
                    GROUP BY DATE(created_at), status ORDER BY date DESC`),
                pool.query(`SELECT EXTRACT(HOUR FROM created_at)::int AS hour, COUNT(*)::int AS count
                    FROM verifications WHERE deleted_at IS NULL AND created_at > NOW() - INTERVAL '7 days'
                    GROUP BY hour ORDER BY hour`)
            ]);
            res.json({ success: true, data: { by_ip_prefix: prefixes.rows, by_status_day: byStatusDay.rows, hourly: hourly.rows } });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Erreur serveur' });
        }
    }
}

module.exports = AdminController;
