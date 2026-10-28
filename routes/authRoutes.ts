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
// Face sign-in (FACEIO). Signup start creates an account, so it shares the
// OTP request limiter's tight budget.
router.post('/face/signup/start', otpRequestLimiter, AuthController.faceSignupStart);
router.post('/face/signup/complete', otpVerifyLimiter, AuthController.faceSignupComplete);
router.post('/face/login', otpVerifyLimiter, AuthController.faceLogin);
router.post('/face/webhook', AuthController.faceWebhook);
router.post('/profile/complete', protect, AuthController.completeProfile);
router.post('/device-token', protect, AuthController.registerDeviceToken);
router.post('/ai-concierge-consent', protect, AuthController.aiConciergeConsent);

module.exports = router;
