const express = require('express');
const router = express.Router();
const ProductController = require('../controllers/productController');
const { protect, restrictTo } = require('../middleware/authMiddleware');

// Protect all routes after this middleware
// router.use(authController.protect);

router.get('/', ProductController.getAllProducts);
router.get('/by-user', ProductController.getProductsByUser);
router.get('/by-brand', ProductController.getProductsByBrand);
router.post('/filter', ProductController.getAllProducts);
router.post('/transfer', ProductController.transfer);
router.post('/bulk-import', protect, restrictTo('Company', 'Employee'), ProductController.bulkImport);
router.get('/:id', ProductController.getProduct);
router.post('/', ProductController.addProduct);
router.post('/:id/mint', ProductController.mint);
router.put('/:id', ProductController.updateProduct);
router.post('/:id/print', ProductController.printQRCodes);
router.delete('/:id', ProductController.deleteProduct);
router.get('/transactions/:id/:token_id',ProductController.getTransaction);


module.exports = router;