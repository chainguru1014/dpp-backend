const express = require('express');
const router = express.Router();
const ImpinjLlrpController = require('../controllers/impinjLlrpController');

// Same no-auth stance as /impinj and /impinj-rest — a same-origin relay
// to the reader, not a new trust boundary. Mounted separately
// (/impinj-llrp) so it can be tested side-by-side without touching the
// existing .NET-SDK-backed /impinj routes or the /impinj-rest attempt.
router.get('/status', ImpinjLlrpController.status);
router.post('/connect', ImpinjLlrpController.connect);
router.post('/disconnect', ImpinjLlrpController.disconnect);
router.post('/start', ImpinjLlrpController.start);
router.post('/stop', ImpinjLlrpController.stop);
router.get('/tags', ImpinjLlrpController.tags);
router.get('/tags/recent', ImpinjLlrpController.recentTags);
router.delete('/tags', ImpinjLlrpController.clearTags);

module.exports = router;
