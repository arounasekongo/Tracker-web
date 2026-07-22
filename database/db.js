const { Pool } = require('pg');
const { newDb, DataType } = require('pg-mem');
const { randomUUID } = require('crypto');
const bcrypt = require('bcrypt');
require('dotenv').config({ quiet: true });

const isProduction = process.env.NODE_ENV === 'production';
const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
const allowMemoryFallback = !isProduction && process.env.DATABASE_FALLBACK !== 'disabled';

const postgresPool = new Pool({
    connectionString: hasDatabaseUrl ? process.env.DATABASE_URL : undefined,
    host: hasDatabaseUrl ? undefined : process.env.DB_HOST,
    port: hasDatabaseUrl ? undefined : Number(process.env.DB_PORT || 5432),
    database: hasDatabaseUrl ? undefined : process.env.DB_NAME,
    user: hasDatabaseUrl ? undefined : process.env.DB_USER,
    password: hasDatabaseUrl ? undefined : process.env.DB_PASSWORD,
    ssl: isProduction ? { rejectUnauthorized: false } : false,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 3000
});

let activePool = postgresPool;
let memoryPool = null;
let fallbackPromise = null;

const connectionErrorCodes = new Set(['28P01', '28000', '3D000', 'ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ENOTFOUND', 'ETIMEDOUT']);

async function createMemoryPool(reason) {
    const database = newDb({ autoCreateForeignKeyIndices: true });
    database.public.registerFunction({
        name: 'gen_random_uuid',
        returns: DataType.uuid,
        impure: true,
        implementation: randomUUID
    });
    const adapter = database.adapters.createPg();
    const pool = new adapter.Pool();
    await pool.query(`
        CREATE TABLE verifications (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            verification_id VARCHAR(50) UNIQUE NOT NULL,
            ip_address VARCHAR(45), latitude DECIMAL, longitude DECIMAL,
            accuracy INTEGER, user_agent TEXT, screen_resolution VARCHAR(20),
            browser_info TEXT, platform VARCHAR(100), language VARCHAR(20),
            photo_path TEXT, photo_base64 TEXT, photo_size INTEGER,
            location_permission VARCHAR(20) DEFAULT 'not_requested',
            photo_permission VARCHAR(20) DEFAULT 'not_requested',
            event_type VARCHAR(40) DEFAULT 'identity_verification',
            status VARCHAR(20) DEFAULT 'pending',
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            deleted_at TIMESTAMPTZ
        );
        CREATE TABLE admins (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            username VARCHAR(50) UNIQUE NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            role VARCHAR(20) DEFAULT 'admin',
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            last_login TIMESTAMPTZ
        );
        CREATE TABLE audit_logs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            admin_id UUID REFERENCES admins(id) ON DELETE SET NULL,
            action VARCHAR(100), ip_address VARCHAR(45), details JSONB,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );
    `);
    const username = process.env.ADMIN_USERNAME || 'admin';
    const password = process.env.ADMIN_PASSWORD || 'admin123';
    const passwordHash = await bcrypt.hash(password, 10);
    await pool.query('INSERT INTO admins (username, password_hash) VALUES ($1, $2)', [username, passwordHash]);
    console.warn(`PostgreSQL indisponible (${reason}). Base temporaire en memoire activee.`);
    return pool;
}

async function activateFallback(error) {
    if (!allowMemoryFallback || !connectionErrorCodes.has(error.code)) throw error;
    if (!fallbackPromise) fallbackPromise = createMemoryPool(error.code || error.message);
    memoryPool = await fallbackPromise;
    activePool = memoryPool;
}

const pool = {
    async query(...args) {
        try {
            return await activePool.query(...args);
        } catch (error) {
            if (activePool !== postgresPool) throw error;
            await activateFallback(error);
            return activePool.query(...args);
        }
    },
    on(event, listener) {
        postgresPool.on(event, listener);
        return this;
    },
    async end() {
        const pools = memoryPool ? [postgresPool, memoryPool] : [postgresPool];
        await Promise.allSettled(pools.map((item) => item.end()));
    },
    isMemory() {
        return activePool !== postgresPool;
    }
};

postgresPool.on('error', (error) => {
    if (!allowMemoryFallback) console.error('Erreur PostgreSQL inattendue:', error.message);
});

module.exports = pool;
