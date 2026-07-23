const developmentOrigins = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://10.0.2.2:3000',
    'http://localhost:5500',
    'http://127.0.0.1:5500'
];

function parseOrigins(configuredOrigins, isProduction) {
    const source = configuredOrigins || (isProduction ? '' : developmentOrigins.join(','));
    return source.split(',').map((origin) => origin.trim()).filter(Boolean);
}

function createOriginPolicy({ configuredOrigins, isProduction }) {
    const allowedOrigins = parseOrigins(configuredOrigins, isProduction);
    return function originPolicy(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        if (!configuredOrigins && isProduction) return callback(null, false);
        return callback(new Error('Origine CORS non autorisee'));
    };
}

module.exports = { createOriginPolicy, parseOrigins };
