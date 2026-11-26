// Scan labels: one small picture per product, the card the app shows under
// the camera when a code is read (brand in serif capitals, the brand's
// tagline, the product's name), plus an index of which codes belong to
// which product. Both are static files:
//
//   GET /labels/p-<productId>.png     the label (1020 x 300, PNG)
//   GET /labels/m-<productId>.jpg     the product's main photo (900 px, JPEG)
//   GET /labels/c-<productId>.jpg     the product card (900 x 1188, JPEG):
//                                     main photo, brand, name and up to four
//                                     facts (Genuine, Made in, CO2e, Repairable);
//                                     the app's product page shows only this
//   GET /labels/index.json            { products: { <id>: { v, n, b, t, m, c } },
//                                       gtins: { <gtin>: <id> },
//                                       codes: { <printed barcode / GS1 link>: <id> } }
//
// The scan and capture pages read the product id straight from a code (our
// QR links carry it; barcodes are looked up in the index) and show the label
// picture: if it exists, the code is one of ours. No product API call is
// needed to recognise a code; only pressing Scan / Capture saves a log.
//
// The main photo (m-<id>.jpg, version m = hash of the photo's file name,
// size and date) lets the app show the product page after Scan straight
// from the code, with no product API call. A new product or a changed first
// photo gets a new picture and version on the next rebuild. A photo that is
// a web address (not one of our uploads) is listed as mu instead.
//
// Labels are rebuilt shortly after products, brands or registered codes
// change (model hooks call schedule()), and every 10 minutes as a safety net
// (company titles, edits made outside the app). Only labels whose text
// changed are drawn again. The server has no system fonts, so text is turned
// into outlines with opentype.js and bundled OFL fonts (assets/fonts).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

// Bump when the drawing changes: every label is drawn again.
const DESIGN = 1;
// Bump when the main photos' size / quality changes.
const MAIN_DESIGN = 1;
// Bump when the product card's drawing changes.
const CARD_DESIGN = 1;
const W = 1020;
const H = 300;
const PAD_X = 54;
const BRAND_BLUE = '#1b4f72';
const INK = '#1c1c1e';
const SECONDARY = '#5f6b78';
const BORDER = '#d5dae1';

// backend/assets and backend/vendor, from dist/services or services.
const findDir = (name: string) => {
    const candidates = [
        path.resolve(__dirname, '..', '..', name),
        path.resolve(__dirname, '..', name),
        path.resolve(process.cwd(), name),
    ];
    return candidates.find((d: string) => fs.existsSync(d)) || candidates[0];
};

let fonts: { serif: any; sans: any } | null = null;
const loadFonts = () => {
    if (fonts) return fonts;
    const opentype = require(path.join(findDir('vendor'), 'opentype.min.js'));
    const dir = path.join(findDir('assets'), 'fonts');
    const load = (file: string) => {
        const buf = fs.readFileSync(path.join(dir, file));
        return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    };
    fonts = { serif: load('Gelasio.ttf'), sans: load('NotoSans.ttf') };
    return fonts;
};

// Text as SVG outlines: one line, letter spacing in px, kerning on.
const textLine = (font: any, text: string, size: number, spacing: number) => {
    const glyphs = font.stringToGlyphs(text);
    const scale = size / font.unitsPerEm;
    let x = 0;
    const parts: { g: any; x: number }[] = [];
    glyphs.forEach((g: any, i: number) => {
        if (i > 0) x += font.getKerningValue(glyphs[i - 1], g) * scale;
        parts.push({ g, x });
        x += g.advanceWidth * scale + (i < glyphs.length - 1 ? spacing : 0);
    });
    const width = x;
    return {
        width,
        path: (left: number, baseline: number) => parts.map((p) => p.g.getPath(left + p.x, baseline, size).toPathData(2)).join(''),
    };
};

// Largest size (down to `min`) at which the line fits the label's width.
const fitLine = (font: any, text: string, size: number, spacingRatio: number, min: number) => {
    let s = size;
    let line = textLine(font, text, s, s * spacingRatio);
    while (line.width > W - PAD_X * 2 && s > min) {
        s -= 2;
        line = textLine(font, text, s, s * spacingRatio);
    }
    return { line, size: s };
};

const escapeXml = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' } as any)[c]);

// The label: brand (or the product name when there is no brand) in serif
// capitals, the tagline in spaced capitals, the product name under them.
const drawLabel = async (brand: string, tagline: string, name: string) => {
    const { serif, sans } = loadFonts();
    const top = (brand || name).toUpperCase();
    const rows: { line: any; size: number; color: string; gap: number }[] = [];
    const b = fitLine(serif, top, 90, 0.05, 40);
    rows.push({ line: b.line, size: b.size, color: BRAND_BLUE, gap: 0 });
    if (tagline) {
        const tl = fitLine(serif, tagline.toUpperCase(), 36, 0.25, 20);
        rows.push({ line: tl.line, size: tl.size, color: INK, gap: 22 });
    }
    if (brand && name) {
        const n = fitLine(sans, name, 45, 0, 24);
        rows.push({ line: n.line, size: n.size, color: SECONDARY, gap: 34 });
    }
    // Rows by cap height (~0.72 of the size) for an even vertical centre.
    const heights = rows.map((r) => r.size * 0.74);
    const total = heights.reduce((a, h, i) => a + h + rows[i].gap, 0);
    let y = (H - total) / 2;
    const paths = rows.map((r, i) => {
        y += r.gap + heights[i];
        return `<path fill="${r.color}" d="${r.line.path((W - r.line.width) / 2, y)}"/>`;
    }).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
        + `<rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" fill="#ffffff" stroke="${BORDER}" stroke-width="3"/>`
        + `<title>${escapeXml([brand, tagline, name].filter(Boolean).join(' - '))}</title>${paths}</svg>`;
    return sharp(Buffer.from(svg)).png({ compressionLevel: 9, palette: true }).toBuffer();
};

// ---- The product card (client design 2026-11-26, "result first") ----
// The main photo on top, then the brand in spaced capitals, the product's
// name, and its facts as rounded cards two by two: Genuine (every product
// with our code is a registered original), Made in <country>, its carbon
// footprint and Repairable / Recyclable. Drawn when a product is saved.
const CARD_W = 900;
const CARD_PHOTO_H = 760;
const CARD_PAD = 44;
const CHIP_GAP = 22;
const CHIP_H = 96;
const CHIP_BG = '#f0f2f5';
const GENUINE_BG = '#e3edf6';

// Stroke icons on a 24-unit grid.
const CHIP_ICONS: Record<string, string> = {
    shield: '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/>',
    pin: '<path d="M12 21s-6-5.5-6-11a6 6 0 0112 0c0 5.5-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>',
    leaf: '<path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14z"/><path d="M5 19l7-7"/>',
    pencil: '<path d="M4 20l1-4L16 5l3 3L8 19z"/><path d="M14 7l3 3"/>',
    recycle: '<path d="M7 19H4l3-5"/><path d="M17 19h3l-3-5"/><path d="M9 6l3-3 3 3"/><path d="M8 13l4-7 4 7"/>',
};

const countryOf = (tr: any) => {
    const explicit = String(tr?.originCountry || '').trim();
    if (explicit) return explicit;
    const parts = String(tr?.madeIn || '').split(',').map((x: string) => x.trim()).filter(Boolean);
    return parts[parts.length - 1] || '';
};

// "38 kg CO₂e" + "0.56 kg CO₂e" -> "38.6 kg CO₂e" (kilograms only).
const co2Total = (tr: any) => {
    const vals = [tr?.co2Production, tr?.co2Transportation || tr?.route?.emissions]
        .map((v: any) => String(v || '').replace(',', '.'))
        .filter((v: string) => /kg/i.test(v) || /^\s*[\d.]+\s*$/.test(v))
        .map((v: string) => parseFloat((v.match(/[\d.]+/) || ['NaN'])[0]))
        .filter((n: number) => Number.isFinite(n));
    if (!vals.length) return '';
    const sum = vals.reduce((a: number, b: number) => a + b, 0);
    const shown = sum >= 100 ? Math.round(sum).toString() : (Math.round(sum * 10) / 10).toString();
    return `${shown} kg CO₂e`;
};

const cardFacts = (p: any) => {
    const { normalizeCircularity } = require('../utils/circularity');
    const facts: { icon: string; text: string; strong?: boolean }[] = [{ icon: 'shield', text: 'Genuine', strong: true }];
    const country = countryOf(p.traceabilityEsg);
    if (country) facts.push({ icon: 'pin', text: `Made in ${country}` });
    const co2 = co2Total(p.traceabilityEsg);
    if (co2) facts.push({ icon: 'leaf', text: co2 });
    const services = normalizeCircularity(p.circularity, p.disposal);
    // As the app's readyServices: on, and with a way to use it.
    const ready = (sv: any) => sv.enabled && !!(sv.url || sv.email || sv.phone || sv.acceptRequests || sv.steps.length);
    if (ready(services.repair)) facts.push({ icon: 'pencil', text: 'Repairable' });
    else if (ready(services.recycle)) facts.push({ icon: 'recycle', text: 'Recyclable' });
    return facts;
};

// Largest size (down to min) at which a line fits maxWidth.
const fitWidth = (font: any, text: string, size: number, spacingRatio: number, min: number, maxWidth: number) => {
    let sz = size;
    let line = textLine(font, text, sz, sz * spacingRatio);
    while (line.width > maxWidth && sz > min) {
        sz -= 1;
        line = textLine(font, text, sz, sz * spacingRatio);
    }
    return { line, size: sz };
};

const drawCard = async (photo: Buffer, brand: string, name: string, facts: { icon: string; text: string; strong?: boolean }[]) => {
    const { sans } = loadFonts();
    const rows = Math.ceil(facts.length / 2);
    const textTop = CARD_PHOTO_H;
    const kickerBase = textTop + 64;
    const nameBase = kickerBase + (brand ? 78 : 30);
    const chipsTop = nameBase + 46;
    const H = Math.round(chipsTop + rows * CHIP_H + Math.max(0, rows - 1) * CHIP_GAP + CARD_PAD);
    const chipW = (CARD_W - CARD_PAD * 2 - CHIP_GAP) / 2;
    let svg = '';
    if (brand) {
        const k = fitWidth(sans, brand.toUpperCase(), 28, 0.12, 18, CARD_W - CARD_PAD * 2);
        svg += `<path fill="${SECONDARY}" d="${k.line.path(CARD_PAD, kickerBase)}"/>`;
    }
    const n = fitWidth(sans, name, 54, 0, 30, CARD_W - CARD_PAD * 2);
    // Semibold: the regular outline with a thin stroke of the same colour.
    svg += `<path fill="${INK}" stroke="${INK}" stroke-width="${(n.size / 40).toFixed(2)}" stroke-linejoin="round" d="${n.line.path(CARD_PAD, nameBase)}"/>`;
    facts.forEach((fact, i) => {
        const x = CARD_PAD + (i % 2) * (chipW + CHIP_GAP);
        const y = chipsTop + Math.floor(i / 2) * (CHIP_H + CHIP_GAP);
        const color = fact.strong ? BRAND_BLUE : INK;
        svg += `<rect x="${x}" y="${y}" width="${chipW}" height="${CHIP_H}" rx="24" fill="${fact.strong ? GENUINE_BG : CHIP_BG}"/>`;
        const icon = 38;
        svg += `<g transform="translate(${x + 30} ${y + (CHIP_H - icon) / 2}) scale(${icon / 24})" fill="none" stroke="${color}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${CHIP_ICONS[fact.icon] || ''}</g>`;
        const t = fitWidth(sans, fact.text, 36, 0, 22, chipW - 30 - icon - 22 - 24);
        svg += `<path fill="${color}" ${fact.strong ? `stroke="${color}" stroke-width="0.8" ` : ''}d="${t.line.path(x + 30 + icon + 22, y + CHIP_H / 2 + t.size * 0.36)}"/>`;
    });
    const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${H}" viewBox="0 0 ${CARD_W} ${H}"><title>${escapeXml([brand, name].filter(Boolean).join(' - '))}</title>${svg}</svg>`;
    const top = await sharp(photo).rotate().resize(CARD_W, CARD_PHOTO_H, { fit: 'cover', position: sharp.strategy.attention }).toBuffer();
    return sharp({ create: { width: CARD_W, height: H, channels: 3, background: '#ffffff' } })
        .composite([{ input: top, top: 0, left: 0 }, { input: Buffer.from(overlay), top: 0, left: 0 }])
        .jpeg({ quality: 84, mozjpeg: true })
        .toBuffer();
};

const readPhoto = async (first: string, uploads: string) => {
    if (/^https?:\/\//i.test(first)) {
        const r = await fetch(first);
        if (!r.ok) throw new Error(`photo ${r.status}`);
        return Buffer.from(await r.arrayBuffer());
    }
    return fs.readFileSync(path.join(uploads, first.replace(/^\/?(files\/)?/, '')));
};

const labelsDir = () => {
    // Served by app.ts from dist/uploads/labels (next to the other uploads).
    const dir = path.join(__dirname, '..', 'uploads', 'labels');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
};

const writeAtomic = (file: string, data: any) => {
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file);
};

let running: Promise<any> | null = null;
let again = false;

// Brings every label and the index up to date. Safe to call often.
const rebuild = async () => {
    if (running) { again = true; return running; }
    running = (async () => {
        const started = Date.now();
        const Product = require('../models/productModel');
        const Brand = require('../models/brandModel');
        const Company = require('../models/companyModel');
        const User = require('../models/userModel');
        const ProductIdentifier = require('../models/productIdentifierModel');
        const dir = labelsDir();
        const indexFile = path.join(dir, 'index.json');
        let previous: any = {};
        try { previous = JSON.parse(fs.readFileSync(indexFile, 'utf8')).products || {}; } catch (e) { /* first run */ }

        const products = await Product.find({ is_deleted: { $ne: true } }).select('name brandInfo company_id gtin images traceabilityEsg circularity disposal').lean();
        const uploads = path.join(dir, '..');
        const companyIds = Array.from(new Set(products.map((p: any) => String(p.company_id || '')).filter(Boolean)));
        const [brands, companies, users, identifiers] = await Promise.all([
            Brand.find({ company_id: { $in: companyIds } }).select('company_id nameKey tagline createdAt').sort({ createdAt: 1, _id: 1 }).lean(),
            Company.find({ _id: { $in: companyIds } }).select('title name').lean(),
            User.find({ _id: { $in: companyIds } }).select('title name').lean(),
            ProductIdentifier.find({ source_type: { $in: ['barcode', 'gs1dl'] } }).select('product_id raw_value gtin').lean(),
        ]);
        const companyOf: Record<string, any> = {};
        [...users, ...companies].forEach((c: any) => { companyOf[String(c._id)] = c; });

        const index: any = { generatedAt: new Date().toISOString(), design: DESIGN, products: {}, gtins: {}, codes: {} };
        let drawn = 0;
        for (const p of products) {
            const id = String(p._id);
            const companyId = String(p.company_id || '');
            const company = companyOf[companyId];
            const brand = String(p.brandInfo?.name || company?.name || '').trim();
            // Same tagline rule as the public product payload: the product's
            // brand row, else the company's first brand, else the company title.
            const key = String(p.brandInfo?.name || '').trim().toLowerCase();
            const ofCompany = brands.filter((b: any) => String(b.company_id) === companyId);
            const brandRow = (key && ofCompany.find((b: any) => b.nameKey === key)) || ofCompany[0];
            const tagline = String(brandRow?.tagline || '').trim() || String(company?.title || '').trim();
            const name = String(p.name || '').trim();
            const v = crypto.createHash('sha1').update(JSON.stringify([DESIGN, brand, tagline, name])).digest('hex').slice(0, 10);
            const file = path.join(dir, `p-${id}.png`);
            if (previous[id]?.v !== v || !fs.existsSync(file)) {
                try {
                    writeAtomic(file, await drawLabel(brand, tagline, name));
                    drawn += 1;
                } catch (error) {
                    console.error(`Scan label for ${id} failed:`, error);
                    continue;
                }
            }
            const entry: any = { v, n: name, b: brand, t: tagline };
            // The main photo (first image).
            const first = (Array.isArray(p.images) ? p.images : []).map((x: any) => String(typeof x === 'string' ? x : x?.url || '').trim()).find(Boolean) || '';
            if (/^https?:\/\//i.test(first)) {
                entry.mu = first;
            } else if (first && /^[\w.-]+$/.test(first.replace(/^\/?(files\/)?/, ''))) {
                const src = path.join(uploads, first.replace(/^\/?(files\/)?/, ''));
                try {
                    const st = fs.statSync(src);
                    const m = crypto.createHash('sha1').update(JSON.stringify([MAIN_DESIGN, first, st.size, st.mtimeMs])).digest('hex').slice(0, 10);
                    const mainFile = path.join(dir, `m-${id}.jpg`);
                    if (previous[id]?.m !== m || !fs.existsSync(mainFile)) {
                        writeAtomic(mainFile, await sharp(src).rotate().resize(900, 1125, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toBuffer());
                        drawn += 1;
                    }
                    entry.m = m;
                } catch (error) {
                    // No such file (yet): the app falls back to the product API.
                }
            }
            // The product card (its own version: photo, words and facts).
            if (first) {
                const facts = cardFacts(p);
                const c = crypto.createHash('sha1').update(JSON.stringify([CARD_DESIGN, first, entry.m || '', brand, name, facts])).digest('hex').slice(0, 10);
                const cardFile = path.join(dir, `c-${id}.jpg`);
                try {
                    if (previous[id]?.c !== c || !fs.existsSync(cardFile)) {
                        writeAtomic(cardFile, await drawCard(await readPhoto(first, uploads), brand, name, facts));
                        drawn += 1;
                    }
                    entry.c = c;
                } catch (error) {
                    console.error(`Product card for ${id} failed:`, (error as any)?.message || error);
                }
            }
            index.products[id] = entry;
            if (p.gtin) index.gtins[String(p.gtin)] = id;
        }
        identifiers.forEach((it: any) => {
            const id = String(it.product_id || '');
            if (!index.products[id]) return;
            if (it.raw_value) index.codes[String(it.raw_value).trim()] = id;
            if (it.gtin && !index.gtins[String(it.gtin)]) index.gtins[String(it.gtin)] = id;
        });
        // Labels of deleted products go (their codes stop being recognised).
        fs.readdirSync(dir).forEach((f: string) => {
            const m = f.match(/^[pmc]-([a-f0-9]{24})\.(png|jpg)$/);
            if (m && !index.products[m[1]]) fs.unlinkSync(path.join(dir, f));
        });
        writeAtomic(indexFile, JSON.stringify(index));
        if (drawn) console.log(`Scan labels: ${drawn} drawn, ${products.length} products, ${Date.now() - started} ms`);
        return index;
    })();
    try {
        return await running;
    } finally {
        running = null;
        if (again) { again = false; schedule(); }
    }
};

let timer: any = null;
// Debounced rebuild: a burst of saves (an import, a brand rename touching
// many products) leads to one rebuild ~2 s after the last change.
const schedule = (delayMs = 2000) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
        timer = null;
        rebuild().catch((error: any) => console.error('Scan labels rebuild failed:', error));
    }, delayMs);
};

let started = false;
// Called once the database is connected: a first build, then every 10 min.
const start = () => {
    if (started) return;
    started = true;
    schedule(3000);
    setInterval(() => schedule(0), 10 * 60 * 1000);
};

// Mongoose middleware that keeps labels current; added to the Product, Brand
// and ProductIdentifier schemas (before their models are compiled).
const LABEL_HOOKS = ['save', 'insertMany', 'findOneAndUpdate', 'updateOne', 'updateMany', 'deleteOne', 'deleteMany', 'findOneAndDelete', 'findOneAndRemove', 'remove'];
const watchSchema = (schema: any) => {
    LABEL_HOOKS.forEach((hook) => {
        schema.post(hook, () => { if (started) schedule(); });
    });
};

module.exports = { rebuild, schedule, start, watchSchema, drawLabel, drawCard, cardFacts, labelsDir };
