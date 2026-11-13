const mongoose = require('mongoose');
const Brand = require('../models/brandModel');
const Company = require('../models/companyModel');
const Product = require('../models/productModel');

// One brand per company (decided 2026-11-13): every company registered on
// the admin site is a brand company. Its brand profile is its one Brand row
// (name, tagline, description, website, logo, cover, product page design),
// and every product of the company shows that brand. Products still carry a
// copy in product.brandInfo (older readers use it), kept in step from here.
// The platform's own super admin account is not a brand: its products keep
// whatever brand they were saved with.

const BRAND_INFO_KEYS = ['name', 'detail', 'websiteUrl', 'logoUrl', 'coverUrl'];
const text = (value: any, max = 500) => String(value ?? '').trim().slice(0, max);
const keyOf = (name: any) => text(name, 120).toLowerCase();

const isPlatformAccount = (company: any) => !company || company.role === 'super' || company.name === 'admin';

// The company's brand: its oldest Brand row (there is normally just one).
const brandOfCompany = async (companyId: any) => {
    const id = String(companyId || '');
    if (!mongoose.Types.ObjectId.isValid(id)) return null;
    return Brand.findOne({ company_id: id }).sort({ createdAt: 1, _id: 1 });
};

// The product copy of a brand. Empty brand fields keep the product's own
// value, so an unfinished brand profile never wipes a product's logo.
const brandInfoFor = (brand: any, current: any = {}) => {
    const info: any = {};
    BRAND_INFO_KEYS.forEach((key) => {
        const fromBrand = text(brand?.[key], key === 'detail' ? 1000 : 500);
        info[key] = fromBrand || text(current?.[key], key === 'detail' ? 1000 : 500);
    });
    return info;
};

/**
 * Sets body.brandInfo for a product of `companyId` from the company's brand.
 * The super admin's own products are left as sent. Returns nothing.
 */
const applyCompanyBrand = async (body: any, companyId: any, current: any = {}) => {
    const id = String(companyId?._id || companyId || '');
    if (!mongoose.Types.ObjectId.isValid(id)) return;
    const company = await Company.findById(id).select('name role').lean();
    if (isPlatformAccount(company)) return;
    let brand = await brandOfCompany(id);
    if (!brand) {
        brand = await Brand.create({ company_id: id, name: text(company.name, 120) || 'My brand', nameKey: keyOf(company.name) || 'my brand' })
            .catch(() => brandOfCompany(id));
    }
    body.brandInfo = brandInfoFor(brand, { ...(current || {}), ...(body.brandInfo || {}) });
};

// Copies the brand onto every product of its company (after the brand
// profile changes). Field by field, so empty brand fields change nothing.
const syncCompanyProducts = async (brand: any) => {
    if (!brand?.company_id) return 0;
    const company = await Company.findById(brand.company_id).select('name role').lean();
    if (isPlatformAccount(company)) return 0;
    const set: any = {};
    BRAND_INFO_KEYS.forEach((key) => {
        const value = text(brand[key], key === 'detail' ? 1000 : 500);
        if (value) set[`brandInfo.${key}`] = value;
    });
    if (!Object.keys(set).length) return 0;
    const r = await Product.updateMany({ company_id: brand.company_id, is_deleted: { $ne: true } }, { $set: set });
    return r?.modifiedCount ?? r?.nModified ?? 0;
};

/**
 * Once at server start: every brand company ends up with exactly one brand.
 * A company with several keeps the one most of its products use (ties: the
 * oldest); the others are copied to the `brandarchives` collection, then
 * removed. Empty fields of the kept brand are filled from the company's
 * newest product, then the brand is copied onto all its products. Safe to
 * run on every start.
 */
const consolidateBrands = async () => {
    const companies = await Company.find({}).select('name role').lean();
    let merged = 0;
    let synced = 0;
    for (const company of companies) {
        if (isPlatformAccount(company)) continue;
        const brands = await Brand.find({ company_id: company._id }).sort({ createdAt: 1, _id: 1 });
        if (!brands.length) continue;
        let keep = brands[0];
        if (brands.length > 1) {
            const counts = await Product.aggregate([
                { $match: { company_id: company._id, is_deleted: { $ne: true } } },
                { $group: { _id: { $toLower: { $trim: { input: { $ifNull: ['$brandInfo.name', ''] } } } }, n: { $sum: 1 } } },
            ]);
            const used = new Map<string, number>(counts.map((c: any) => [String(c._id), c.n]));
            keep = brands.reduce((best: any, b: any) => ((used.get(b.nameKey) || 0) > (used.get(best.nameKey) || 0) ? b : best), brands[0]);
            const others = brands.filter((b: any) => String(b._id) !== String(keep._id));
            await mongoose.connection.collection('brandarchives').insertMany(
                others.map((b: any) => ({ ...b.toObject(), archivedAt: new Date(), reason: 'one brand per company', keptBrandId: keep._id }))
            );
            await Brand.deleteMany({ _id: { $in: others.map((b: any) => b._id) } });
            merged += others.length;
        }
        // Fill the kept brand's empty fields from the newest product.
        const latest = await Product.findOne({ company_id: company._id, is_deleted: { $ne: true }, 'brandInfo.name': { $gt: '' } })
            .sort({ _id: -1 }).select('brandInfo').lean();
        const fill: any = {};
        ['detail', 'websiteUrl', 'logoUrl', 'coverUrl'].forEach((key) => {
            if (!text(keep[key]) && text(latest?.brandInfo?.[key])) fill[key] = text(latest.brandInfo[key], key === 'detail' ? 1000 : 500);
        });
        if (Object.keys(fill).length) keep = await Brand.findByIdAndUpdate(keep._id, { $set: fill }, { new: true });
        synced += await syncCompanyProducts(keep);
    }
    return { merged, synced };
};

module.exports = { brandOfCompany, brandInfoFor, applyCompanyBrand, syncCompanyProducts, consolidateBrands, isPlatformAccount, BRAND_INFO_KEYS };
