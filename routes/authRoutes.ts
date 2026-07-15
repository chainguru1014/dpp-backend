const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const AuthController = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');

// 5 requests / 15 min / IP. The per-email 60s resend cooldown (enforced in the
// controller) covers the gap this misses when many users share one IP (NAT).
const otpRequestLimiter = rateLimit({
    max: 5,
    windowMs: 15 * 60 * 1000,
    message: 'Too many code requests from this IP, please try again later'
});

// More generous — legitimate users retyping a code they mistyped.
const otpVerifyLimiter = rateLimit({
    max: 20,
    windowMs: 15 * 60 * 1000,
    message: 'Too many attempts from this IP, please try again later'
});

router.post('/google', AuthController.google);
router.post('/apple', AuthController.apple);
router.post('/otp/request', otpRequestLimiter, AuthController.otpRequest);
router.post('/signup/otp/request', otpRequestLimiter, AuthController.signupOtpRequest);
router.post('/otp/verify', otpVerifyLimiter, AuthController.otpVerify);
router.post('/profile/complete', protect, AuthController.completeProfile);
router.post('/company-profile/complete', protect, AuthController.completeCompanyProfile);
router.post('/device-token', protect, AuthController.registerDeviceToken);

module.exports = router;
