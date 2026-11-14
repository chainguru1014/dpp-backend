const mongoose = require("mongoose");

// A professional (staff) sign-up in progress: someone registering with an
// email no company has listed yet. Holds only the email code; once the code
// is verified the app shows the staff profile page, and POST
// /auth/staff/register creates the Employee (see authController).
const staffSignupSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    otpCode: { type: String, select: false },
    otpExpiresAt: { type: Date },
    otpAttempts: { type: Number, default: 0 },
    otpResendAt: { type: Date },
    emailVerified: { type: Boolean, default: false },
    // Old attempts clear themselves after a day.
    createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 }
});

module.exports = mongoose.model("StaffSignup", staffSignupSchema);
