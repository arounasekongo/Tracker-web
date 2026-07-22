const pool = require('../database/db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

class Auth {
    static async isAuthenticated(req, res, next) {
        if (req.session && req.session.isAdmin) return next();
        const match = /^Bearer\s+(.+)$/i.exec(req.get('authorization') || '');
        if (match && process.env.JWT_SECRET) {
            try {
                const decoded = jwt.verify(match[1], process.env.JWT_SECRET);
                if (decoded.adminId) { req.adminId = decoded.adminId; return next(); }
            } catch (error) {
                // The same generic response is used for missing and invalid credentials.
            }
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
            if (!admin || !valid) return res.status(401).json({ success: false, error: 'Identifiants incorrects' });

            await new Promise((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));
            req.session.isAdmin = true;
            req.session.adminId = admin.id;
            req.session.adminUsername = admin.username;
            await pool.query('UPDATE admins SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [admin.id]);
            res.json({ success: true, admin: { id: admin.id, username: admin.username, role: admin.role } });
        } catch (error) {
            console.error('Erreur login:', error.message);
            res.status(500).json({ success: false, error: 'Erreur serveur' });
        }
    }

    static logout(req, res) {
        if (!req.session) return res.json({ success: true });
        req.session.destroy((error) => {
            if (error) return res.status(500).json({ success: false, error: 'Erreur lors de la deconnexion' });
            res.clearCookie('wave.sid');
            res.json({ success: true });
        });
    }

    static checkStatus(req, res) {
        const authenticated = Boolean(req.session?.isAdmin);
        res.json({
            success: true,
            authenticated,
            ...(authenticated ? { admin: { username: req.session.adminUsername, role: 'admin' } } : {})
        });
    }
}

module.exports = Auth;
