const express = require('express');
const router = express.Router();
const RfidController = require('../controllers/rfidController');

// No auth on either route — mirrors /pmc/lookup, which is also called from
// unauthenticated hardware/scan contexts rather than an admin session.
// `ingest` is meant to be called by a store-local reader/gateway device,
// `recent` is polled by the mobile app while RFID capture mode is active.
// Revisit with a shared gateway API key once real hardware integration
// lands (see the RFID/Albert integration notes).
router.post('/ingest', RfidController.ingest);
router.get('/recent', RfidController.recent);

module.exports = router;
