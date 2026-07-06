const mongoose = require('mongoose');
const PMC = require('../models/pmcModel');
const PmcIdentifier = require('../models/pmcIdentifierModel');
const Product = require('../models/productModel');
const { resolvePmc, lookupProductForIdentifier } = require('../services/pmcService');
const { normalizeProductMedia } = require('../utils/productMedia');
const { SOURCE_TYPES } = require('../utils/pmcConstants');

// Find-or-create the PMC for a captured identifier. This is the endpoint the
// app calls once it can scan barcode/NFC/RFID/GS1 Digital Link — today it's
// also called internally by mint() (source_type 'qr') and by the QR scan
// flow (qrcodeController.getPublicProductPayload) so every item gets a PMC
// regardless of which identifier reaches it first.
exports.resolve = async (req: any, res: any, next: any) => {
    try {
        const { product_id, company_id, source_type, raw_value, qrcode_id, gs1 } = req.body || {};

        const pmc = await resolvePmc({ product_id, company_id, source_type, raw_value, qrcode_id, gs1 });

        res.status(200).json({
            status: 'success',
            data: pmc
        });
    } catch (error) {
        next(error);
    }
};

// Public endpoint for a scan that carries no product_id at all — a raw
// barcode, an NFC tag UID, an RFID EPC. Unlike resolve() above, the caller
// doesn't know which product this belongs to; we find out via the
// admin-curated ProductIdentifier mapping (see productIdentifierController)
// and 404 if nobody has registered this identifier yet.
exports.lookup = async (req: any, res: any, next: any) => {
    try {
        const { source_type, raw_value } = req.body || {};

        if (!SOURCE_TYPES.includes(source_type)) {
            return res.status(400).json({ status: 'fail', message: `source_type must be one of: ${SOURCE_TYPES.join(', ')}` });
        }
        const normalizedRawValue = String(raw_value || '').trim();
        if (!normalizedRawValue) {
            return res.status(400).json({ status: 'fail', message: 'raw_value is required' });
        }

        const mapping = await lookupProductForIdentifier(source_type, normalizedRawValue);
        if (!mapping) {
            return res.status(404).json({
                status: 'fail',
                message: 'This identifier has not been registered to a product yet'
            });
        }

        const product = await Product.findById(mapping.product_id);
        if (!product) {
            return res.status(404).json({ status: 'fail', message: 'Registered product no longer exists' });
        }

        const pmc = await resolvePmc({
            product_id: mapping.product_id,
            company_id: mapping.company_id,
            source_type,
            raw_value: normalizedRawValue
        });

        res.status(200).json({
            status: 'success',
            data: {
                ...normalizeProductMedia(product?._doc || {}),
                pmc_code: pmc?.pmc_code || null
            },
            type: 'Product'
        });
    } catch (error) {
        next(error);
    }
};

const getPmcWithIdentifiers = async (pmc: any) => {
    if (!pmc) return null;
    const identifiers = await PmcIdentifier.find({ pmc_id: pmc._id }).sort({ createdAt: 1 });
    return { ...pmc.toObject(), identifiers };
};

exports.getByCode = async (req: any, res: any, next: any) => {
    try {
        const pmc = await PMC.findOne({ pmc_code: req.params.code });
        if (!pmc) {
            return res.status(404).json({ status: 'fail', message: 'PMC not found' });
        }

        res.status(200).json({
            status: 'success',
            data: await getPmcWithIdentifiers(pmc)
        });
    } catch (error) {
        next(error);
    }
};

exports.getByItem = async (req: any, res: any, next: any) => {
    try {
        const { productId, qrcodeId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(String(productId))) {
            return res.status(400).json({ status: 'fail', message: 'Invalid productId' });
        }

        const pmc = await PMC.findOne({ product_id: productId, qrcode_id: Number(qrcodeId) });
        if (!pmc) {
            return res.status(404).json({ status: 'fail', message: 'PMC not found for this item' });
        }

        res.status(200).json({
            status: 'success',
            data: await getPmcWithIdentifiers(pmc)
        });
    } catch (error) {
        next(error);
    }
};
