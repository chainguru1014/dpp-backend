const express = require('express');
const router = express.Router();
const CircularController = require('../controllers/circularController');
const { protect, restrictTo } = require('../middleware/authMiddleware');

// End-of-life service requests (repair, resell, rent, recycle). Shoppers
// send and follow their own; brands and their staff answer those of their
// company (see utils/companyScope).
router.use(protect);

router.post('/requests', restrictTo('User'), CircularController.create);
router.get('/requests/mine', restrictTo('User'), CircularController.listMine);
router.put('/requests/:id/cancel', restrictTo('User'), CircularController.cancelMine);

router.get('/requests', restrictTo('Company', 'Employee'), CircularController.list);
router.put('/requests/:id', restrictTo('Company', 'Employee'), CircularController.update);

module.exports = router;
