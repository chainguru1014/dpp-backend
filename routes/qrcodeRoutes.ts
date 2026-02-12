const express = require('express');
const router = express.Router();
const QRcodeController = require('../controllers/qrcodeController');

// Protect all routes after this middleware
// router.use(authController.protect);

router.get('/', QRcodeController.getAllQRcodes);
router.post('/product', QRcodeController.getQRcodesWithProductId);
router.post('/decrypt', QRcodeController.decrypt);
router.post('/serialdata/productinfo',QRcodeController.getProductInfoWithSerial);
router.post('/serials',QRcodeController.getSerials)
router.get('/:id', QRcodeController.getQRcode);
router.post('/', QRcodeController.addQRcode);
router.put('/:id', QRcodeController.updateQRcode);
router.delete('/:id', QRcodeController.deleteQRcode);
router.get('/:id/productinfo', QRcodeController.getProductInfoWithQRCodeID);



module.exports = router;