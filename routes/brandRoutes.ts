const express = require('express');
const router = express.Router();
const BrandController = require('../controllers/brandController');
const { protect, restrictTo } = require('../middleware/authMiddleware');

// A company's brands (details + product page design per brand) — brands and
// their staff only, each limited to their own company (see utils/companyScope).
// The public design lookup for shoppers is GET /company/:id/dpp-theme?brand=.
router.use(protect, restrictTo('Company', 'Employee'));

router.get('/', BrandController.list);
router.post('/', BrandController.create);
router.put('/:id', BrandController.update);
router.delete('/:id', BrandController.remove);

module.exports = router;
