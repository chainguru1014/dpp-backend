const express = require('express');
const router = express.Router();
const CaptureController = require('../controllers/captureController');
const { protect, restrictTo } = require('../middleware/authMiddleware');

// Corporate scan-capture audit trail — mobile app employee sessions only.
// Listing is also open to Company actors (web dashboard: own company, or every
// company for the super admin) — see CaptureController.list.
router.get('/', protect, restrictTo('Employee', 'Company'), CaptureController.list);
router.get('/count', protect, restrictTo('Employee', 'Company'), CaptureController.count);
router.post('/', protect, restrictTo('Employee'), CaptureController.create);
router.patch('/:id/flag', protect, restrictTo('Employee'), CaptureController.toggleFlag);

module.exports = router;
