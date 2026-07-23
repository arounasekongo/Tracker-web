const pool = require('../database/db');

class AuditLog {
    static async write(adminId, action, ipAddress, details = {}) {
        try {
            await pool.query(
                `INSERT INTO audit_logs (admin_id, action, ip_address, details)
                 VALUES ($1, $2, $3, $4)`,
                [adminId || null, String(action).slice(0, 100), ipAddress || null, details]
            );
        } catch (error) {
            console.error('Journal audit indisponible:', error.message);
        }
    }

    static async list(limit = 30) {
        const safeLimit = Math.min(100, Math.max(1, Number(limit) || 30));
        const result = await pool.query(
            `SELECT audit_logs.id, audit_logs.action, audit_logs.ip_address, audit_logs.details,
                    audit_logs.created_at, admins.username
             FROM audit_logs LEFT JOIN admins ON admins.id = audit_logs.admin_id
             ORDER BY audit_logs.created_at DESC LIMIT $1`,
            [safeLimit]
        );
        return result.rows;
    }
}

module.exports = AuditLog;
