// Parses the identifier formats companies actually put on physical goods,
// from most to least structured:
//   1. GS1 Digital Link URL   — e.g. https://id.gs1.org/01/09506000134352/21/12345?17=251231
//   2. Bracketed AI element string — e.g. (01)09506000134352(21)12345(17)251231
//   3. Plain GTIN/EAN/UPC number — e.g. 9506000134352 (what a bare 1D barcode scans as)
//
// (3) is the important fallback for "not every company follows GS1 Digital
// Link" — most 1D barcodes are just a bare GTIN with no batch/serial/expiry
// at all, which also means they can't distinguish two physical units of the
// same product. parseGs1() reports that honestly by leaving `serial` blank
// rather than inventing one.
//
// AI (Application Identifier) reference used here: 01=GTIN, 10=batch/lot,
// 21=serial, 17=expiry (YYMMDD). Full GS1-128 parsing of concatenated,
// variable-length AI strings (FNC1 separators) is intentionally out of scope
// — the DL and bracketed forms cover the non-DL fallback this needs to
// demonstrate, and can be extended here without touching callers.

const AI_AFTER_GS1_ORG_PATH = /\/01\/(\d{8,14})(?:\/21\/([^/?#]+))?/i;

const normalizeGtin = (raw: string) => {
    const digits = String(raw || '').replace(/\D/g, '');
    if (!digits) return '';
    // Normalize to GTIN-14 (left-pad) so a product's GTIN-8/12/13/14 variants
    // all resolve to the same value.
    return digits.padStart(14, '0');
};

const parseDigitalLinkUrl = (value: string) => {
    let url: any;
    try {
        url = new URL(value);
    } catch (error) {
        return null;
    }

    const pathMatch = url.pathname.match(AI_AFTER_GS1_ORG_PATH);
    if (!pathMatch) return null;

    return {
        gtin: normalizeGtin(pathMatch[1]),
        serial: pathMatch[2] ? decodeURIComponent(pathMatch[2]) : '',
        batchLot: url.searchParams.get('10') || '',
        expiry: url.searchParams.get('17') || ''
    };
};

const parseBracketedElementString = (value: string) => {
    const matches = [...String(value).matchAll(/\((\d{2,4})\)([^(]+)/g)];
    if (!matches.length) return null;

    const AI_MAP: any = { '01': 'gtin', '10': 'batchLot', '21': 'serial', '17': 'expiry' };
    const result: any = { gtin: '', batchLot: '', serial: '', expiry: '' };
    let foundKnownAi = false;

    for (const match of matches) {
        const key = AI_MAP[match[1]];
        if (!key) continue;
        foundKnownAi = true;
        result[key] = key === 'gtin' ? normalizeGtin(match[2].trim()) : match[2].trim();
    }

    return foundKnownAi ? result : null;
};

const parsePlainGtin = (value: string) => {
    const digits = String(value || '').trim();
    // EAN-8, UPC-A/EAN-12, EAN-13, GTIN-14 — a bare numeric barcode scan.
    if (!/^\d{8}$|^\d{12,14}$/.test(digits)) return null;
    return { gtin: normalizeGtin(digits), batchLot: '', serial: '', expiry: '' };
};

const parseGs1 = (rawValue: string) => {
    const value = String(rawValue || '').trim();
    if (!value) return null;

    return parseDigitalLinkUrl(value) || parseBracketedElementString(value) || parsePlainGtin(value);
};

module.exports = { parseGs1 };
