const Company = require('../models/companyModel');
const Product = require('../models/productModel')
const Employee = require('../models/employeeModel');
const base = require('./baseController');
const APIFeatures = require('../utils/apiFeatures');
const AppError = require('../utils/appError');
const { encrypt } = require('../utils/helper');
const { emailDomain, hashEmail } = require('../utils/pii');
const { getNextSequence } = require('../models/counterModel');
const { formatTerminalId } = require('../utils/idFormat');
const qrcode = require('qrcode');
const QRcode = require('../models/qrcodeModel');
const mongoose = require("mongoose");

// Fixed set of process-step "type" categories — the mobile app translates
// each key via i18n instead of displaying admin-entered free text, so the
// value stored here must be one of these keys, not an arbitrary string. Keep
// in sync with frontend/src/features/process-steps/ProcessStepsPage.js's
// TYPE_OPTIONS and app/src/screens/EmployeeHomeScreen.tsx's TYPE_LABEL_KEYS.
const PROCESS_STEP_TYPE_KEYS = [
    'receiving', 'shipping', 'finalInspection', 'inboundScan', 'packing',
    'unpacking', 'storeReceipt', 'inspection', 'returnCheck', 'disposal', 'general'
];

exports.getAllCompanys = base.getAll(Company);
exports.getCompany = base.getOne(Company);

// Don't update password on this 
exports.updateCompany = base.updateOne(Company);
exports.deleteCompany = base.deleteOne(Company);
exports.addCompany = async(req: any, res: any, next: any) => {
    try {
        const company = await Company.findOne({ name: req.body.name });
        if(company) {
            return next(new AppError(400, 'fail', 'Already exists the company'), req, res, next);
        }

        // Create company without any blockchain keys or on-chain minting.
        // Force the role to 'company' — only the built-in admin account is 'super',
        // and clients must not be able to self-assign an elevated role.
        // Default the Process Step Labels grid to a single step named after
        // the company itself, rather than the schema's blank placeholder, so
        // a freshly-registered company already has one usable entry instead
        // of an empty/unlabeled tile.
        const doc = await Company.create({
            ...req.body,
            role: 'company',
            // A company created here is always created by the super admin
            // (POST /company has no self-signup path), so it's approved
            // immediately rather than sitting in a manual-approval queue.
            isVerified: true,
            processSteps: [{ entity: String(req.body?.name || '').trim(), type: 'general' }]
        });

        // Best-effort: provision a default Supervisor employee from the
        // company's own contact email, so a freshly-registered company has
        // someone who can sign in to the dashboard immediately rather than
        // needing a pre-existing employee to invite them. Never blocks
        // company creation itself — email is optional on Company.
        const rawEmail = String(req.body?.email || '').trim();
        if (rawEmail && rawEmail.includes('@')) {
            try {
                const domain = emailDomain(rawEmail);
                const emailHash = hashEmail(rawEmail);

                if (!doc.allowedEmailDomains.includes(domain)) {
                    doc.allowedEmailDomains.push(domain);
                    await doc.save();
                }

                const existingEmployee = await Employee.findOne({ emailHash });
                if (!existingEmployee) {
                    const terminalSeq = await getNextSequence(`terminal:${doc._id}`);
                    await Employee.create({
                        email: rawEmail.toLowerCase(),
                        emailHash,
                        emailDomain: domain,
                        company_id: doc._id,
                        name: `${String(req.body?.name || '').trim()} admin`,
                        role: 'admin',
                        employeeType: 'supervisor',
                        isActive: true,
                        terminalId: formatTerminalId(terminalSeq)
                    });
                }
            } catch (provisionErr) {
                console.error('Default supervisor provisioning failed:', provisionErr);
            }
        }

        res.status(200).json({
            status: 'success',
            data: {
                doc
            }
        });

    } catch (error) {
        next(error);
    }
};

// Resolves which Company doc a process-steps request is scoped to, and
// whether the requester may WRITE to it. Mirrors
// employeeAuditLogController.resolveCompanyScope's actorKind branching, but
// returns the full Company doc since callers read/write processSteps
// directly on it.
const resolveProcessStepsActor = async (req: any) => {
    if (req.user.actorKind === 'Company') {
        const company = await Company.findById(req.user.id);
        // A platform super-admin (role: 'super') still owns its own company
        // doc/products (see employeeController's cross-company visibility for
        // the *elevated* side of 'super' — this is the other direction: it
        // must not lose its own company-scoped features, process steps
        // included, just for holding that extra privilege).
        if (!company) {
            return { company: null, canWrite: false };
        }
        return { company, canWrite: true };
    }
    // Employee: any employeeType may READ (the mobile Worker Operations grid
    // needs it for working_employee too); only a Supervisor may WRITE.
    const employee = await Employee.findById(req.user.id).select('company_id employeeType');
    if (!employee) {
        return { company: null, canWrite: false };
    }
    const company = await Company.findById(employee.company_id);
    return { company, canWrite: employee.employeeType === 'supervisor' };
};

exports.getProcessSteps = async (req: any, res: any, next: any) => {
    try {
        const { company } = await resolveProcessStepsActor(req);
        if (!company) {
            return next(new AppError(404, 'fail', 'No company found for this account'), req, res, next);
        }
        res.status(200).json({
            status: 'success',
            data: {
                processSteps: company.processSteps || []
            }
        });
    } catch (error) {
        next(error);
    }
};

exports.updateProcessSteps = async (req: any, res: any, next: any) => {
    try {
        const { company, canWrite } = await resolveProcessStepsActor(req);
        if (!company) {
            return next(new AppError(404, 'fail', 'No company found for this account'), req, res, next);
        }
        if (!canWrite) {
            return next(new AppError(403, 'fail', 'Only a Supervisor or company admin may edit process step labels'), req, res, next);
        }

        const steps = Array.isArray(req.body?.processSteps) ? req.body.processSteps : null;
        if (!steps || steps.length < 1 || steps.length > 10) {
            return next(new AppError(400, 'fail', 'processSteps must be an array of 1 to 10 steps'), req, res, next);
        }

        const cleaned = steps.map((step: any) => ({
            entity: String(step?.entity || '').trim(),
            type: String(step?.type || '').trim()
        }));

        const invalidIndex = cleaned.findIndex((step: any) => !step.entity || !step.type);
        if (invalidIndex !== -1) {
            return next(new AppError(400, 'fail', `Step ${invalidIndex + 1} needs both an entity and a type`), req, res, next);
        }

        const invalidTypeIndex = cleaned.findIndex((step: any) => !PROCESS_STEP_TYPE_KEYS.includes(step.type));
        if (invalidTypeIndex !== -1) {
            return next(new AppError(400, 'fail', `Step ${invalidTypeIndex + 1} has an unrecognized type`), req, res, next);
        }

        company.processSteps = cleaned;
        await company.save();

        res.status(200).json({
            status: 'success',
            data: {
                processSteps: company.processSteps
            }
        });
    } catch (error) {
        next(error);
    }
};



// exports.getCompanyByWallet = async(req: any, res: any, next: any) => {
//     try {
//         const doc = await Company.findOne({ wallet: req.params.wallet});

//         res.status(200).json({
//             status: 'success',
//             data: {
//                 doc
//             }
//         });
//     } catch (error) {
//         next(error);
//     }
// };


exports.getProductsByCompanyId = async(req:any,res:any,next:any) => {
    try 
    {
        const user_id = req.query.user_id;
        console.log('user_id',user_id)
        const company_products = await QRcode.find({company_id:mongoose.Types.ObjectId(user_id)})
       

        let products = [];
        let count:any = {}

        for(const info of company_products) {   
            if(count[info.product_id]) {
                count[info.product_id] ++;
            }
            else {
                count[info.product_id] = 1; 
                const product = await Product.findById(info.product_id)
                products.push(product)
            }
        }
        res.status(200).json({
            status:'success',
            data:{
                products,
                count,
                company_products
            }
        })
    }
    catch(err) {
        console.log('error',err)
        next(err)
    }
}

// @deprecated Password-based company/brand login. Superseded for passwordless
// sign-in by /auth/google, /auth/apple, /auth/otp/* (which link to an
// existing Company by email but never auto-create one). Kept mounted so
// already-installed app/web builds don't hard-break mid-rollout.
exports.login = async(req: any, res: any, next: any) => {
    try {
        console.log("login")
        const user = await Company.findOne({ name: req.body.name, password: req.body.password });
        let ismobile = req.body.mobile;

        if(!user) {
           return res.status(404).json({
                status: 'failed',
                message: 'User name or password is wrong!'
            });    
        }

        // Build encrypted data without any blockchain token id.
        const stringdata = JSON.stringify({
            user_id: user._id,
        });
        const encryptData = encrypt(stringdata);

        const qrcodeImage = await qrcode.toDataURL('https://4dveritaspublic.com?qrcode=' + encryptData);

        const company_products = await QRcode.find({ company_id: user._id });

        user.privateKey = undefined;
        let doc = {
            qrcode: qrcodeImage,
            products: company_products,
            ...user._doc
        };

        res.status(200).json({
            status: 'success',
            data: {
                doc
            }
        });
    } catch (error) {
        next(error);
    }
};

exports.verify = async(req: any, res: any, next: any) => {
    try {
        const doc = await Company.findByIdAndUpdate(req.params.id, { isVerified: true }, {
            new: true,
            runValidators: true
        });

        if (!doc) {
            return next(new AppError(404, 'fail', 'No document found with that id'), req, res, next);
        }

        res.status(200).json({
            status: 'success',
            data: {
                doc
            }
        });
    } catch (error) {
        next(error);
    }
};