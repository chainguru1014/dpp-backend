const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const EmployeeAuthController = require('../controllers/employeeAuthController');
const EmployeeAuditLogController = require('../controllers/employeeAuditLogController');
const EmployeeController = require('../controllers/employeeController');
const { protect, restrictTo, restrictToEmployeeRoleOrCompany } = require('../middleware/authMiddleware');

// Same limits as the consumer OTP routes (authRoutes.ts) — kept separate here
// so the two routers can be tuned independently.
const otpRequestLimiter = rateLimit({
    max: 5,
    windowMs: 15 * 60 * 1000,
    message: 'Too many code requests from this IP, please try again later'
});

const otpVerifyLimiter = rateLimit({
    max: 20,
    windowMs: 15 * 60 * 1000,
    message: 'Too many attempts from this IP, please try again later'
});

router.post('/otp/request', otpRequestLimiter, EmployeeAuthController.otpRequest);
router.post('/otp/verify', otpVerifyLimiter, EmployeeAuthController.otpVerify);
router.get('/audit-log', protect, restrictToEmployeeRoleOrCompany('manager', 'admin'), EmployeeAuditLogController.list);

// Roster management — Company (brand admin) accounts, or an Employee acting
// as their company's Supervisor (see resolveRosterActor's canWrite check in
// employeeController.ts, which 403s a working_employee actor). This is the
// only way an employee record is ever created; see
// employeeAuthController.otpRequest, which refuses to send a code for anyone
// not provisioned here first.
router.post('/employees', protect, restrictTo('Company', 'Employee'), EmployeeController.invite);
router.get('/employees', protect, restrictTo('Company', 'Employee'), EmployeeController.list);
router.patch('/employees/:id', protect, restrictTo('Company', 'Employee'), EmployeeController.update);
router.delete('/employees/:id', protect, restrictTo('Company', 'Employee'), EmployeeController.remove);

module.exports = router;
