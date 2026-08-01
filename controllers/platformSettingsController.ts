const Company = require('../models/companyModel');
const PlatformSettings = require('../models/platformSettingsModel');
const AppError = require('../utils/appError');

const CONSUMER_LOCATION_STEPS_KEY = 'consumerLocationSteps';
const MAX_STEPS = 6;

// Name only — no fixed type/category here (unlike the corporate per-company
// process steps), per explicit "manage name only" request.
const DEFAULT_STEPS = [
    { entity: 'Store' },
    { entity: 'Factory' },
    { entity: 'Warehouse' },
    { entity: 'P2P' },
    { entity: 'Home' },
    { entity: 'Other' }
];

// GET /platform-settings/consumer-location-steps — public (no auth): the
// consumer app's Home screen needs this before/without a signed-in session.
// Upserts the default on first read so there's always a document once the
// app is used, without needing a manual seed step.
exports.getConsumerLocationSteps = async (req: any, res: any, next: any) => {
    try {
        let doc = await PlatformSettings.findOne({ key: CONSUMER_LOCATION_STEPS_KEY });
        if (!doc) {
            doc = await PlatformSettings.create({ key: CONSUMER_LOCATION_STEPS_KEY, processSteps: DEFAULT_STEPS });
        }
        res.status(200).json({
            status: 'success',
            data: { processSteps: doc.processSteps || [] }
        });
    } catch (error) {
        next(error);
    }
};

// PUT /platform-settings/consumer-location-steps — super admin only.
exports.updateConsumerLocationSteps = async (req: any, res: any, next: any) => {
    try {
        const requester = await Company.findById(req.user.id).select('role');
        if (!requester || requester.role !== 'super') {
            return next(new AppError(403, 'fail', 'Only the platform admin may edit this'), req, res, next);
        }

        const steps = Array.isArray(req.body?.processSteps) ? req.body.processSteps : null;
        if (!steps || steps.length < 1 || steps.length > MAX_STEPS) {
            return next(new AppError(400, 'fail', `processSteps must be an array of 1 to ${MAX_STEPS} steps`), req, res, next);
        }

        const cleaned = steps.map((step: any) => ({
            entity: String(step?.entity || '').trim()
        }));

        const invalidIndex = cleaned.findIndex((step: any) => !step.entity);
        if (invalidIndex !== -1) {
            return next(new AppError(400, 'fail', `Step ${invalidIndex + 1} needs a name`), req, res, next);
        }

        const doc = await PlatformSettings.findOneAndUpdate(
            { key: CONSUMER_LOCATION_STEPS_KEY },
            { processSteps: cleaned },
            { upsert: true, new: true }
        );

        res.status(200).json({
            status: 'success',
            data: { processSteps: doc.processSteps }
        });
    } catch (error) {
        next(error);
    }
};
