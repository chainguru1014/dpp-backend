const express = require('express');
const router = express.Router();
const ImpinjController = require('../controllers/impinjController');

// No auth, same as /rfid — the reader-service itself is unauthenticated too
// (see /rfid-reader-service's API spec), and this is purely a same-origin
// relay to it, not a new trust boundary.
router.get('/status', ImpinjController.status);
router.post('/connect', ImpinjController.connect);
router.post('/disconnect', ImpinjController.disconnect);
router.post('/start', ImpinjController.start);
router.post('/stop', ImpinjController.stop);
router.get('/tags', ImpinjController.tags);
router.get('/tags/recent', ImpinjController.recentTags);
router.delete('/tags', ImpinjController.clearTags);

module.exports = router;
