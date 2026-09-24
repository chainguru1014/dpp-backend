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

// ----- Product item categories (super-admin managed) -----
const Product = require('../models/productModel');
const {
    ITEM_CATEGORIES_KEY,
    FALLBACK_CATEGORY_KEY,
    getItemCategories,
    slugify,
    defaultSkuPrefix,
} = require('../utils/itemCategories');

const MAX_CATEGORIES = 30;

// GET /platform-settings/item-categories — public (the product form, the
// dashboard and the app all need the labels). Each entry also carries how
// many products use it, so the manage dialog can warn before a removal.
exports.getItemCategories = async (req: any, res: any, next: any) => {
    try {
        const categories = await getItemCategories();
        const counts = await Product.aggregate([
            { $match: { is_deleted: { $ne: true } } },
            { $group: { _id: '$itemCategory', n: { $sum: 1 } } }
        ]);
        const countMap: any = {};
        counts.forEach((c: any) => { countMap[c._id || FALLBACK_CATEGORY_KEY] = (countMap[c._id || FALLBACK_CATEGORY_KEY] || 0) + c.n; });
        res.status(200).json({
            status: 'success',
            data: {
                itemCategories: categories.map((c: any) => ({ ...c, productCount: countMap[c.key] || 0 })),
                fallbackKey: FALLBACK_CATEGORY_KEY
            }
        });
    } catch (error) {
        next(error);
    }
};

// PUT /platform-settings/item-categories — super admin only. Body:
// { itemCategories: [{ key?, label, skuPrefix? }] } in display order. An
// entry without a key is new (its key is derived from the label); existing
// keys never change. A category left out is removed, and its products move
// to the fallback "Others" category (which itself can't be removed).
exports.updateItemCategories = async (req: any, res: any, next: any) => {
    try {
        const requester = await Company.findById(req.user.id).select('role');
        if (!requester || requester.role !== 'super') {
            return next(new AppError(403, 'fail', 'Only the platform admin may edit this'), req, res, next);
        }

        const input = Array.isArray(req.body?.itemCategories) ? req.body.itemCategories : null;
        if (!input || input.length < 1 || input.length > MAX_CATEGORIES) {
            return next(new AppError(400, 'fail', `itemCategories must be an array of 1 to ${MAX_CATEGORIES} categories`), req, res, next);
        }

        const existing = await getItemCategories();
        const existingKeys = new Set(existing.map((c: any) => c.key));
        const usedKeys = new Set<string>();
        const usedLabels = new Set<string>();
        const cleaned: any[] = [];
        for (let i = 0; i < input.length; i++) {
            const label = String(input[i]?.label || '').trim();
            if (!label) {
                return next(new AppError(400, 'fail', `Category ${i + 1} needs a name`), req, res, next);
            }
            if (usedLabels.has(label.toLowerCase())) {
                return next(new AppError(400, 'fail', `"${label}" is listed twice`), req, res, next);
            }
            usedLabels.add(label.toLowerCase());

            let key = String(input[i]?.key || '').trim();
            if (!key || !existingKeys.has(key)) {
                // New category — derive a unique key from its name.
                const base = slugify(label) || 'category';
                key = base;
                for (let n = 2; usedKeys.has(key) || existingKeys.has(key); n++) key = `${base}-${n}`;
            }
            if (usedKeys.has(key)) {
                return next(new AppError(400, 'fail', `Category ${i + 1} is a duplicate`), req, res, next);
            }
            usedKeys.add(key);

            const skuPrefix = String(input[i]?.skuPrefix || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
                || defaultSkuPrefix(label);
            cleaned.push({ key, label, skuPrefix });
        }
        if (!usedKeys.has(FALLBACK_CATEGORY_KEY)) {
            return next(new AppError(400, 'fail', 'The "Others" category can\'t be removed'), req, res, next);
        }

        // Removed categories: their products move to "Others".
        const removedKeys = existing.map((c: any) => c.key).filter((k: string) => !usedKeys.has(k));
        let movedProducts = 0;
        if (removedKeys.length) {
            const r = await Product.updateMany({ itemCategory: { $in: removedKeys } }, { $set: { itemCategory: FALLBACK_CATEGORY_KEY } });
            movedProducts = r.modifiedCount ?? r.nModified ?? 0;
        }

        await PlatformSettings.findOneAndUpdate(
            { key: ITEM_CATEGORIES_KEY },
            { itemCategories: cleaned },
            { upsert: true, new: true }
        );

        res.status(200).json({
            status: 'success',
            data: { itemCategories: cleaned, removed: removedKeys, movedProducts }
        });
    } catch (error) {
        next(error);
    }
};

// POST /platform-settings/item-categories — ADD one category (appended to the
// end). Open to anyone who can edit products — a company account, a
// Supervisor, or the super admin — so a new category can be created from the
// product form. Renaming, reordering and removing stay super-admin only (PUT
// above), since the list is shared by every company.
const Employee = require('../models/employeeModel');
exports.addItemCategory = async (req: any, res: any, next: any) => {
    try {
        let allowed = false;
        if (req.user.actorKind === 'Company') {
            allowed = !!(await Company.findById(req.user.id).select('_id'));
        } else if (req.user.actorKind === 'Employee') {
            const employee = await Employee.findById(req.user.id).select('employeeType isActive');
            allowed = !!employee && employee.isActive && employee.employeeType === 'supervisor';
        }
        if (!allowed) {
            return next(new AppError(403, 'fail', 'You do not have permission to add categories'), req, res, next);
        }

        const label = String(req.body?.label || '').trim();
        if (!label) {
            return next(new AppError(400, 'fail', 'Category name is required'), req, res, next);
        }
        const existing = await getItemCategories();
        if (existing.length >= MAX_CATEGORIES) {
            return next(new AppError(400, 'fail', `At most ${MAX_CATEGORIES} categories`), req, res, next);
        }
        const same = existing.find((c: any) => c.label.toLowerCase() === label.toLowerCase());
        if (same) {
            // Already there — hand it back so the form can just select it.
            return res.status(200).json({ status: 'success', data: { category: same, itemCategories: existing, created: false } });
        }

        const keys = new Set(existing.map((c: any) => c.key));
        const base = slugify(label) || 'category';
        let key = base;
        for (let n = 2; keys.has(key); n++) key = `${base}-${n}`;
        const skuPrefix = String(req.body?.skuPrefix || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
            || defaultSkuPrefix(label);
        const category = { key, label, skuPrefix };
        const itemCategories = [...existing, category];

        await PlatformSettings.findOneAndUpdate(
            { key: ITEM_CATEGORIES_KEY },
            { itemCategories },
            { upsert: true, new: true }
        );
        res.status(201).json({ status: 'success', data: { category, itemCategories, created: true } });
    } catch (error) {
        next(error);
    }
};
