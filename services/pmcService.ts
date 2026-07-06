const PMC = require('../models/pmcModel');
const PmcIdentifier = require('../models/pmcIdentifierModel');
const ProductIdentifier = require('../models/productIdentifierModel');
const AppError = require('../utils/appError');
const { SOURCE_TYPES } = require('../utils/pmcConstants');
const { parseGs1 } = require('../utils/gs1');

const CODE_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// Short, human-readable code (e.g. PMC-8K3QF7XR2N). Not derived from Mongo's
// _id on purpose — companies print/display this, and it should read as an
// intentional product code rather than a database key.
const generatePmcCode = () => {
    let suffix = '';
    for (let i = 0; i < 11; i++) {
        suffix += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    return `PMC-${suffix}`;
};

/**
 * Find-or-create the canonical PMC for a physical item, given one identifier
 * captured for it (whatever format that identifier is in).
 *
 * Resolution rules:
 *  - If this exact (source_type, raw_value) was seen before, return its PMC.
 *    Re-scanning the same physical code is always idempotent.
 *  - Otherwise, if qrcode_id is given (the item was minted through this
 *    platform) and a PMC already exists for (product_id, qrcode_id) — e.g. a
 *    second identifier (an NFC tag) is being linked to an item that already
 *    has a PMC from its printed QR — attach the new identifier to that PMC
 *    instead of creating a second one.
 *  - Otherwise create a new PMC (covers both: first-ever identifier for a
 *    minted item, and an externally captured identifier for an item that was
 *    never minted through this platform at all).
 *
 * Cross-type matching (recognizing that a GS1 DL QR and an RFID EPC encode
 * the *same* GTIN+serial) is intentionally not handled here yet — that needs
 * the GS1 element parser. Until then, each source_type+raw_value pair is its
 * own identity unless explicitly linked via qrcode_id.
 */
const resolvePmc = async ({ product_id, company_id, source_type, raw_value, qrcode_id, gs1 }: {
    product_id: any;
    company_id: any;
    source_type: string;
    raw_value: string;
    qrcode_id?: number | null;
    gs1?: { gtin?: string; batchLot?: string; serial?: string; expiry?: string };
}) => {
    if (!product_id || !company_id) {
        throw new AppError(400, 'fail', 'product_id and company_id are required to resolve a PMC');
    }
    if (!SOURCE_TYPES.includes(source_type)) {
        throw new AppError(400, 'fail', `source_type must be one of: ${SOURCE_TYPES.join(', ')}`);
    }
    const normalizedRawValue = String(raw_value || '').trim();
    if (!normalizedRawValue) {
        throw new AppError(400, 'fail', 'raw_value is required to resolve a PMC');
    }

    const existingIdentifier = await PmcIdentifier.findOne({ source_type, raw_value: normalizedRawValue });
    if (existingIdentifier) {
        return PMC.findById(existingIdentifier.pmc_id);
    }

    // Auto-parse when the caller didn't already supply GS1 elements (e.g. the
    // /pmc/lookup path parses once to find the product, then hands the result
    // straight through — this covers direct callers like mint()/scan that
    // never parse at all).
    const effectiveGs1 = gs1 || parseGs1(normalizedRawValue) || undefined;

    const normalizedQrcodeId = qrcode_id != null && Number.isFinite(Number(qrcode_id)) ? Number(qrcode_id) : null;

    let pmc = normalizedQrcodeId != null
        ? await PMC.findOne({ product_id, qrcode_id: normalizedQrcodeId })
        : null;

    if (!pmc) {
        // Extremely unlikely to collide (36^11 space), but retry once on the
        // unique-index race just in case two requests generate the same code.
        for (let attempt = 0; attempt < 3 && !pmc; attempt++) {
            try {
                pmc = await PMC.create({
                    product_id,
                    company_id,
                    qrcode_id: normalizedQrcodeId,
                    pmc_code: generatePmcCode()
                });
            } catch (error: any) {
                if (error?.code !== 11000 || attempt === 2) {
                    throw error;
                }
            }
        }
    }

    try {
        await PmcIdentifier.create({
            pmc_id: pmc._id,
            source_type,
            raw_value: normalizedRawValue,
            gs1: effectiveGs1
        });
    } catch (error: any) {
        // Another request linked this exact identifier in the tiny window
        // between our findOne and this create — that's fine, it resolved to
        // a PMC either way. Anything else is a real failure.
        if (error?.code !== 11000) {
            throw error;
        }
    }

    return pmc;
};

/**
 * Find which product an externally captured identifier belongs to, using the
 * admin-curated ProductIdentifier mapping. Tries an exact raw-value match
 * first (needed for NFC/RFID tag IDs, which aren't GS1-shaped at all), then
 * falls back to matching on the parsed GTIN (covers a barcode/GS1 DL printed
 * slightly differently than however the company registered it — same
 * product, different string). Returns null when nobody has registered this
 * identifier yet.
 */
const lookupProductForIdentifier = async (source_type: string, raw_value: string) => {
    const normalizedRawValue = String(raw_value || '').trim();
    if (!normalizedRawValue) return null;

    const exact = await ProductIdentifier.findOne({ raw_value: normalizedRawValue });
    if (exact) return exact;

    const gs1 = parseGs1(normalizedRawValue);
    if (gs1?.gtin) {
        const byGtin = await ProductIdentifier.findOne({ gtin: gs1.gtin });
        if (byGtin) return byGtin;
    }

    return null;
};

module.exports = { resolvePmc, generatePmcCode, lookupProductForIdentifier };
