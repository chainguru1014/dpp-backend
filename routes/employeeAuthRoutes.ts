const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const EmployeeAuthController = require('../controllers/employeeAuthController');
const EmployeeAuditLogController = require('../controllers/employeeAuditLogController');
const { protect, restrictToEmployeeRoleOrCompany } = require('../middleware/authMiddleware');

// Same limits as the consumer OTP routes (authRoutes.ts) — kept separate here
// so the two routers can be tuned independently.
const otpRequestLimiter = rateLimit({
    max: 5,
    windowMs: 15 * 60 * 1000,
    message: 'Too many code requests from this IP, please try again later'
});

const otpVerifyLimiter = rateLimit({
    max: 20,
    windowMs: 15 * 60 * 1000,
    message: 'Too many attempts from this IP, please try again later'
});

router.post('/otp/request', otpRequestLimiter, EmployeeAuthController.otpRequest);
router.post('/otp/verify', otpVerifyLimiter, EmployeeAuthController.otpVerify);
router.get('/audit-log', protect, restrictToEmployeeRoleOrCompany('manager', 'admin'), EmployeeAuditLogController.list);

module.exports = router;
