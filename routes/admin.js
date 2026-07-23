const express = require('express');
const AdminController = require('../controllers/adminController');
const VerificationController = require('../controllers/verificationController');
const auth = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');
const realtime = require('../services/realtime');

const router = express.Router();
router.use(auth.isAuthenticated, rateLimit.admin);
router.post('/password', auth.changePassword);
router.get('/events', realtime.subscribe);
router.get('/verifications', AdminController.listVerifications);
router.get('/verifications/search', VerificationController.search);
router.get('/verification/:id', VerificationController.getVerification);
router.get('/verification/:id/track', VerificationController.getTrack);
router.get('/verification/:id/photo', AdminController.getVerificationPhoto);
router.get('/stats', VerificationController.getStats);
router.get('/stats/advanced', AdminController.advancedStats);
router.get('/operations', AdminController.operations);
router.get('/audit', AdminController.auditLogs);
router.get('/retention', AdminController.retentionStatus);
router.post('/retention/run', AdminController.runRetention);
router.delete('/verification/:id', AdminController.deleteVerification);
router.delete('/verifications/all', AdminController.deleteAllVerifications);
router.get('/export/csv', rateLimit.export, AdminController.exportCSV);
router.get('/export/json', rateLimit.export, AdminController.exportJSON);

module.exports = router;
