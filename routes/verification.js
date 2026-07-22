const express = require('express');
const VerificationController = require('../controllers/verificationController');
const rateLimit = require('../middleware/rateLimit');

const router = express.Router();
router.post('/collect', rateLimit.verification, VerificationController.collect);
router.get('/:id/status', rateLimit.status, VerificationController.getStatus);

module.exports = router;
