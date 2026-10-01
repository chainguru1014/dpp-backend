const express = require('express');
const router = express.Router();
const TraceController = require('../controllers/traceController');
const { protect, restrictTo } = require('../middleware/authMiddleware');

// Item search + digital-twin timeline — brands and their staff only, each
// limited to their own company's products (see traceController.resolveScope).
router.use(protect, restrictTo('Company', 'Employee'));

router.get('/search', TraceController.search);
router.get('/item/:productId/:qrcodeId', TraceController.getItem);
router.get('/product/:productId', TraceController.getProduct);

module.exports = router;
