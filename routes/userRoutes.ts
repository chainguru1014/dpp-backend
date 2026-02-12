const express = require('express');
const router = express.Router();
const UserController = require('../controllers/userController');

// Mobile app authentication routes
router.post('/login', UserController.login);
router.post('/register', UserController.register);

// In a real application you would protect these routes with authentication
// and verify that the requester has admin privileges.
router.get('/admin-data', UserController.getAdminUserData);
router.patch('/:id/approve', UserController.approveUser);
router.delete('/:id', UserController.deleteUser);
router.put('/:id', UserController.updateUser);

module.exports = router;

