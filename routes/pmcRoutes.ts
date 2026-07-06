const express = require('express');
const router = express.Router();
const PmcController = require('../controllers/pmcController');

router.post('/resolve', PmcController.resolve);
router.post('/lookup', PmcController.lookup);
router.get('/code/:code', PmcController.getByCode);
router.get('/item/:productId/:qrcodeId', PmcController.getByItem);

module.exports = router;
