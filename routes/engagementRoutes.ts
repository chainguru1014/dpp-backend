const express = require('express');
const router = express.Router();
const EngagementController = require('../controllers/engagementController');

router.get('/follow/status', EngagementController.getFollowStatus);
router.post('/follow', EngagementController.followBrand);
router.delete('/follow', EngagementController.unfollowBrand);
router.get('/follow/list', EngagementController.listFollowedBrands);

router.get('/album/status', EngagementController.getAlbumStatus);
router.post('/album', EngagementController.addAlbumItem);
router.delete('/album', EngagementController.removeAlbumItem);
router.get('/album/list', EngagementController.listAlbumItems);

router.post('/purchase', EngagementController.addPurchaseHistory);
router.get('/purchase/list', EngagementController.listPurchaseHistory);

router.post('/product-reaction', EngagementController.setProductReaction);
router.get('/product-reaction', EngagementController.getProductReaction);
router.get('/product-reactions', EngagementController.listProductReactions);

router.post('/email/send', EngagementController.sendBrandOrProductEmail);

module.exports = router;
