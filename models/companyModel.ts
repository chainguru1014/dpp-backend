const mongoose = require("mongoose");

const companySchema = new mongoose.Schema({
    name: {
        type: String,
        require: true
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