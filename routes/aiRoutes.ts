const express = require('express');
const router = express.Router();
const multer = require('multer');
const aiController = require('../controllers/aiController');

// Voice clips stay in memory — they are only passed on to speech-to-text.
const audioUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// AI assistant endpoints (OpenAI). Mounted at the app root so the clients can
// call POST /chat and POST /recommendations.
router.post('/chat', aiController.chat);
router.post('/chat/transcribe', audioUpload.single('audio'), aiController.transcribe);
router.post('/recommendations', aiController.recommendations);

module.exports = router;
