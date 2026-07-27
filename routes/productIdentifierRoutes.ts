const express = require('express');
const router = express.Router();
const ProductIdentifierController = require('../controllers/productIdentifierController');

router.post('/', ProductIdentifierController.register);
router.get('/', ProductIdentifierController.listForProduct);
router.post('/:productId/print', ProductIdentifierController.printIdentifiers);
router.delete('/:id', ProductIdentifierController.remove);

module.exports = router;
