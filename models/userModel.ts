const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
    wallet: {
        type: String,
        unique: true,
        sparse: true  // Allows multiple null values, but enforces uniqueness for non-null values
    },
    // Legacy/inert: passwordless auth (Google/Apple/email OTP) replaced
    // password-based login. Field kept schema-only for backward compatibility
    // with old records — never read or compared anywhere anymore.
    password: {
        type: String,
        required: false
    },
    role: {
        type: String,
        enum: ['User', 'Company', 'Admin'],
        default: 'User'
    },
    name: {
        type: String,
        required: true
    },
    email: {
        type: String,
        unique: true,
        sparse: true,
        required: false
    },
    avatar: {
        type: String,
    },
    isApproved: {
        type: Boolean,
        default: false
    },
    company_name: {
        type: String
    },
    company_logo: {
        type: String
    },
    company_detail: {
        type: String
    },
    // New fields for user type and profile
    userType: {
        type: String,
        enum: ['client', 'agent'],
        default: 'client'
    },
    gender: {
        type: String,
        enum: ['male', 'female', 'other']
    },
    age: {
        type: Number
    },
    country: {
        type: String
    },
    firstName: {
        type: String
    },
    lastName: {
        type: String
    },
    dateOfBirth: {
        type: String
    },
    address: {
        type: String
    },
    addressStreet: {
        type: String
    },
    addressCity: {
        type: String
    },
    addressState: {
        type: String
    },
    addressZipCode: {
        type: String
    },
    addressCountry: {
        type: String
    },
    phoneNumber: {
        type: String
    },
    googleId: {
        type: String,
        sparse: true
    },
    isGoogleUser: {
        type: Boolean,
        default: false
    },
    appleId: {
        type: String,
        sparse: true
    },
    // OTP fields for passwordless email sign-in. otpCode is select:false so it
    // never comes back on normal reads/find() — controllers must explicitly
    // .select('+otpCode') to read it.
    otpCode: {
        type: String,
        select: false
    },
    otpExpiresAt: {
        type: Date
    },
    otpAttempts: {
        type: Number,
        default: 0
    },
    otpResendAt: {
        type: Date
    },
    emailVerified: {
        type: Boolean,
        default: false
    },
    profileCompleted: {
        type: Boolean,
        default: false
    }
});

const User = mongoose.model("User", userSchema);
module.exports = User;