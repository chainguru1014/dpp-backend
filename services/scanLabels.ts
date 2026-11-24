// Scan labels: one small picture per product, the card the app shows under
// the camera when a code is read (brand in serif capitals, the brand's
// tagline, the product's name), plus an index of which codes belong to
// which product. Both are static files:
//
//   GET /labels/p-<productId>.png     the label (1020 x 300, PNG)
//   GET /labels/index.json            { products: { <id>: { v, n, b, t } },
//                                       gtins: { <gtin>: <id> },
//                                       codes: { <printed barcode / GS1 link>: <id> } }
//
// The scan and capture pages read the product id straight from a code (our
// QR links carry it; barcodes are looked up in the index) and show the label
// picture: if it exists, the code is one of ours. No product API call is
// needed to recognise a code; only pressing Scan / Capture saves a log.
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

        const products = await Product.find({ is_deleted: { $ne: true } }).select('name brandInfo company_id gtin').lean();
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
            index.products[id] = { v, n: name, b: brand, t: tagline };
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
            const m = f.match(/^p-([a-f0-9]{24})\.png$/);
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

module.exports = { rebuild, schedule, start, watchSchema, drawLabel, labelsDir };
