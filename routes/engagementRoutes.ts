const express = require('express');
const router = express.Router();
const EngagementController = require('../controllers/engagementController');
const { protect } = require('../middleware/authMiddleware');

router.get('/follow/status', EngagementController.getFollowStatus);
router.post('/follow', EngagementController.followBrand);
router.delete('/follow', EngagementController.unfollowBrand);
router.get('/follow/list', EngagementController.listFollowedBrands);
router.get('/brand/stats', EngagementController.getBrandStats);
router.get('/brand/followers', EngagementController.listBrandFollowers);

router.get('/album/status', EngagementController.getAlbumStatus);
router.post('/album', EngagementController.addAlbumItem);
router.delete('/album', EngagementController.removeAlbumItem);
router.get('/album/list', EngagementController.listAlbumItems);

router.get('/cart/status', protect, EngagementController.getCartStatus);
router.get('/cart', protect, EngagementController.listCartItems);
router.post('/cart', protect, EngagementController.addCartItem);
router.delete('/cart', protect, EngagementController.removeCartItem);

router.post('/purchase', EngagementController.addPurchaseHistory);
router.get('/purchase/list', EngagementController.listPurchaseHistory);

router.post('/product-reaction', EngagementController.setProductReaction);
router.get('/product-reaction', EngagementController.getProductReaction);
router.get('/product-reactions', EngagementController.listProductReactions);

router.post('/email/send', EngagementController.sendBrandOrProductEmail);

module.exports = router;
