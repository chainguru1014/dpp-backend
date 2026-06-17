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
    password: {
        type: String,
        require: true
    },
    email: {
        type: String
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
    }
});

const Company = mongoose.model("Company", companySchema);
module.exports = Company;