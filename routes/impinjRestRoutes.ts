const express = require('express');
const router = express.Router();
const ImpinjRestController = require('../controllers/impinjRestController');

// Same no-auth stance as /impinj (routes/impinjRoutes.ts) — this is a
// same-origin relay to the reader, not a new trust boundary of its own.
// Mounted separately (/impinj-rest) so it can be tested side-by-side with
// the existing .NET-SDK-backed /impinj routes without touching them.
router.get('/status', ImpinjRestController.status);
router.post('/connect', ImpinjRestController.connect);
router.post('/disconnect', ImpinjRestController.disconnect);
router.post('/start', ImpinjRestController.start);
router.post('/stop', ImpinjRestController.stop);
router.get('/tags', ImpinjRestController.tags);
router.get('/tags/recent', ImpinjRestController.recentTags);
router.delete('/tags', ImpinjRestController.clearTags);

module.exports = router;
