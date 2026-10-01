const mongoose = require('mongoose');
const Brand = require('../models/brandModel');
const Company = require('../models/companyModel');
const Product = require('../models/productModel');
const AppError = require('../utils/appError');
const { resolveCompanyScope } = require('../utils/companyScope');
const { normalizeDppTheme } = require('../utils/dppTheme');

// Brands: a company's brand details and product page design, one set per
// brand it sells under. The Brand page lists them, edits one at a time, and
// the shopper's product page asks for the design of a product's brand.

const DETAIL_FIELDS = ['detail', 'websiteUrl', 'logoUrl', 'coverUrl'];
const text = (value: any, max = 500) => String(value ?? '').trim().slice(0, max);
const keyOf = (name: any) => text(name, 120).toLowerCase();

const toResponse = (brand: any, companyName = '') => ({
    _id: brand._id,
    company_id: brand.company_id,
    companyName,
    name: brand.name,
    detail: brand.detail || '',
    websiteUrl: brand.websiteUrl || '',
    logoUrl: brand.logoUrl || '',
    coverUrl: brand.coverUrl || '',
    dppTheme: normalizeDppTheme(brand.dppTheme)
});

/**
 * A company that has never opened the Brand page has no Brand rows yet. Its
 * brands are then created from what it already has: the brand on each of its
 * products (one per distinct name), or the brand details / design it saved
 * before brands existed, or — with nothing at all — one brand named after
 * the company. Each starts with the company's previous design.
 */
const ensureBrandsForCompany = async (companyId: any) => {
    if (await Brand.exists({ company_id: companyId })) return;
    const company = await Company.findById(companyId).select('name brand dppTheme').lean();
    if (!company) return;

    const seeds = new Map<string, any>();
    const products = await Product.find({ company_id: companyId, is_deleted: { $ne: true }, 'brandInfo.name': { $gt: '' } })
        .sort({ _id: 1 }).select('brandInfo').lean();
    // Later products win, so the newest details of each brand are kept.
    products.forEach((p: any) => {
        const name = text(p.brandInfo?.name, 120);
        if (name) seeds.set(keyOf(name), { name, ...p.brandInfo });
    });
    const saved = company.brand || {};
    if (text(saved.name, 120)) seeds.set(keyOf(saved.name), { ...(seeds.get(keyOf(saved.name)) || {}), ...saved, name: text(saved.name, 120) });
    if (!seeds.size) seeds.set(keyOf(company.name), { name: text(company.name, 120) || 'My brand' });

    for (const [nameKey, seed] of seeds) {
        await Brand.create({
            company_id: companyId,
            name: seed.name,
            nameKey,
            detail: text(seed.detail, 1000),
            websiteUrl: text(seed.websiteUrl),
            logoUrl: text(seed.logoUrl),
            coverUrl: text(seed.coverUrl),
            dppTheme: company.dppTheme
        }).catch((error: any) => {
            // Two first visits at once: the other request created it.
            if (error?.code !== 11000) throw error;
        });
    }
};

// GET /brand — the brands the requester may see (a company: its own; the
// super admin: every company's, each with its company name).
exports.list = async (req: any, res: any, next: any) => {
    try {
        const scope = await resolveCompanyScope(req);
        if (!scope.allowed) {
            return next(new AppError(403, 'fail', 'You do not have permission to view brands'), req, res, next);
        }
        let companyIds: any[];
        if (scope.companyId) {
            companyIds = [scope.companyId];
        } else {
            // Super admin: every company, plus its own account (products it created itself).
            const ids = await Company.find({}).distinct('_id');
            companyIds = Array.from(new Set([...ids.map(String), String(req.user.id)]));
        }
        for (const id of companyIds) await ensureBrandsForCompany(id);

        const brands = await Brand.find(scope.companyId ? { company_id: scope.companyId } : {}).sort({ name: 1 }).lean();
        const companies = await Company.find({ _id: { $in: brands.map((b: any) => b.company_id) } }).select('name').lean();
        const names = new Map<string, string>(companies.map((c: any) => [String(c._id), c.name || '']));
        res.status(200).json({
            status: 'success',
            data: { brands: brands.map((b: any) => toResponse(b, names.get(String(b.company_id)) || '')), canWrite: scope.canWrite }
        });
    } catch (error) {
        next(error);
    }
};

// Loads a brand the requester may change, or sends the error and returns null.
const loadWritable = async (req: any, next: any) => {
    const scope = await resolveCompanyScope(req);
    if (!scope.allowed || !scope.canWrite) {
        next(new AppError(403, 'fail', 'Only a Supervisor or company admin may change brands'));
        return null;
    }
    const id = String(req.params.id || '');
    const brand = mongoose.Types.ObjectId.isValid(id) ? await Brand.findById(id) : null;
    if (!brand || (scope.companyId && String(brand.company_id) !== String(scope.companyId))) {
        next(new AppError(404, 'fail', 'Brand not found'));
        return null;
    }
    return brand;
};

// POST /brand { name, detail, websiteUrl, logoUrl, coverUrl, company_id? }
exports.create = async (req: any, res: any, next: any) => {
    try {
        const scope = await resolveCompanyScope(req);
        if (!scope.allowed || !scope.canWrite) {
            return next(new AppError(403, 'fail', 'Only a Supervisor or company admin may add brands'), req, res, next);
        }
        // A company adds to itself; the super admin says which company (or its own account).
        const requested = String(req.body?.company_id || '');
        const companyId = scope.companyId || (mongoose.Types.ObjectId.isValid(requested) ? requested : req.user.id);
        const name = text(req.body?.name, 120);
        if (!name) {
            return next(new AppError(400, 'fail', 'Please enter the brand name'), req, res, next);
        }
        await ensureBrandsForCompany(companyId);
        if (await Brand.exists({ company_id: companyId, nameKey: keyOf(name) })) {
            return next(new AppError(409, 'fail', `You already have a brand called "${name}"`), req, res, next);
        }
        const fields: any = { company_id: companyId, name, nameKey: keyOf(name) };
        DETAIL_FIELDS.forEach((key) => { fields[key] = text(req.body?.[key], key === 'detail' ? 1000 : 500); });
        const brand = await Brand.create(fields);
        res.status(200).json({ status: 'success', data: toResponse(brand) });
    } catch (error) {
        next(error);
    }
};

// PUT /brand/:id — details and/or design; only what the body carries changes.
exports.update = async (req: any, res: any, next: any) => {
    try {
        const brand = await loadWritable(req, next);
        if (!brand) return;
        const body = req.body || {};
        const set: any = {};
        if (body.name !== undefined) {
            const name = text(body.name, 120);
            if (!name) {
                return next(new AppError(400, 'fail', 'Please enter the brand name'), req, res, next);
            }
            if (keyOf(name) !== brand.nameKey && await Brand.exists({ company_id: brand.company_id, nameKey: keyOf(name) })) {
                return next(new AppError(409, 'fail', `You already have a brand called "${name}"`), req, res, next);
            }
            set.name = name;
            set.nameKey = keyOf(name);
        }
        DETAIL_FIELDS.forEach((key) => {
            if (body[key] !== undefined) set[key] = text(body[key], key === 'detail' ? 1000 : 500);
        });
        if (body.dppTheme !== undefined) set.dppTheme = normalizeDppTheme(body.dppTheme);
        const previousName = brand.name;
        const updated = await Brand.findByIdAndUpdate(brand._id, { $set: set }, { new: true });

        // Products are matched to their brand by name, so a renamed brand
        // takes its products with it.
        if (set.name && set.name !== previousName) {
            await Product.updateMany(
                { company_id: brand.company_id, 'brandInfo.name': previousName },
                { $set: { 'brandInfo.name': set.name } }
            );
        }
        res.status(200).json({ status: 'success', data: toResponse(updated) });
    } catch (error) {
        next(error);
    }
};

// DELETE /brand/:id — products keep the brand details they were saved with.
exports.remove = async (req: any, res: any, next: any) => {
    try {
        const brand = await loadWritable(req, next);
        if (!brand) return;
        if (await Brand.countDocuments({ company_id: brand.company_id }) <= 1) {
            return next(new AppError(400, 'fail', 'A company needs at least one brand. Rename this one instead.'), req, res, next);
        }
        await Brand.deleteOne({ _id: brand._id });
        res.status(200).json({ status: 'success', data: null });
    } catch (error) {
        next(error);
    }
};

/**
 * The design for a product of `companyId` sold under `brandName`: that
 * brand's own design, else the design the company saved before brands
 * existed, else the defaults. Never throws for a bad id.
 */
const themeForBrand = async (companyId: any, brandName: any) => {
    const id = String(companyId || '');
    if (!mongoose.Types.ObjectId.isValid(id)) return normalizeDppTheme(null);
    const nameKey = keyOf(brandName);
    const brand = nameKey ? await Brand.findOne({ company_id: id, nameKey }).select('dppTheme').lean() : null;
    if (brand) return normalizeDppTheme(brand.dppTheme);
    // No brand of that name: a company with a single brand uses that one.
    const only = await Brand.find({ company_id: id }).limit(2).select('dppTheme').lean();
    if (only.length === 1) return normalizeDppTheme(only[0].dppTheme);
    const company = await Company.findById(id).select('dppTheme').lean();
    return normalizeDppTheme(company?.dppTheme);
};

exports.themeForBrand = themeForBrand;
