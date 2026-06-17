const express = require('express');
const router = express.Router();
const TransferController = require('../controllers/transferController');

// Static routes must come before the dynamic /:code route so they aren't swallowed.
router.post('/initiate', TransferController.initiate);
router.post('/share-email', TransferController.shareEmail);
router.post('/owner-initiate', TransferController.ownerInitiate);
router.get('/recipient', TransferController.recipient);
router.get('/my-products', TransferController.myProducts);
router.get('/owned', TransferController.ownedProducts);
router.get('/buyer-status', TransferController.buyerStatus);
router.get('/product-owner', TransferController.productOwner);
router.get('/owned-item-codes', TransferController.ownedItemCodes);
router.get('/sold', TransferController.sold);
router.get('/purchases', TransferController.purchases);
router.get('/activity', TransferController.activity);
router.get('/holding', TransferController.holding);
router.get('/available', TransferController.available);
router.get('/list', TransferController.list);
router.get('/product/:productId', TransferController.listByProduct);

router.get('/:code', TransferController.getByCode);
router.post('/:code/confirm', TransferController.confirm);
router.post('/:code/reject', TransferController.reject);
router.post('/:code/notify-owner', TransferController.notifyOwner);

module.exports = router;
