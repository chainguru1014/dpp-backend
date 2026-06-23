const express = require('express');
const router = express.Router();
const aiController = require('../controllers/aiController');

// AI assistant endpoints (OpenAI). Mounted at the app root so the clients can
// call POST /chat and POST /recommendations.
router.post('/chat', aiController.chat);
router.post('/recommendations', aiController.recommendations);

module.exports = router;
