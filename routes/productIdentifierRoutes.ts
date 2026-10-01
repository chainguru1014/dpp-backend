const express = require('express');
const router = express.Router();
const ProductIdentifierController = require('../controllers/productIdentifierController');
const { protect, restrictTo } = require('../middleware/authMiddleware');

router.post('/', ProductIdentifierController.register);
router.post('/bulk', ProductIdentifierController.bulkRegister);
router.post('/pair', protect, restrictTo('Company', 'Employee'), ProductIdentifierController.pair);
router.get('/', ProductIdentifierController.listForProduct);
router.post('/:productId/print', ProductIdentifierController.printIdentifiers);
router.delete('/:id', ProductIdentifierController.remove);

module.exports = router;
