const mongoose = require("mongoose");

// Append-only, hash-chained audit trail for employee actions. Nothing in this
// codebase ever exposes an update or delete route for this collection —
// entryHash covers (prevHash + this row's own fields), so editing or removing
// any past row breaks the chain for every row after it and is detectable.
const employeeAuditLogSchema = new mongoose.Schema({
    employee_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee',
        required: true
    },
    action: {
        type: String,
        required: true
    },
    metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    ip: {
        type: String,
        default: ''
    },
    prevHash: {
        type: String,
        required: true
    },
    entryHash: {
        type: String,
        required: true
    }
}, {
    timestamps: true
});

employeeAuditLogSchema.index({ employee_id: 1, createdAt: -1 });

const EmployeeAuditLog = mongoose.model("EmployeeAuditLog", employeeAuditLogSchema);
module.exports = EmployeeAuditLog;
