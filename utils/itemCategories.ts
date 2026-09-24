const PlatformSettings = require('../models/platformSettingsModel');

// Product item categories — platform-wide, managed by the super admin
// (Products page > Manage Categories). `key` is what Product.itemCategory
// stores and never changes once created (so renaming a category keeps every
// product on it); `skuPrefix` seeds auto-generated SKU/style numbers.
const ITEM_CATEGORIES_KEY = 'itemCategories';
// The fallback category — always present, can't be removed; products of a
// removed category move here.
const FALLBACK_CATEGORY_KEY = 'others';

const DEFAULT_ITEM_CATEGORIES = [
    { key: 'denim', label: 'Denim', skuPrefix: 'DNM' },
    { key: 'tops', label: 'Tops (T-Shirts / Knit)', skuPrefix: 'TSH' },
    { key: 'bottoms', label: 'Bottoms', skuPrefix: 'BOT' },
    { key: 'outerwear', label: 'Outerwear', skuPrefix: 'OUT' },
    { key: FALLBACK_CATEGORY_KEY, label: 'Others', skuPrefix: 'OTH' },
];

// Upserts the defaults on first read, so there's always a list without a
// manual seed step (same pattern as the consumer location steps).
const getItemCategories = async () => {
    let doc = await PlatformSettings.findOne({ key: ITEM_CATEGORIES_KEY }).lean();
    if (!doc || !Array.isArray(doc.itemCategories) || !doc.itemCategories.length) {
        doc = await PlatformSettings.findOneAndUpdate(
            { key: ITEM_CATEGORIES_KEY },
            { itemCategories: DEFAULT_ITEM_CATEGORIES },
            { upsert: true, new: true }
        ).lean();
    }
    return (doc.itemCategories || []).map((c: any) => ({ key: c.key, label: c.label, skuPrefix: c.skuPrefix }));
};

const slugify = (value: string) => String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

// e.g. "Knitwear" -> "KNI"
const defaultSkuPrefix = (label: string) => {
    const letters = String(label || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return (letters.slice(0, 3) || 'CAT').padEnd(3, 'X');
};

module.exports = {
    ITEM_CATEGORIES_KEY,
    FALLBACK_CATEGORY_KEY,
    DEFAULT_ITEM_CATEGORIES,
    getItemCategories,
    slugify,
    defaultSkuPrefix,
};
