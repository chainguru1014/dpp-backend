const express = require('express');
const router = express.Router();
const UserController = require('../controllers/userController');

// Mobile app authentication routes
router.post('/login', UserController.login);
router.post('/check-username', UserController.checkUsername);
router.post('/register', UserController.register);
router.post('/google-login', UserController.googleLogin);
router.post('/complete-google-profile', UserController.completeGoogleProfile);
router.put('/profile/:id', UserController.updateProfile);

// In a real application you would protect these routes with authentication
// and verify that the requester has admin privileges.
router.get('/admin-data', UserController.getAdminUserData);
router.patch('/:id/approve', UserController.approveUser);
router.delete('/:id', UserController.deleteUser);
router.put('/:id', UserController.updateUser);

module.exports = router;

