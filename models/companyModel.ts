const mongoose = require("mongoose");

const companySchema = new mongoose.Schema({
    name: {
        type: String,
        require: true
    },
    // Access role. 'super' = platform super admin (the built-in "admin" account);
    // 'company' = a normal brand company. Defaults to 'company' for new accounts.
    role: {
        type: String,
        enum: ['super', 'company'],
        default: 'company'
    },
    // Legacy/inert-for-passwordless-accounts: previously required for all
    // companies, but Google/Apple/OTP-linked companies never set one. No
    // longer required — never read/compared for those accounts.
    password: {
        type: String,
        required: false
    },
    email: {
        type: String,
        unique: true,
        sparse: true
    },
    title: {
        type: String
    },
    logo: {
        type: String
    },
    avatar: {
        type: String
    },
    background: {
        type: String
    },
    detail: {
        type: String
    },
    location: {
        type: String
    },
    wallet: {
        type: String
    },
    privateKey: {
        type: String
    },
    idDocuments: {
        type: Array
    },
    businessDocuments: {
        type: Array
    },
    isVerified: {
        type: Boolean,
        default: false
    },
    // Passwordless auth linking — mirrors the fields added to userModel so a
    // Company (brand/admin) account can also sign in via Google/Apple/OTP.
    // Companies are never auto-created by these flows; only linked when an
    // email already matches an existing Company document.
    googleId: {
        type: String,
        sparse: true
    },
    appleId: {
        type: String,
        sparse: true
    },
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
    }
});

const Company = mongoose.model("Company", companySchema);
module.exports = Company;