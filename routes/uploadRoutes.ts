const express = require('express');
const router = express.Router();
const uploadController = require('../controllers/uploadController');
const upload = require('../utils/upload');

// Protect all routes after this middleware
// router.use(authController.protect);

router.post('/single', upload.single('file'), uploadController.uploadSingle);
router.post('/multiple', upload.array('files'), uploadController.uploadMultiple);
router.post('/video', upload.videoUpload.single('file'), uploadController.uploadSingle);


module.exports = router;