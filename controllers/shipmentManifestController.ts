const ShipmentManifest = require('../models/shipmentManifestModel');
const InspectionRecord = require('../models/inspectionRecordModel');
const Product = require('../models/productModel');
const QRcode = require('../models/qrcodeModel');
const PmcIdentifier = require('../models/pmcIdentifierModel');
const PMC = require('../models/pmcModel');
const AppError = require('../utils/appError');
const { resolveCompanyScope } = require('../utils/companyScope');

const CODE_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const generateManifestCode = () => {
    let suffix = '';
    for (let i = 0; i < 10; i++) {
        suffix += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    return `SHIP-${suffix}`;
};

// Create a manifest: pick a product and an inclusive qrcode_id range (the
// "Items #1 to #100" shape from the brief). Validates every id in the range
// actually exists for that product — a manifest expecting units that were
// never minted would be unsatisfiable by definition.
exports.create = async (req: any, res: any, next: any) => {
    try {
        const scope = await resolveCompanyScope(req);
        if (!scope.allowed || !scope.canWrite) {
            return next(new AppError(403, 'fail', 'You do not have permission to create a shipment manifest'));
        }
        const { product_id, from_item, to_item, label } = req.body || {};
        const fromId = Number(from_item);
        const toId = Number(to_item);
        if (!product_id || !Number.isInteger(fromId) || !Number.isInteger(toId) || fromId < 1 || toId < fromId) {
            return next(new AppError(400, 'fail', 'product_id and a valid item range (from_item <= to_item) are required'));
        }
        if (toId - fromId + 1 > 5000) {
            return next(new AppError(400, 'fail', 'A single manifest can cover at most 5000 items'));
        }

        const product = await Product.findOne({ _id: product_id, is_deleted: { $ne: true } }).select('company_id name');
        if (!product || (scope.companyId && String(product.company_id) !== String(scope.companyId))) {
            return next(new AppError(404, 'fail', 'Product not found'));
        }

        const expectedIds: number[] = [];
        for (let id = fromId; id <= toId; id++) expectedIds.push(id);
        const existingCount = await QRcode.countDocuments({ product_id, qrcode_id: { $in: expectedIds } });
        if (existingCount !== expectedIds.length) {
            return next(new AppError(400, 'fail', `Only ${existingCount} of the ${expectedIds.length} requested items exist for this product — generate those QR codes first`));
        }

        let manifest = null;
        for (let attempt = 0; attempt < 3 && !manifest; attempt++) {
            try {
                manifest = await ShipmentManifest.create({
                    company_id: product.company_id,
                    manifest_code: generateManifestCode(),
                    product_id,
                    expected_qrcode_ids: expectedIds,
                    label: label || '',
                    created_by_employee_id: req.user?.actorKind === 'Employee' ? req.user.id : null
                });
            } catch (error: any) {
                if (error?.code !== 11000 || attempt === 2) throw error;
            }
        }

        res.status(201).json({ status: 'success', data: manifest });
    } catch (error) {
        next(error);
    }
};

// List manifests for the admin page — super admin sees every company's,
// a Supervisor sees only their own (resolveCompanyScope already encodes
// that split the same way every other admin-panel list endpoint does).
exports.list = async (req: any, res: any, next: any) => {
    try {
        const scope = await resolveCompanyScope(req);
        if (!scope.allowed) {
            return next(new AppError(403, 'fail', 'You do not have permission to view shipment manifests'));
        }
        const filter: any = {};
        if (scope.companyId) filter.company_id = scope.companyId;

        const manifests = await ShipmentManifest.find(filter)
            .sort({ createdAt: -1 })
            .limit(200)
            .populate('product_id', 'name images')
            .lean();

        res.status(200).json({ status: 'success', data: manifests });
    } catch (error) {
        next(error);
    }
};

exports.getById = async (req: any, res: any, next: any) => {
    try {
        const scope = await resolveCompanyScope(req);
        if (!scope.allowed) {
            return next(new AppError(403, 'fail', 'You do not have permission to view this shipment manifest'));
        }
        const manifest = await ShipmentManifest.findById(req.params.id).populate('product_id', 'name images');
        if (!manifest || (scope.companyId && String(manifest.company_id) !== String(scope.companyId))) {
            return next(new AppError(404, 'fail', 'Shipment manifest not found'));
        }
        res.status(200).json({ status: 'success', data: manifest });
    } catch (error) {
        next(error);
    }
};

// Past inspection attempts for one manifest, newest first — the audit trail
// behind its current status.
exports.history = async (req: any, res: any, next: any) => {
    try {
        const scope = await resolveCompanyScope(req);
        if (!scope.allowed) {
            return next(new AppError(403, 'fail', 'You do not have permission to view this shipment manifest'));
        }
        const manifest = await ShipmentManifest.findById(req.params.id).select('company_id');
        if (!manifest || (scope.companyId && String(manifest.company_id) !== String(scope.companyId))) {
            return next(new AppError(404, 'fail', 'Shipment manifest not found'));
        }
        const records = await InspectionRecord.find({ manifest_id: manifest._id }).sort({ createdAt: -1 });
        res.status(200).json({ status: 'success', data: records });
    } catch (error) {
        next(error);
    }
};

exports.remove = async (req: any, res: any, next: any) => {
    try {
        const scope = await resolveCompanyScope(req);
        if (!scope.allowed || !scope.canWrite) {
            return next(new AppError(403, 'fail', 'You do not have permission to delete a shipment manifest'));
        }
        const manifest = await ShipmentManifest.findById(req.params.id).select('company_id status');
        if (!manifest || (scope.companyId && String(manifest.company_id) !== String(scope.companyId))) {
            return next(new AppError(404, 'fail', 'Shipment manifest not found'));
        }
        await InspectionRecord.deleteMany({ manifest_id: manifest._id });
        await manifest.deleteOne();
        res.status(200).json({ status: 'success', data: null });
    } catch (error) {
        next(error);
    }
};

// Staff app: scan the manifest QR -> resolve to the full expected-item list.
// No auth required, same convention as /pmc/lookup and /rfid/* — called from
// the staff capture flow, not an admin session.
exports.lookupByCode = async (req: any, res: any, next: any) => {
    try {
        const code = String(req.params.code || '').trim().toUpperCase();
        if (!code) {
            return next(new AppError(400, 'fail', 'A manifest code is required'));
        }
        const manifest = await ShipmentManifest.findOne({ manifest_code: code }).populate('product_id');
        if (!manifest) {
            return next(new AppError(404, 'fail', 'No shipment manifest found for this code'));
        }
        res.status(200).json({ status: 'success', data: manifest });
    } catch (error) {
        next(error);
    }
};

// Resolves one scanned RFID EPC to the specific physical unit (qrcode_id) it
// was paired to, if any. Deliberately read-only (unlike resolvePmc, this
// never creates a PMC) — an inspection scan is checking existing pairings,
// not registering new ones. A tag that was only bulk-registered to a
// product in general (never paired to one unit via productIdentifierController.pair)
// has no qrcode_id and can't satisfy a specific expected item here.
async function resolveEpcToQrcodeId(epc: string): Promise<{ productId: string; qrcodeId: number } | null> {
    const identifier = await PmcIdentifier.findOne({ source_type: 'rfid', raw_value: epc });
    if (!identifier) return null;
    const pmc = await PMC.findById(identifier.pmc_id).select('product_id qrcode_id');
    if (!pmc || pmc.qrcode_id == null) return null;
    return { productId: String(pmc.product_id), qrcodeId: pmc.qrcode_id };
}

// The actual gate-scan comparison: every unique EPC the R700 collected
// during one scan session vs. the manifest's expected qrcode_ids.
exports.inspect = async (req: any, res: any, next: any) => {
    try {
        const manifest = await ShipmentManifest.findById(req.params.id);
        if (!manifest) {
            return next(new AppError(404, 'fail', 'Shipment manifest not found'));
        }
        const rawEpcs: string[] = Array.isArray(req.body?.scanned_epcs) ? req.body.scanned_epcs : [];
        const uniqueEpcs = [...new Set(rawEpcs.map((e) => String(e || '').trim()).filter(Boolean))];

        const expectedSet = new Set(manifest.expected_qrcode_ids);
        const matchedSet = new Set<number>();
        const unexpectedEpcs: string[] = [];

        for (const epc of uniqueEpcs) {
            const resolved = await resolveEpcToQrcodeId(epc);
            if (resolved && String(resolved.productId) === String(manifest.product_id) && expectedSet.has(resolved.qrcodeId)) {
                matchedSet.add(resolved.qrcodeId);
            } else {
                unexpectedEpcs.push(epc);
            }
        }

        const missingIds = manifest.expected_qrcode_ids.filter((id: number) => !matchedSet.has(id));
        const result = missingIds.length === 0 ? 'pass' : 'fail';

        const record = await InspectionRecord.create({
            manifest_id: manifest._id,
            company_id: manifest.company_id,
            inspected_by_employee_id: req.user?.actorKind === 'Employee' ? req.user.id : null,
            scanned_epcs: uniqueEpcs,
            matched_qrcode_ids: [...matchedSet],
            missing_qrcode_ids: missingIds,
            unexpected_epcs: unexpectedEpcs,
            result
        });

        manifest.status = result === 'pass' ? 'complete' : 'mismatch';
        manifest.latest_inspection_id = record._id;
        await manifest.save();

        res.status(200).json({ status: 'success', data: { manifest, inspection: record } });
    } catch (error) {
        next(error);
    }
};
