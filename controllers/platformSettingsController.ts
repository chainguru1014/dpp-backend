const Company = require('../models/companyModel');
const PlatformSettings = require('../models/platformSettingsModel');
const AppError = require('../utils/appError');

const CONSUMER_LOCATION_STEPS_KEY = 'consumerLocationSteps';
const MAX_STEPS = 6;

// Fixed set of location-type categories for the consumer app's Home page
// tiles — the app translates each key via i18n instead of displaying
// admin-entered free text. Keep in sync with frontend/src/features/
// consumer-steps/ConsumerLocationStepsPage.js's TYPE_OPTIONS and
// app/src/screens/HomeScreen.tsx's TYPE_LABEL_KEYS.
const CONSUMER_LOCATION_TYPE_KEYS = ['store', 'factory', 'warehouse', 'p2p', 'home', 'other'];

// What ships until a super admin edits this for the first time — the same
// six items the consumer Home page hardcoded before this became configurable.
const DEFAULT_STEPS = [
    { entity: 'Store', type: 'store' },
    { entity: 'Factory', type: 'factory' },
    { entity: 'Warehouse', type: 'warehouse' },
    { entity: 'P2P', type: 'p2p' },
    { entity: 'Home', type: 'home' },
    { entity: 'Other', type: 'other' }
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
            entity: String(step?.entity || '').trim(),
            type: String(step?.type || '').trim()
        }));

        const invalidIndex = cleaned.findIndex((step: any) => !step.entity || !step.type);
        if (invalidIndex !== -1) {
            return next(new AppError(400, 'fail', `Step ${invalidIndex + 1} needs both an entity and a type`), req, res, next);
        }

        const invalidTypeIndex = cleaned.findIndex((step: any) => !CONSUMER_LOCATION_TYPE_KEYS.includes(step.type));
        if (invalidTypeIndex !== -1) {
            return next(new AppError(400, 'fail', `Step ${invalidTypeIndex + 1} has an unrecognized type`), req, res, next);
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
