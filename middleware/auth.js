const pool = require('../database/db');
const bcrypt = require('bcrypt');
const AuditLog = require('../models/AuditLog');

class Auth {
    static async isAuthenticated(req, res, next) {
        if (req.session && req.session.isAdmin) {
            try {
                const result = await pool.query('SELECT id, username, role, session_version FROM admins WHERE id = $1', [req.session.adminId]);
                const admin = result.rows[0];
                if (admin && Number(admin.session_version) === Number(req.session.adminSessionVersion)) {
                    req.adminId = admin.id;
                    req.admin = admin;
                    return next();
                }
            } catch (error) {
                return res.status(503).json({ success: false, error: 'Authentification temporairement indisponible' });
            }
            req.session.destroy(() => {});
            return res.status(401).json({ success: false, error: 'Session invalidee, reconnectez-vous' });
        }
        return res.status(401).json({ success: false, error: 'Authentification requise' });
    }

    static async login(req, res) {
        try {
            const username = String(req.body?.username || '').trim();
            const password = String(req.body?.password || '');
            if (!username || !password || username.length > 50 || password.length > 200) {
                return res.status(400).json({ success: false, error: 'Identifiants invalides' });
            }
            const result = await pool.query('SELECT * FROM admins WHERE username = $1', [username]);
            const admin = result.rows[0];
            const fallbackHash = '$2b$10$C6UzMDM.H6dfI/f/IKcEe.2a6T6xD3D4lTQta7G6lK7qZ4l1/7w7K';
            const valid = await bcrypt.compare(password, admin?.password_hash || fallbackHash);
            if (!admin || !valid) {
                await AuditLog.write(null, 'login_failed', req.ip, { username });
                return res.status(401).json({ success: false, error: 'Identifiants incorrects' });
            }

            await new Promise((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));
            req.session.isAdmin = true;
            req.session.adminId = admin.id;
            req.session.adminUsername = admin.username;
            req.session.adminSessionVersion = Number(admin.session_version);
            await pool.query('UPDATE admins SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [admin.id]);
            await AuditLog.write(admin.id, 'login_success', req.ip, { username: admin.username });
            res.json({ success: true, admin: { id: admin.id, username: admin.username, role: admin.role } });
        } catch (error) {
            console.error('Erreur login:', error.message);
            res.status(500).json({ success: false, error: 'Erreur serveur' });
        }
    }

    static async logout(req, res) {
        if (!req.session) return res.json({ success: true });
        await AuditLog.write(req.session.adminId, 'logout', req.ip, { username: req.session.adminUsername });
        req.session.destroy((error) => {
            if (error) return res.status(500).json({ success: false, error: 'Erreur lors de la deconnexion' });
            res.clearCookie('wave.sid');
            res.json({ success: true });
        });
    }

    static async checkStatus(req, res) {
        try {
            if (!req.session?.isAdmin) return res.json({ success: true, authenticated: false });
            const result = await pool.query('SELECT username, role, session_version FROM admins WHERE id = $1', [req.session.adminId]);
            const admin = result.rows[0];
            if (!admin || Number(admin.session_version) !== Number(req.session.adminSessionVersion)) {
                req.session.destroy(() => {});
                return res.json({ success: true, authenticated: false });
            }
            res.json({ success: true, authenticated: true, admin: { username: admin.username, role: admin.role } });
        } catch (error) {
            res.status(503).json({ success: false, error: 'Etat de session indisponible' });
        }
    }

    static async changePassword(req, res) {
        try {
            const currentPassword = String(req.body?.current_password || '');
            const newPassword = String(req.body?.new_password || '');
            if (!currentPassword || currentPassword.length > 200 || newPassword.length < 12 || newPassword.length > 200 ||
                !/[a-z]/.test(newPassword) || !/[A-Z]/.test(newPassword) || !/\d/.test(newPassword) || !/[^A-Za-z0-9]/.test(newPassword)) {
                return res.status(400).json({
                    success: false,
                    error: 'Le nouveau mot de passe doit contenir au moins 12 caracteres, une majuscule, une minuscule, un chiffre et un symbole'
                });
            }
            if (currentPassword === newPassword) {
                return res.status(400).json({ success: false, error: 'Le nouveau mot de passe doit etre different' });
            }
            const result = await pool.query('SELECT id, username, password_hash FROM admins WHERE id = $1', [req.adminId]);
            const admin = result.rows[0];
            if (!admin || !await bcrypt.compare(currentPassword, admin.password_hash)) {
                await AuditLog.write(req.adminId, 'password_change_failed', req.ip);
                return res.status(401).json({ success: false, error: 'Mot de passe actuel incorrect' });
            }
            const passwordHash = await bcrypt.hash(newPassword, 12);
            const updated = (await pool.query(
                `UPDATE admins SET password_hash = $1, session_version = session_version + 1
                 WHERE id = $2 RETURNING session_version`,
                [passwordHash, admin.id]
            )).rows[0];
            await AuditLog.write(admin.id, 'password_changed', req.ip);
            await new Promise((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));
            req.session.isAdmin = true;
            req.session.adminId = admin.id;
            req.session.adminUsername = admin.username;
            req.session.adminSessionVersion = Number(updated.session_version);
            res.json({ success: true, message: 'Mot de passe modifie. Les autres sessions ont ete invalidees.' });
        } catch (error) {
            console.error('Erreur changement mot de passe:', error.message);
            res.status(500).json({ success: false, error: 'Modification du mot de passe impossible' });
        }
    }
}

module.exports = Auth;
