CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    verification_id VARCHAR(50) UNIQUE NOT NULL,
    ip_address VARCHAR(45),
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    accuracy INTEGER,
    user_agent TEXT,
    screen_resolution VARCHAR(20),
    browser_info TEXT,
    platform VARCHAR(100),
    language VARCHAR(20),
    photo_path TEXT,
    photo_base64 TEXT,
    photo_size INTEGER,
    location_permission VARCHAR(20) DEFAULT 'not_requested',
    photo_permission VARCHAR(20) DEFAULT 'not_requested',
    event_type VARCHAR(40) DEFAULT 'identity_verification',
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed')),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ
);

ALTER TABLE verifications ADD COLUMN IF NOT EXISTS location_permission VARCHAR(20) DEFAULT 'not_requested';
ALTER TABLE verifications ADD COLUMN IF NOT EXISTS photo_permission VARCHAR(20) DEFAULT 'not_requested';
ALTER TABLE verifications ADD COLUMN IF NOT EXISTS event_type VARCHAR(40) DEFAULT 'identity_verification';

CREATE TABLE IF NOT EXISTS admins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'admin',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id UUID REFERENCES admins(id) ON DELETE SET NULL,
    action VARCHAR(100),
    ip_address VARCHAR(45),
    details JSONB,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_verifications_created_at ON verifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_verifications_status ON verifications(status);
CREATE INDEX IF NOT EXISTS idx_verifications_ip ON verifications(ip_address);
CREATE INDEX IF NOT EXISTS idx_verifications_verification_id ON verifications(verification_id);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_verifications_updated_at ON verifications;
CREATE TRIGGER update_verifications_updated_at
    BEFORE UPDATE ON verifications
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE VIEW stats_view AS
SELECT
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE status = 'success') AS success,
    COUNT(*) FILTER (WHERE status = 'failed') AS failed,
    COUNT(*) FILTER (WHERE latitude IS NOT NULL) AS with_location,
    COUNT(*) FILTER (WHERE photo_path IS NOT NULL OR photo_base64 IS NOT NULL) AS with_photo,
    DATE(created_at) AS date
FROM verifications
WHERE deleted_at IS NULL
GROUP BY DATE(created_at)
ORDER BY date DESC;
