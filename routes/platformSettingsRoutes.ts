const express = require('express');
const router = express.Router();
const PlatformSettingsController = require('../controllers/platformSettingsController');
const { protect, restrictTo } = require('../middleware/authMiddleware');

// Platform-wide (not per-Company) config. GET is public — the consumer app's
// Home screen needs this before/without a signed-in session. PUT is
// super-admin only (checked in the controller).
router.get('/consumer-location-steps', PlatformSettingsController.getConsumerLocationSteps);
router.put('/consumer-location-steps', protect, restrictTo('Company'), PlatformSettingsController.updateConsumerLocationSteps);

module.exports = router;
