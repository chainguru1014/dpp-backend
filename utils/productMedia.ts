const toStringArray = (value: any): string[] => {
    if (value == null) {
        return [];
    }

    if (Array.isArray(value)) {
        return value.flatMap((item: any) => toStringArray(item));
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed ? [trimmed] : [];
    }

    if (typeof value === 'object') {
        return Object.values(value).flatMap((item: any) => toStringArray(item));
    }

    return [];
};

const toArray = (value: any): any[] => {
    if (value == null) {
        return [];
    }
    if (Array.isArray(value)) {
        return value;
    }
    if (typeof value === 'object') {
        return Object.values(value);
    }
    return [value];
};

const normalizeProductMedia = (productDoc: any) => {
    if (!productDoc || typeof productDoc !== 'object') {
        return productDoc;
    }

    const normalized = { ...productDoc };
    normalized.images = toStringArray(productDoc.images);
    normalized.files = toStringArray(productDoc.files);
    normalized.videos = toArray(productDoc.videos);

    if (productDoc.warrantyAndGuarantee && typeof productDoc.warrantyAndGuarantee === 'object') {
        normalized.warrantyAndGuarantee = {
            ...productDoc.warrantyAndGuarantee,
            images: toStringArray(productDoc.warrantyAndGuarantee.images),
            files: toStringArray(productDoc.warrantyAndGuarantee.files),
            videos: toArray(productDoc.warrantyAndGuarantee.videos)
        };
    }

    if (productDoc.manualsAndCerts && typeof productDoc.manualsAndCerts === 'object') {
        normalized.manualsAndCerts = {
            ...productDoc.manualsAndCerts,
            images: toStringArray(productDoc.manualsAndCerts.images),
            files: toStringArray(productDoc.manualsAndCerts.files),
            videos: toArray(productDoc.manualsAndCerts.videos)
        };
    }

    return normalized;
};

module.exports = { normalizeProductMedia, toStringArray, toArray };
