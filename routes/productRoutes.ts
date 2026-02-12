const express = require('express');
const router = express.Router();
const ProductController = require('../controllers/productController');

// Protect all routes after this middleware
// router.use(authController.protect);

router.get('/', ProductController.getAllProducts);
router.get('/by-user', ProductController.getProductsByUser);
router.post('/filter', ProductController.getAllProducts);
router.post('/transfer', ProductController.transfer);
router.get('/:id', ProductController.getProduct);
router.post('/', ProductController.addProduct);
router.post('/:id/mint', ProductController.mint);
router.put('/:id', ProductController.updateProduct);
router.post('/:id/print', ProductController.printQRCodes);
router.delete('/:id', ProductController.deleteProduct);
router.get('/transactions/:id/:token_id',ProductController.getTransaction);


module.exports = router;