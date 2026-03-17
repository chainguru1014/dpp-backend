const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
    wallet: {
        type: String,
        unique: true,
        sparse: true  // Allows multiple null values, but enforces uniqueness for non-null values
    },
    password: {
        type: String,
        required: false  // Not required for Google OAuth users
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
        required: true
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
    googleId: {
        type: String,
        sparse: true
    },
    isGoogleUser: {
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