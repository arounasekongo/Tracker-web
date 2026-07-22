const Verification = require('../models/Verification');
const ImageProcessor = require('../utils/imageProcessor');
const pool = require('../database/db');
const realtime = require('../services/realtime');

const numberOrNull = (value, min, max) => {
    if (value === '' || value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : NaN;
};

class VerificationController {
    static async collect(req, res) {
        try {
            const body = req.body || {};
            if (body.consent !== true) {
                return res.status(403).json({ success: false, error: 'Consentement explicite requis' });
            }

            const latitude = numberOrNull(body.latitude, -90, 90);
            const longitude = numberOrNull(body.longitude, -180, 180);
            const accuracy = numberOrNull(body.accuracy, 0, 100000);
            if ([latitude, longitude, accuracy].some(Number.isNaN)) {
                return res.status(400).json({ success: false, error: 'Coordonnees invalides' });
            }
            if ((latitude === null) !== (longitude === null)) {
                return res.status(400).json({ success: false, error: 'Latitude et longitude doivent etre fournies ensemble' });
            }
            const allowedPermissions = ['granted', 'denied', 'unavailable', 'not_requested'];
            const locationPermission = body.location_permission ||
                (latitude !== null && longitude !== null ? 'granted' : 'not_requested');
            const photoPermission = body.photo_permission || (body.photo_base64 ? 'granted' : 'not_requested');
            if (!allowedPermissions.includes(locationPermission) || !allowedPermissions.includes(photoPermission)) {
                return res.status(400).json({ success: false, error: 'Etat de permission invalide' });
            }
            if (locationPermission === 'granted' && (latitude === null || longitude === null)) {
                return res.status(400).json({ success: false, error: 'Coordonnees requises lorsque la localisation est autorisee' });
            }
            if (locationPermission !== 'granted' && (latitude !== null || longitude !== null)) {
                return res.status(400).json({ success: false, error: 'Coordonnees interdites sans permission de localisation' });
            }
            if (body.photo_base64 && photoPermission !== 'granted') {
                return res.status(400).json({ success: false, error: 'Permission photo incoherente' });
            }
            const allowedEventTypes = [
                'identity_verification', 'wallet_deposit', 'wallet_transfer',
                'wallet_deposit_intent', 'wallet_transfer_intent', 'location_tracking_update'
            ];
            const eventType = body.event_type || 'identity_verification';
            if (!allowedEventTypes.includes(eventType)) {
                return res.status(400).json({ success: false, error: 'Type d evenement invalide' });
            }
            if (['wallet_deposit', 'wallet_transfer'].includes(eventType) && locationPermission !== 'granted') {
                return res.status(400).json({ success: false, error: 'Une position autorisee est requise pour cette operation simulee' });
            }
            const trackingSessionId = body.tracking_session_id ? String(body.tracking_session_id).slice(0, 80) : null;
            const parentVerificationId = body.parent_verification_id ? String(body.parent_verification_id).slice(0, 50) : null;
            if (eventType === 'location_tracking_update' && (!trackingSessionId || !parentVerificationId || locationPermission !== 'granted')) {
                return res.status(400).json({ success: false, error: 'Session, reference et position autorisee requises pour le suivi' });
            }

            let photoBase64 = null;
            let photoPath = null;
            let photoSize = null;
            if (body.photo_base64) {
                if (!ImageProcessor.validateBase64(body.photo_base64)) {
                    return res.status(400).json({ success: false, error: 'Photo invalide ou trop volumineuse' });
                }
                const processed = await ImageProcessor.processImage(body.photo_base64);
                photoBase64 = processed.base64;
                photoSize = processed.size;
                if (process.env.PHOTO_STORAGE === 'local' && !pool.isMemory()) {
                    const saved = await ImageProcessor.saveToDisk(processed.base64);
                    photoPath = saved.relativePath;
                    photoBase64 = null;
                }
            }

            const verification = await Verification.create({
                ip_address: req.ip,
                latitude,
                longitude,
                accuracy,
                user_agent: req.get('user-agent') || null,
                screen_resolution: String(body.screen_resolution || '').slice(0, 20) || null,
                browser_info: String(body.browser_info || '').slice(0, 500) || null,
                platform: String(body.platform || '').slice(0, 100) || null,
                language: String(body.language || '').slice(0, 20) || null,
                photo_base64: photoBase64,
                photo_path: photoPath,
                photo_size: photoSize,
                location_permission: locationPermission,
                photo_permission: photoPermission,
                event_type: eventType,
                tracking_session_id: trackingSessionId,
                parent_verification_id: parentVerificationId,
                status: eventType.endsWith('_intent') && locationPermission !== 'granted' ? 'failed' : 'success'
            });

            realtime.publish('verification', {
                verification_id: verification.verification_id,
                event_type: verification.event_type,
                status: verification.status,
                created_at: verification.created_at
            });

            res.status(201).json({
                success: true,
                verification_id: verification.verification_id,
                message: 'Verification enregistree avec succes',
                status: verification.status,
                created_at: verification.created_at
            });
        } catch (error) {
            console.error('Erreur collecte:', error.message);
            const invalidImage = error.code === 'INVALID_IMAGE';
            res.status(invalidImage ? 400 : 500).json({
                success: false,
                error: invalidImage ? error.message : 'Erreur serveur lors de la collecte'
            });
        }
    }

    static async getStatus(req, res) {
        try {
            const verification = await Verification.findByVerificationId(req.params.id);
            if (!verification) return res.status(404).json({ success: false, error: 'Verification non trouvee' });
            res.json({
                success: true,
                data: {
                    verification_id: verification.verification_id,
                    status: verification.status,
                    created_at: verification.created_at
                }
            });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Erreur serveur' });
        }
    }

    static async getVerification(req, res) {
        try {
            const verification = await Verification.findByVerificationId(req.params.id);
            if (!verification) return res.status(404).json({ success: false, error: 'Verification non trouvee' });
            const { photo_base64, photo_path, ...data } = verification;
            data.has_photo = Boolean(photo_base64 || photo_path);
            res.json({ success: true, data });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Erreur serveur' });
        }
    }

    static async getStats(req, res) {
        try {
            const [overview, daily] = await Promise.all([Verification.getStats(), Verification.getDailyStats(30)]);
            res.json({ success: true, data: { overview, daily } });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Erreur serveur' });
        }
    }

    static async search(req, res) {
        try {
            const q = String(req.query.q || '').trim();
            if (q.length < 2 || q.length > 100) {
                return res.status(400).json({ success: false, error: 'La recherche doit contenir entre 2 et 100 caracteres' });
            }
            const results = await Verification.search(q);
            const data = results.map(({ photo_base64, photo_path, ...item }) => ({ ...item, has_photo: Boolean(photo_base64 || photo_path) }));
            res.json({ success: true, data, count: data.length });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Erreur serveur' });
        }
    }
}

module.exports = VerificationController;
