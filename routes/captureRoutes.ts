const express = require('express');
const router = express.Router();
const CaptureController = require('../controllers/captureController');
const { protect, restrictTo } = require('../middleware/authMiddleware');

// Corporate scan-capture audit trail — mobile app employee sessions only.
router.get('/', protect, restrictTo('Employee'), CaptureController.list);
router.post('/', protect, restrictTo('Employee'), CaptureController.create);
router.patch('/:id/flag', protect, restrictTo('Employee'), CaptureController.toggleFlag);

module.exports = router;
