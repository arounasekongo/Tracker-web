const { rateLimit } = require('express-rate-limit');

function limiter(windowMs, max, error) {
    return rateLimit({
        windowMs,
        limit: max,
        message: { success: false, error },
        standardHeaders: 'draft-7',
        legacyHeaders: false
    });
}

function positiveInteger(name, fallback) {
    const value = Number.parseInt(process.env[name], 10);
    return Number.isInteger(value) && value > 0 ? value : fallback;
}

module.exports = {
    verification: limiter(
        positiveInteger('LOCATION_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
        positiveInteger('LOCATION_RATE_LIMIT_MAX', 100),
        'Trop de demandes de localisation. Reessayez plus tard.'
    ),
    status: limiter(15 * 60 * 1000, 60, 'Trop de consultations. Reessayez plus tard.'),
    login: limiter(15 * 60 * 1000, 10, 'Trop de tentatives de connexion. Reessayez dans 15 minutes.'),
    admin: limiter(60 * 60 * 1000, 500, 'Trop de requetes admin. Reessayez plus tard.'),
    export: limiter(60 * 60 * 1000, 20, 'Trop d exports. Reessayez dans une heure.')
};
