const mongoose = require("mongoose");

// Enterprise-employee identity, deliberately separate from userModel/companyModel
// so consumer and employee data never share a collection (per the GDPR dual-route
// requirement). emailHash still backs OTP lookup; the plaintext `email` field
// below is kept only for admin-facing display (Staff Roster/Audit Log).
const employeeSchema = new mongoose.Schema({
    // SHA-256 of the normalized corporate email. Deterministic, so the same
    // address always resolves to the same employee record without us ever
    // storing the address itself.
    emailHash: {
        type: String,
        required: true,
        unique: true
    },
    // Plaintext corporate email, kept for display in the Staff Roster/Audit
    // Log admin UIs. Optional: employees provisioned before this field existed
    // only have emailHash/emailDomain and will show blank until re-invited.
    email: {
        type: String
    },
    // Domain alone (e.g. "hm.com") isn't sensitive on its own and lets us
    // resolve which Company an employee belongs to and report on it.
    emailDomain: {
        type: String,
        required: true,
        index: true
    },
    company_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        required: true
    },
    // Optional internal HR/employee code — distinct from the email hash, set
    // by an admin, never derived from PII.
    employeeCode: {
        type: String
    },
    role: {
        type: String,
        enum: ['staff', 'manager', 'admin'],
        default: 'staff'
    },
    isActive: {
        type: Boolean,
        default: true
    },
    // OTP fields, same pattern as userModel/companyModel — select:false so
    // otpCode never comes back on a normal find().
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
    lastLoginAt: {
        type: Date
    }
}, {
    timestamps: true
});

const Employee = mongoose.model("Employee", employeeSchema);
module.exports = Employee;
