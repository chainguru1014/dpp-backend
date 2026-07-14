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
    // No longer required at the schema level: consumer ("client") accounts
    // identify with `nickname` only and must never be asked for a real name.
    // Still used to display agent/company-linked accounts that do provide one.
    name: {
        type: String,
        required: false
    },
    // Consumer-facing display name — the only "name" a client-type user ever
    // provides. Part of the GDPR-safe avatar dataset (nickname/gender/birthYear/country).
    nickname: {
        type: String
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
    // Legacy: exact age, previously collected directly. Kept for old records
    // and for the 'agent' branch; client-type accounts should use birthYear
    // instead and have their age derived dynamically (see authShared.buildUserResponse).
    age: {
        type: Number
    },
    // 4-digit year only (never a full date of birth) — deliberately coarser
    // than a DOB so it carries less re-identification risk while still
    // letting marketing compute an accurate age indefinitely: currentYear - birthYear.
    birthYear: {
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
    },
    // Push-notification consent + the resulting token — per the GDPR brief,
    // this is meant to be the *only* key used to reach a consumer, so it's
    // stored independent of any PII field.
    pushConsent: {
        type: Boolean,
        default: false
    },
    deviceToken: {
        type: String
    }
});

const User = mongoose.model("User", userSchema);
module.exports = User;