const Company = require('../models/companyModel');
const Employee = require('../models/employeeModel');
const CaptureRecord = require('../models/captureRecordModel');
const AppError = require('../utils/appError');
const { getNextSequence } = require('../models/counterModel');
const { deriveEntityCode } = require('../utils/idFormat');

// Matches CaptureRecord.identifierType's enum — 'securityQr' isn't included
// since it's never actually distinguishable from 'qr' at capture time (both
// are QR-shaped codes resolved the same way; see the app's
// verifyScannedCode), it's only a labeling distinction in the print dialog.
const ALLOWED_IDENTIFIER_TYPES = ['qr', 'barcode', 'nfc', 'rfid', 'gs1dl'];

// YYYYMMDD in UTC — matches the day boundary the daily ref-number sequence
// resets on.
const dateKeyFor = (date: Date): string => {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}${m}${d}`;
};

// Resolves the requesting Employee + their Company. Every capture route is
// Employee-actor only (see captureRoutes.ts) — there is no Company-actor
// branch here, unlike resolveProcessStepsActor in companyController.ts,
// since captures are recorded from the mobile app's employee session only.
const resolveEmployeeActor = async (req: any) => {
    const employee = await Employee.findById(req.user.id);
    if (!employee) return { employee: null, company: null };
    const company = await Company.findById(employee.company_id);
    if (!company) return { employee, company: null };
    return { employee, company };
};

exports.create = async (req: any, res: any, next: any) => {
    try {
        const { employee, company } = await resolveEmployeeActor(req);
        if (!employee || !company) {
            return next(new AppError(404, 'fail', 'No company found for this account'), req, res, next);
        }

        const stepIndex = Number(req.body?.stepIndex);
        const steps = company.processSteps || [];
        if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= steps.length) {
            return next(new AppError(400, 'fail', 'Invalid stepIndex'), req, res, next);
        }

        const rawValue = String(req.body?.rawValue || '').trim();
        if (!rawValue) {
            return next(new AppError(400, 'fail', 'rawValue is required'), req, res, next);
        }

        const identifierType = ALLOWED_IDENTIFIER_TYPES.includes(req.body?.identifierType) ? req.body.identifierType : 'qr';
        const step = steps[stepIndex];
        const dateKey = dateKeyFor(new Date());
        const refCode = deriveEntityCode(step.entity);

        const seq = await getNextSequence(`ref:${company._id}:${stepIndex}:${dateKey}`);
        const refNumber = `${refCode}-${stepIndex + 1}-${dateKey}-${String(seq).padStart(3, '0')}`;

        const location = req.body?.location && typeof req.body.location === 'object'
            ? {
                latitude: req.body.location.latitude ?? null,
                longitude: req.body.location.longitude ?? null,
                accuracy: req.body.location.accuracy ?? null,
                address: String(req.body.location.address || ''),
            }
            : undefined;
        const device = req.body?.device && typeof req.body.device === 'object'
            ? {
                model: req.body.device.model || '',
                os: req.body.device.os || '',
                osVersion: req.body.device.osVersion || '',
            }
            : undefined;

        const workerLabel = employee.name || employee.employeeCode || (employee.email ? employee.email.split('@')[0] : 'Unknown');

        const doc = await CaptureRecord.create({
            company_id: company._id,
            employee_id: employee._id,
            stepIndex,
            stepEntity: step.entity,
            stepType: step.type,
            refCode,
            seq,
            dateKey,
            refNumber,
            rawValue,
            identifierType,
            imagePath: String(req.body?.imagePath || ''),
            productId: String(req.body?.productId || ''),
            qrcodeId: String(req.body?.qrcodeId || ''),
            location,
            device,
            terminalId: employee.terminalId || '',
            workerLabel,
        });

        res.status(201).json({
            status: 'success',
            data: { doc }
        });
    } catch (error) {
        next(error);
    }
};

exports.list = async (req: any, res: any, next: any) => {
    try {
        const { company } = await resolveEmployeeActor(req);
        if (!company) {
            return next(new AppError(404, 'fail', 'No company found for this account'), req, res, next);
        }

        const filter: any = { company_id: company._id };

        if (req.query?.stepIndex !== undefined && req.query?.stepIndex !== '') {
            const stepIndex = Number(req.query.stepIndex);
            if (Number.isInteger(stepIndex)) {
                filter.stepIndex = stepIndex;
            }
        }

        if (req.query?.date === 'today' || req.query?.date === undefined) {
            filter.dateKey = dateKeyFor(new Date());
        } else if (req.query?.date && req.query.date !== 'all') {
            filter.dateKey = String(req.query.date);
        }

        if (req.query?.flagged === 'true') {
            filter.flagged = true;
        }

        const docs = await CaptureRecord.find(filter).sort({ capturedAt: -1 }).limit(200);

        res.status(200).json({
            status: 'success',
            data: { docs }
        });
    } catch (error) {
        next(error);
    }
};

exports.toggleFlag = async (req: any, res: any, next: any) => {
    try {
        const { company } = await resolveEmployeeActor(req);
        if (!company) {
            return next(new AppError(404, 'fail', 'No company found for this account'), req, res, next);
        }

        const doc = await CaptureRecord.findOne({ _id: req.params.id, company_id: company._id });
        if (!doc) {
            return next(new AppError(404, 'fail', 'No capture found with that id'), req, res, next);
        }

        doc.flagged = !doc.flagged;
        await doc.save();

        res.status(200).json({
            status: 'success',
            data: { doc }
        });
    } catch (error) {
        next(error);
    }
};
