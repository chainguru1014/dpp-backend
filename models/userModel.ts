const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
    wallet: {
        type: String,
        unique: true,
        sparse: true  // Allows multiple null values, but enforces uniqueness for non-null values
    },
    password: {
        type: String,
        require: true
    },
    role: {
        type: String,
        enum: ['User', 'Company', 'Admin'],
        default: 'User'
    },
    name: {
        type: String,
        require: true
    },
    email: {
        type: String,
        unique: true,
        require: true
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
    }
});

const User = mongoose.model("User", userSchema);
module.exports = User;