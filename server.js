require('dotenv').config({ quiet: true });
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
const pool = require('./database/db');
const PgSession = require('connect-pg-simple')(session);
const Auth = require('./middleware/auth');
const rateLimit = require('./middleware/rateLimit');
const verificationRoutes = require('./routes/verification');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';
const sessionSecret = process.env.SESSION_SECRET || 'development-only-change-this-secret';

if (isProduction && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) {
    throw new Error('SESSION_SECRET doit contenir au moins 32 caracteres en production');
}

if (process.env.TRUST_PROXY === '1' || isProduction) app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((req, res, next) => {
    res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(self)');
    next();
});

app.use(helmet({
    strictTransportSecurity: isProduction ? undefined : false,
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", 'data:'],
            styleSrc: ["'self'", "'unsafe-inline'"],
            connectSrc: ["'self'"],
            mediaSrc: ["'self'", 'blob:'],
            objectSrc: ["'none'"]
        }
    }
}));

const configuredOrigins = process.env.CORS_ORIGINS;
const allowedOrigins = (configuredOrigins || 'http://localhost:3000,http://localhost:5500')
    .split(',').map((origin) => origin.trim()).filter(Boolean);
app.use(cors({
    origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        if (!configuredOrigins && isProduction) return callback(null, false);
        return callback(new Error('Origine CORS non autorisee'));
    },
    credentials: true
}));

app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ extended: false, limit: '12mb' }));
app.use(session({
    name: 'wave.sid',
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: isProduction ? new PgSession({ pool, createTableIfMissing: true }) : undefined,
    cookie: {
        secure: isProduction,
        maxAge: 60 * 60 * 1000,
        httpOnly: true,
        sameSite: 'lax'
    }
}));

const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir, { index: false }));

app.get('/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ success: true, status: 'ok', storage: pool.isMemory() ? 'memory' : 'postgresql', persistent: !pool.isMemory() });
    } catch (error) {
        res.status(503).json({ success: false, status: 'database_unavailable' });
    }
});
app.get('/api/config', (req, res) => res.json({
    success: true,
    geolocation: {
        highAccuracy: process.env.GEOLOCATION_HIGH_ACCURACY !== 'false',
        timeoutMs: Math.min(60000, Math.max(3000, Number(process.env.GEOLOCATION_TIMEOUT_MS) || 15000)),
        maximumAgeMs: Math.min(300000, Math.max(0, Number(process.env.GEOLOCATION_MAXIMUM_AGE_MS) || 0)),
        trackingDurationMs: Math.min(3600000, Math.max(60000, Number(process.env.TRACKING_DURATION_MS) || 900000)),
        trackingMinIntervalMs: Math.min(300000, Math.max(10000, Number(process.env.TRACKING_MIN_INTERVAL_MS) || 30000)),
        trackingMinDistanceMeters: Math.min(1000, Math.max(5, Number(process.env.TRACKING_MIN_DISTANCE_METERS) || 25))
    }
}));
app.get('/', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(publicDir, 'admin.html')));

app.post('/api/admin/login', rateLimit.login, Auth.login);
app.post('/api/admin/logout', Auth.logout);
app.get('/api/admin/status', Auth.checkStatus);
app.use('/api/verification', verificationRoutes);
app.use('/api/admin', adminRoutes);

app.use('/api', (req, res) => res.status(404).json({ success: false, error: 'Route API introuvable' }));
app.use((err, req, res, next) => {
    const status = err.message === 'Origine CORS non autorisee' ? 403 :
        (Number.isInteger(err.status) && err.status >= 400 && err.status < 500 ? err.status : 500);
    if (status >= 500) console.error('Erreur:', err.message);
    const message = status === 403 ? err.message : status < 500 ? 'Requete invalide' : 'Erreur serveur interne';
    res.status(status).json({ success: false, error: message });
});

let server;
if (require.main === module) {
    server = app.listen(PORT, () => console.log(`Portefeuille Demo disponible sur http://localhost:${PORT}`));
}

async function shutdown() {
    if (server) await new Promise((resolve) => server.close(resolve));
    await pool.end();
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

module.exports = app;
