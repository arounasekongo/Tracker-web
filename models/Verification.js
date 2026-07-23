const crypto = require('crypto');
const pool = require('../database/db');

class Verification {
    static async create(data) {
        const verificationId = `VER-${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        const query = `INSERT INTO verifications (
            verification_id, client_request_id, ip_address, latitude, longitude, accuracy, user_agent,
            screen_resolution, browser_info, platform, language, photo_path,
            photo_base64, photo_size, location_permission, photo_permission, event_type,
            tracking_session_id, parent_verification_id, captured_at, status
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
          ON CONFLICT (client_request_id) DO NOTHING RETURNING *`;
        const values = [verificationId, data.client_request_id || null, data.ip_address, data.latitude, data.longitude, data.accuracy,
            data.user_agent, data.screen_resolution, data.browser_info, data.platform, data.language,
            data.photo_path || null, data.photo_base64 || null, data.photo_size || null,
            data.location_permission || 'not_requested', data.photo_permission || 'not_requested',
            data.event_type || 'identity_verification', data.tracking_session_id || null,
            data.parent_verification_id || null, data.captured_at || new Date(), data.status || 'pending'];
        const inserted = (await pool.query(query, values)).rows[0];
        if (inserted) return inserted;
        const existing = await this.findByClientRequestId(data.client_request_id);
        if (existing) existing._duplicate = true;
        return existing;
    }

    static async findById(id) {
        return (await pool.query('SELECT * FROM verifications WHERE id = $1 AND deleted_at IS NULL', [id])).rows[0];
    }

    static async findByVerificationId(id) {
        return (await pool.query('SELECT * FROM verifications WHERE verification_id = $1 AND deleted_at IS NULL', [id])).rows[0];
    }

    static async findByClientRequestId(id) {
        if (!id) return null;
        return (await pool.query('SELECT * FROM verifications WHERE client_request_id = $1 AND deleted_at IS NULL', [id])).rows[0] || null;
    }

    static async getTrack(verificationId) {
        const parent = await this.findByVerificationId(verificationId);
        if (!parent) return null;
        const values = [verificationId];
        let relation = '(verification_id = $1 OR parent_verification_id = $1)';
        if (parent.tracking_session_id) {
            values.push(parent.tracking_session_id);
            relation = `(verification_id = $1 OR parent_verification_id = $1 OR tracking_session_id = $2)`;
        }
        const result = await pool.query(`SELECT verification_id, event_type, latitude, longitude, accuracy,
            tracking_session_id, parent_verification_id, captured_at, created_at
            FROM verifications WHERE deleted_at IS NULL AND latitude IS NOT NULL AND longitude IS NOT NULL
            AND ${relation} ORDER BY created_at ASC LIMIT 2000`, values);
        return result.rows;
    }

    static buildFilters(options = {}) {
        let sql = '';
        const values = [];
        if (options.status) { values.push(options.status); sql += ` AND status = $${values.length}`; }
        if (options.startDate) { values.push(options.startDate); sql += ` AND created_at >= $${values.length}`; }
        if (options.endDate) { values.push(options.endDate); sql += ` AND created_at < ($${values.length}::date + INTERVAL '1 day')`; }
        return { sql, values };
    }

    static async findAll(options = {}) {
        const { sql, values } = this.buildFilters(options);
        values.push(options.limit || 100, options.offset || 0);
        const query = `SELECT * FROM verifications WHERE deleted_at IS NULL${sql}
            ORDER BY created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`;
        return (await pool.query(query, values)).rows;
    }

    static async count(options = {}) {
        const { sql, values } = this.buildFilters(options);
        const result = await pool.query(`SELECT COUNT(*)::int AS total FROM verifications WHERE deleted_at IS NULL${sql}`, values);
        return result.rows[0].total;
    }

    static async hardDelete(id) {
        return (await pool.query('DELETE FROM verifications WHERE id = $1 RETURNING *', [id])).rows[0];
    }

    static async deleteWithTrack(id) {
        const verification = await this.findById(id);
        if (!verification) return null;
        if (verification.event_type === 'location_tracking_update') {
            const result = await pool.query('DELETE FROM verifications WHERE id = $1 RETURNING *', [id]);
            return result.rows;
        }
        const result = await pool.query(
            `DELETE FROM verifications
             WHERE id = $1 OR parent_verification_id = $2
                OR ($3::text IS NOT NULL AND tracking_session_id = $3)
             RETURNING *`,
            [id, verification.verification_id, verification.tracking_session_id || null]
        );
        return result.rows;
    }

    static async getStats() {
        const query = `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'success')::int AS success,
            COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
            COUNT(*) FILTER (WHERE latitude IS NOT NULL)::int AS with_location,
            COUNT(*) FILTER (WHERE photo_path IS NOT NULL OR photo_base64 IS NOT NULL)::int AS with_photo,
            COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::int AS last_24h,
            COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::int AS last_7d
            FROM verifications WHERE deleted_at IS NULL`;
        return (await pool.query(query)).rows[0];
    }

    static async getDailyStats(days = 30) {
        const safeDays = Math.min(365, Math.max(1, Number(days) || 30));
        const cutoff = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000);
        if (pool.isMemory()) {
            const rows = (await pool.query(
                'SELECT created_at, status FROM verifications WHERE deleted_at IS NULL AND created_at > $1 ORDER BY created_at DESC',
                [cutoff]
            )).rows;
            const daily = new Map();
            for (const row of rows) {
                const date = new Date(row.created_at).toISOString().slice(0, 10);
                const item = daily.get(date) || { date, total: 0, success: 0 };
                item.total++;
                if (row.status === 'success') item.success++;
                daily.set(date, item);
            }
            return [...daily.values()];
        }
        const query = `SELECT DATE(created_at) AS date, COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'success')::int AS success
            FROM verifications WHERE deleted_at IS NULL
            AND created_at > $1
            GROUP BY DATE(created_at) ORDER BY date DESC`;
        return (await pool.query(query, [cutoff])).rows;
    }

    static async search(term) {
        const query = `SELECT * FROM verifications WHERE deleted_at IS NULL AND
            (verification_id ILIKE $1 OR ip_address ILIKE $1 OR browser_info ILIKE $1 OR user_agent ILIKE $1 OR event_type ILIKE $1)
            ORDER BY created_at DESC LIMIT 100`;
        return (await pool.query(query, [`%${term}%`])).rows;
    }
}

module.exports = Verification;
