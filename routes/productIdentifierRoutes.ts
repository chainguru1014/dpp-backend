const express = require('express');
const router = express.Router();
const ProductIdentifierController = require('../controllers/productIdentifierController');

router.post('/', ProductIdentifierController.register);
router.get('/', ProductIdentifierController.listForProduct);
router.delete('/:id', ProductIdentifierController.remove);

module.exports = router;
