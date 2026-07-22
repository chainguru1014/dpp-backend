const ProductIdentifier = require('../models/productIdentifierModel');
const PmcIdentifier = require('../models/pmcIdentifierModel');
const PMC = require('../models/pmcModel');
const AppError = require('../utils/appError');
const { SOURCE_TYPES } = require('../utils/pmcConstants');
const { parseGs1 } = require('../utils/gs1');
const { resolvePmc } = require('../services/pmcService');

// Admin registers a barcode/GTIN (or an NFC/RFID tag ID) against a product
// ahead of time, so a later scan of that identifier — by anyone, not just
// through this platform's own minted QR codes — can resolve to a product.
exports.register = async (req: any, res: any, next: any) => {
    try {
        const { product_id, company_id, source_type, raw_value, note } = req.body || {};

        if (!product_id || !company_id) {
            return next(new AppError(400, 'fail', 'product_id and company_id are required'));
        }
        if (!SOURCE_TYPES.includes(source_type)) {
            return next(new AppError(400, 'fail', `source_type must be one of: ${SOURCE_TYPES.join(', ')}`));
        }
        const normalizedRawValue = String(raw_value || '').trim();
        if (!normalizedRawValue) {
            return next(new AppError(400, 'fail', 'raw_value is required'));
        }

        const gs1 = parseGs1(normalizedRawValue);

        const doc = await ProductIdentifier.create({
            product_id,
            company_id,
            source_type,
            raw_value: normalizedRawValue,
            gtin: gs1?.gtin || '',
            note: note || ''
        });

        // Mint the PMC immediately (rather than waiting for the first scan) so
        // the admin panel can show a PMC code for an identifier right after
        // registering it — resolvePmc() is idempotent, so a later real scan
        // of this same identifier just returns this same PMC.
        let pmc_code = null;
        try {
            const pmc = await resolvePmc({ product_id, company_id, source_type, raw_value: normalizedRawValue, gs1 });
            pmc_code = pmc?.pmc_code || null;
        } catch (pmcError) {
            console.error('PMC resolution failed for identifier registration:', pmcError);
        }

        res.status(200).json({ status: 'success', data: { ...doc.toObject(), pmc_code } });
    } catch (error: any) {
        if (error?.code === 11000) {
            return next(new AppError(409, 'fail', 'This identifier is already registered to a product'));
        }
        next(error);
    }
};

exports.listForProduct = async (req: any, res: any, next: any) => {
    try {
        const { product_id } = req.query || {};
        if (!product_id) {
            return next(new AppError(400, 'fail', 'product_id is required'));
        }

        const docs = await ProductIdentifier.find({ product_id }).sort({ createdAt: -1 });

        // Batch-attach each identifier's PMC code (if one has been resolved for
        // it yet — either at registration time above, or by a real scan).
        const pmcIdentifiers = await PmcIdentifier.find({
            raw_value: { $in: docs.map((d: any) => d.raw_value) }
        });
        const pmcIds = [...new Set(pmcIdentifiers.map((pi: any) => String(pi.pmc_id)))];
        const pmcs = await PMC.find({ _id: { $in: pmcIds } });
        const pmcCodeById = new Map(pmcs.map((pmc: any) => [String(pmc._id), pmc.pmc_code]));
        const pmcCodeByIdentifier = new Map(
            pmcIdentifiers.map((pi: any) => [`${pi.source_type}:${pi.raw_value}`, pmcCodeById.get(String(pi.pmc_id)) || null])
        );

        const enriched = docs.map((doc: any) => ({
            ...doc.toObject(),
            pmc_code: pmcCodeByIdentifier.get(`${doc.source_type}:${doc.raw_value}`) || null
        }));

        res.status(200).json({ status: 'success', data: enriched });
    } catch (error) {
        next(error);
    }
};

exports.remove = async (req: any, res: any, next: any) => {
    try {
        const doc = await ProductIdentifier.findByIdAndDelete(req.params.id);
        if (!doc) {
            return next(new AppError(404, 'fail', 'No identifier mapping found with that id'));
        }
        res.status(200).json({ status: 'success', data: null });
    } catch (error) {
        next(error);
    }
};
