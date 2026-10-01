const express = require('express');
const router = express.Router();
const SecurityController = require('../controllers/securityController');
const { protect, restrictTo } = require('../middleware/authMiddleware');

// Security insights — brands and their staff only, each limited to their own
// company's products (see utils/companyScope).
router.use(protect, restrictTo('Company', 'Employee'));

router.get('/insights', SecurityController.getInsights);
router.post('/item-status', SecurityController.setItemStatus);

module.exports = router;
