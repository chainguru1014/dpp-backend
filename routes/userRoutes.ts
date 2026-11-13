const express = require('express');
const router = express.Router();
const UserController = require('../controllers/userController');
const { protect } = require('../middleware/authMiddleware');
const { requireSuperAdmin } = require('../middleware/superAdmin');

// Mobile app authentication routes
router.post('/login', UserController.login);
router.post('/check-username', UserController.checkUsername);
router.post('/register', UserController.register);
router.post('/google-login', UserController.googleLogin);
router.post('/complete-google-profile', UserController.completeGoogleProfile);
router.put('/profile/:id', UserController.updateProfile);

// The admin lists (every company and app user), approving and removing
// accounts: the Yometel admin only.
router.get('/admin-data', protect, requireSuperAdmin, UserController.getAdminUserData);
router.patch('/:id/approve', protect, requireSuperAdmin, UserController.approveUser);
router.delete('/:id', protect, requireSuperAdmin, UserController.deleteUser);
router.put('/:id', UserController.updateUser);

module.exports = router;

