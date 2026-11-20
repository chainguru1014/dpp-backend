/* eslint-disable no-console */
// Demo data for presentations: 10 luxury products (watches and jewellery)
// with full passports, every code type, 60 days of shopper scans and 45 days
// of staff work records. Run on the server from the backend folder:
//   node scripts/seed-luxury-demo.js            (adds the data)
// Re-running skips products that already exist (matched by SKU).
// A backup of every touched collection is written first.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const D = (p) => require(path.join(__dirname, '..', 'dist', p));
const Product = D('models/productModel');
const QRcode = D('models/qrcodeModel');
const SecurityQRCode = D('models/securityQRCodeModel');
const ProductIdentifier = D('models/productIdentifierModel');
const ScanRecord = D('models/scanRecordModel');
const CaptureRecord = D('models/captureRecordModel');
const AlbumItem = D('models/albumItemModel');
const ProductReaction = D('models/productReactionModel');
const CartItem = D('models/cartItemModel');
const PMC = D('models/pmcModel');
const ProductHolding = D('models/productHoldingModel');
const { Counter } = D('models/counterModel');
const { resolvePmc } = D('services/pmcService');
const { encrypt } = D('utils/helper');
const { buildPublicProductUrl, buildDigitalLinkUrl: buildGs1DigitalLink } = D('utils/publicUrl');
const { deriveEntityCode } = D('utils/idFormat');

const COMPANY = '6a6f6da14bff4225b8f73752'; // Yometel
const SHOPPER = '6ad4f28e6f830fd6de197084'; // chrisgroenev@gmail.com
const OTHER_USERS = ['6ae1d1e50f3c4bb3b24a7765', '6aeae05900aac9be0ebc114d', '6ae9bd6200aac9be0ebc0bed'];
const EMPLOYEES = [['6ad4f0526f830fd6de196fd8', 'Test1', 0.55], ['6af7eed2c24ef2a64c7bf782', 'koji', 0.35], ['6af7edf6c24ef2a64c7bf754', 'Chris', 0.10]];
const IMG_DIR = path.join(__dirname, 'seed-images');
const UPLOADS = path.join(__dirname, '..', 'dist', 'uploads');
const QR_PER_PRODUCT = 40;
const SECURITY_PER_PRODUCT = 10;
const RFID_PER_PRODUCT = 12;

// Deterministic random numbers, so a re-run builds the same history.
let seed = 20261120;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const weighted = (pairs) => { let r = rnd() * pairs.reduce((s, p) => s + p[1], 0); for (const p of pairs) { r -= p[1]; if (r <= 0) return p[0]; } return pairs[0][0]; };

const ean13 = (twelve) => {
  const sum = twelve.split('').reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0);
  return twelve + ((10 - (sum % 10)) % 10);
};

const brandInfo = {
  name: 'Yometel', detail: 'DPP Innovation', websiteUrl: 'https://yometel.jp',
  logoUrl: '1794812142834esr1a1mhmwiwt4ok.png', coverUrl: '1794817462472esr1r9b0mwizz5ca.jpg',
};

const svc = (kind, o) => ({
  enabled: o.enabled !== false, summary: o.summary, steps: o.steps, partnerName: o.partner, url: o.url || '',
  email: 'service@yometel.jp', phone: '+81 3-1234-5678', cost: o.cost, time: o.time, note: o.note, acceptRequests: o.enabled !== false,
});
const watchCircularity = {
  repair: svc('repair', { summary: 'Servicing, new straps, glass and crown repairs by certified watchmakers, so it runs for generations.', steps: ['Send a service request here and describe what needs doing.', 'We reply within 2 working days with a quote and an insured shipping box.', 'Our watchmakers service the watch and test it for 7 days.', 'It comes back to you with a new 2-year service warranty.'], partner: 'Yometel Service Centre', cost: 'Full service from €390; straps from €120', time: '3–5 weeks', note: 'Keep the passport with the watch: it records every service.' }),
  resell: svc('resell', { summary: 'Resell it as Certified Pre-Owned: the passport proves its history to the next owner.', steps: ['Send a resale request and tell us the condition.', 'We inspect it and suggest a fair price.', 'It is listed with its passport; ownership moves to the buyer when it sells.', 'You are paid once the buyer confirms receipt.'], partner: 'Yometel Certified Pre-Owned', cost: 'Up to 75% of the sale price, or store credit worth 15% more', time: 'Paid within 5 days of the sale', note: 'Box and papers raise the price; the passport counts as papers.' }),
  rent: svc('rent', { enabled: false, summary: 'Not offered for this watch.', steps: [], partner: '', cost: '', time: '', note: '' }),
  recycle: svc('recycle', { summary: 'At the end of its life we take it back and recover the steel and the movement parts.', steps: ['Send a recycling request.', 'Bring it to any boutique or post it with our prepaid label.', 'Metals are refined and reused; nothing goes to landfill.', 'You receive a voucher for your next purchase.'], partner: 'Yometel take-back', cost: '€100 voucher', time: 'Any boutique or by post', note: 'Leather straps are recycled separately.' }),
};
const jewelCircularity = {
  repair: svc('repair', { summary: 'Cleaning, polishing, resizing, re-plating and stone tightening by our goldsmiths.', steps: ['Send a repair request here and describe what needs doing.', 'We reply within 2 working days with a quote and an insured shipping box.', 'Our goldsmiths repair it and check every stone.', 'It comes back cleaned and polished.'], partner: 'Yometel Atelier', cost: 'Cleaning free; resizing from €80', time: '2–3 weeks', note: 'Resizing is free in the first year.' }),
  resell: svc('resell', { summary: 'Resell it with its passport so the buyer can see the stones and gold are genuine.', steps: ['Send a resale request and tell us the condition.', 'We inspect it and suggest a fair price.', 'It is listed with its passport.', 'You are paid once the buyer confirms receipt.'], partner: 'Yometel Certified Pre-Owned', cost: 'Up to 70% of the sale price', time: 'Paid within 5 days of the sale', note: 'Light wear is fine; we polish it before sale.' }),
  rent: svc('rent', { summary: 'Rent it for a wedding, a gala or a photo shoot.', steps: ['Send a rental request with your dates.', 'We confirm within 2 working days.', 'It is delivered insured.', 'Return it in the box after the event.'], partner: 'Yometel Occasions', cost: 'From €90 per weekend', time: '2 days to 2 weeks', note: '€300 refundable deposit; insurance included.' }),
  recycle: svc('recycle', { summary: 'Precious metals are refined and reused; stones are recovered and certified again.', steps: ['Send a recycling request.', 'Bring it to any boutique or post it insured.', 'Gold and platinum are refined; stones are re-certified.', 'You receive the metal value as credit.'], partner: 'Yometel take-back', cost: 'Full metal value as store credit', time: 'Any boutique or by post', note: 'Recycled gold goes back into new collections.' }),
};
const watchCare = { iconIds: [], description: 'Service every 5 years. Keep away from strong magnets. Rinse with fresh water after swimming in the sea.', tips: ['Service every 5 years at an authorised centre', 'Keep away from strong magnets (speakers, phone cases)', 'Water resistant to 100 m: screw the crown down before swimming', 'Rinse with fresh water after salt water', 'Clean the bracelet with a soft dry cloth'] };
const jewelCare = { iconIds: [], description: 'Put it on after perfume and lotion, and keep it in its pouch so stones do not scratch each other.', tips: ['Put jewellery on last, after perfume and lotion', 'Take it off for swimming, sport and cleaning', 'Clean with warm soapy water and a soft brush', 'Store each piece separately in its pouch', 'Have the setting checked once a year'] };

const P = [
  { key: '190819', name: 'Chronograph 42', model: 'Automatic chronograph · 42 mm steel', sku: 'YMT-CH42-SS', cat: 'watches', type: 'Automatic chronograph', color: 'Grey dial, gold hands', size: '42 mm', price: 4800, made: 'Switzerland', date: '2026-09-15', warranty: 5,
    detail: 'Swiss automatic chronograph movement\n42 mm stainless steel case\nSapphire crystal\nWater resistant to 100 m\nSteel bracelet with folding clasp',
    about: 'A 42 mm chronograph built around a Swiss automatic movement with 48 hours of power reserve. The grey dial carries gold-tone hands and three sub-dials, protected by scratch-resistant sapphire crystal. Its Digital Product Passport records where each material came from, every service, and every change of owner.',
    facts: { material: 'Stainless steel, sapphire crystal', fit: 'Steel bracelet, folding clasp', wash: 'Water resistant to 100 m', durability: 'Service every 5 years', traceableIdentity: 'Traceable' },
    materials: [['Stainless steel', 86, 'Switzerland', 'Bienne steelworks'], ['Sapphire crystal', 9, 'Switzerland', 'Jura crystal works'], ['Movement parts', 5, 'Switzerland', 'Le Locle atelier']], route: ['Switzerland', 'Japan', 'Air', '9,600 km', '12kg', '42kg'], kind: 'watch' },
  { key: '277390', name: 'Midnight Blue Automatic', model: 'Automatic · 40 mm · mesh bracelet', sku: 'YMT-MB40-AU', cat: 'watches', type: 'Automatic watch', color: 'Midnight blue', size: '40 mm', price: 3200, made: 'Switzerland', date: '2026-08-28', warranty: 5,
    detail: 'Swiss automatic movement\n40 mm polished steel case\nSunburst midnight-blue dial\nMilanese mesh bracelet',
    about: 'A slim automatic with a sunburst midnight-blue dial and a fine Milanese mesh bracelet. Simple, legible and made to be worn every day for decades.',
    facts: { material: 'Polished steel, sapphire crystal', fit: 'Milanese mesh, sliding clasp', wash: 'Water resistant to 50 m', durability: 'Service every 5 years', traceableIdentity: 'Traceable' },
    materials: [['Stainless steel', 88, 'Switzerland', 'Bienne steelworks'], ['Sapphire crystal', 7, 'Switzerland', 'Jura crystal works'], ['Movement parts', 5, 'Switzerland', 'Le Locle atelier']], route: ['Switzerland', 'Japan', 'Air', '9,600 km', '10kg', '38kg'], kind: 'watch' },
  { key: '1458867', name: 'Emerald Halo Pendant', model: '18k white gold · 2.1 ct emerald', sku: 'YMT-EP21-WG', cat: 'necklaces', type: 'Pendant necklace', color: 'Emerald green, white gold', size: '45 cm chain', price: 2950, made: 'Italy', date: '2026-09-02', warranty: 2,
    detail: '2.1 ct Colombian emerald\nHalo of 18 brilliant-cut diamonds\n18k recycled white gold\n45 cm cable chain',
    about: 'A Colombian emerald framed by a halo of brilliant-cut diamonds, set by hand in Vicenza in recycled 18k white gold. The passport shows the mine of the emerald, the cutter and the gold refinery.',
    facts: { material: '18k white gold, emerald, diamonds', fit: '45 cm chain with extender', wash: 'Clean with warm soapy water', durability: 'Setting check once a year', traceableIdentity: 'Traceable' },
    materials: [['18k white gold (recycled)', 82, 'Switzerland', 'Valcambi refinery'], ['Emerald', 12, 'Colombia', 'Muzo mine'], ['Diamonds', 6, 'Botswana', 'Antwerp cutting house']], route: ['Italy', 'Japan', 'Air', '9,800 km', '6kg', '28kg'], kind: 'jewel' },
  { key: '10475789', name: 'Rose Gold Halo Ring', model: '18k rose gold · 0.9 ct', sku: 'YMT-RH09-RG', cat: 'rings', type: 'Engagement ring', color: 'Rose gold', size: 'EU 52', price: 1850, made: 'Belgium', date: '2026-09-20', warranty: 2,
    detail: '0.6 ct centre diamond\nDouble halo and pavé band, 0.3 ct\n18k rose gold\nFree resizing in the first year',
    about: 'A round centre diamond in a double halo, on a pavé band of 18k rose gold. Cut and set in Antwerp; the passport carries the diamond grading report.',
    facts: { material: '18k rose gold, diamonds', fit: 'EU 52, resizable', wash: 'Clean with a soft brush', durability: 'Setting check once a year', traceableIdentity: 'Traceable' },
    materials: [['18k rose gold', 90, 'Switzerland', 'Valcambi refinery'], ['Diamonds', 10, 'Botswana', 'Antwerp cutting house']], route: ['Belgium', 'Japan', 'Air', '9,500 km', '4kg', '25kg'], kind: 'jewel' },
  { key: '2735970', name: 'Diamond Stud Earrings', model: 'Platinum · 1.2 ct total', sku: 'YMT-DS12-PT', cat: 'earrings', type: 'Stud earrings', color: 'Platinum', size: '6.5 mm', price: 3400, made: 'Belgium', date: '2026-08-14', warranty: 2,
    detail: 'Two brilliant-cut diamonds, 1.2 ct total\nFour-claw platinum settings\nScrew backs for safe wear',
    about: 'A pair of brilliant-cut diamonds in four-claw platinum settings with screw backs. Each stone is graded and listed in the passport.',
    facts: { material: 'Platinum 950, diamonds', fit: 'Screw backs', wash: 'Clean with warm soapy water', durability: 'Claw check once a year', traceableIdentity: 'Traceable' },
    materials: [['Platinum 950', 80, 'South Africa', 'Rustenburg refinery'], ['Diamonds', 20, 'Canada', 'Antwerp cutting house']], route: ['Belgium', 'Japan', 'Air', '9,500 km', '3kg', '24kg'], kind: 'jewel' },
  { key: '3266700', name: 'Gold Hoop Earrings', model: '18k yellow gold · 22 mm', sku: 'YMT-GH22-YG', cat: 'earrings', type: 'Hoop earrings', color: 'Yellow gold', size: '22 mm', price: 1200, made: 'Italy', date: '2026-10-01', warranty: 2,
    detail: '18k recycled yellow gold\nTwisted triple-band design\nHinged snap closure',
    about: 'Twisted triple-band hoops in recycled 18k yellow gold, made in Arezzo. Light enough to wear all day.',
    facts: { material: '18k yellow gold (recycled)', fit: 'Hinged snap closure', wash: 'Polish with a soft cloth', durability: 'Hinge check once a year', traceableIdentity: 'Traceable' },
    materials: [['18k yellow gold (recycled)', 100, 'Italy', 'Arezzo refinery']], route: ['Italy', 'Japan', 'Air', '9,800 km', '3kg', '22kg'], kind: 'jewel' },
  { key: '1232931', name: 'Vintage Halo Ring', model: '18k rose gold · 1.0 ct', sku: 'YMT-VH10-RG', cat: 'rings', type: 'Cocktail ring', color: 'Rose gold', size: 'EU 54', price: 2100, made: 'Belgium', date: '2026-07-30', warranty: 2,
    detail: '1.0 ct round centre stone\nMilgrain halo, vintage style\n18k rose gold band',
    about: 'A vintage-style halo ring with milgrain detail around a bright round centre stone, set in 18k rose gold.',
    facts: { material: '18k rose gold, diamonds', fit: 'EU 54, resizable', wash: 'Clean with a soft brush', durability: 'Setting check once a year', traceableIdentity: 'Traceable' },
    materials: [['18k rose gold', 88, 'Switzerland', 'Valcambi refinery'], ['Diamonds', 12, 'Botswana', 'Antwerp cutting house']], route: ['Belgium', 'Japan', 'Air', '9,500 km', '4kg', '25kg'], kind: 'jewel' },
  { key: '691046', name: 'Diamond Solitaire', model: 'Platinum · 1.0 ct', sku: 'YMT-SO10-PT', cat: 'rings', type: 'Solitaire ring', color: 'Platinum', size: 'EU 51', price: 2400, made: 'Belgium', date: '2026-09-09', warranty: 2,
    detail: '1.0 ct brilliant-cut diamond, colour G, clarity VS1\nFour-claw platinum setting\nComfort-fit band',
    about: 'The classic: a single 1.0 ct brilliant-cut diamond in a four-claw platinum setting. The passport carries its grading certificate.',
    facts: { material: 'Platinum 950, diamond', fit: 'EU 51, comfort fit', wash: 'Clean with warm soapy water', durability: 'Claw check once a year', traceableIdentity: 'Traceable' },
    materials: [['Platinum 950', 85, 'South Africa', 'Rustenburg refinery'], ['Diamond', 15, 'Canada', 'Antwerp cutting house']], route: ['Belgium', 'Japan', 'Air', '9,500 km', '3kg', '24kg'], kind: 'jewel' },
  { key: '2849742', name: 'Rose Gold Wedding Set', model: 'Engagement ring and band · 18k rose gold', sku: 'YMT-WS-RG', cat: 'rings', type: 'Wedding set', color: 'Rose gold', size: 'EU 52', price: 2650, made: 'Belgium', date: '2026-10-05', warranty: 2,
    detail: 'Halo engagement ring, 0.8 ct\nMatching pavé wedding band\n18k rose gold, designed to sit flush',
    about: 'A halo engagement ring and a matching pavé band designed to sit flush together, both in 18k rose gold.',
    facts: { material: '18k rose gold, diamonds', fit: 'EU 52, both rings resizable', wash: 'Clean with a soft brush', durability: 'Setting check once a year', traceableIdentity: 'Traceable' },
    materials: [['18k rose gold', 88, 'Switzerland', 'Valcambi refinery'], ['Diamonds', 12, 'Botswana', 'Antwerp cutting house']], route: ['Belgium', 'Japan', 'Air', '9,500 km', '4kg', '25kg'], kind: 'jewel' },
  { key: '1191531', name: 'Charm Bangle Set', model: 'Sterling silver · set of 3', sku: 'YMT-CB3-AG', cat: 'bracelets', type: 'Bangle set', color: 'Silver', size: '6.5 cm', price: 890, made: 'Italy', date: '2026-10-12', warranty: 2,
    detail: 'Three adjustable sterling silver bangles\nHand-finished charms\nAnti-tarnish coating',
    about: 'Three adjustable sterling silver bangles with hand-finished charms, made to be stacked and worn together.',
    facts: { material: 'Sterling silver 925 (recycled)', fit: 'Adjustable, 6–7 cm', wash: 'Polish with a silver cloth', durability: 'Anti-tarnish coating', traceableIdentity: 'Traceable' },
    materials: [['Sterling silver 925 (recycled)', 100, 'Italy', 'Arezzo refinery']], route: ['Italy', 'Japan', 'Air', '9,800 km', '2kg', '18kg'], kind: 'jewel' },
];

const CITIES = [['Japan', 'Tokyo', 'Tokyo', 35.68, 139.76, 30], ['Japan', 'Osaka', 'Osaka', 34.69, 135.5, 10], ['United States', 'New York', 'New York', 40.71, -74.0, 12], ['United States', 'California', 'Los Angeles', 34.05, -118.24, 6], ['Germany', 'Berlin', 'Berlin', 52.52, 13.4, 8], ['France', 'Île-de-France', 'Paris', 48.86, 2.35, 9], ['United Kingdom', 'England', 'London', 51.51, -0.13, 7], ['Switzerland', 'Geneva', 'Geneva', 46.2, 6.14, 5], ['Singapore', 'Singapore', 'Singapore', 1.35, 103.82, 5], ['Hong Kong', 'Hong Kong', 'Hong Kong', 22.32, 114.17, 5], ['Italy', 'Lombardy', 'Milan', 45.46, 9.19, 4], ['United Arab Emirates', 'Dubai', 'Dubai', 25.2, 55.27, 4], ['Netherlands', 'North Holland', 'Amsterdam', 52.37, 4.9, 3]];
const STEP_PLACES = { 'Tokyo DC': [35.62, 139.78, 'Koto, Tokyo, JP'], 'Colombo Plant': [6.93, 79.85, 'Colombo, LK'], 'Dhaka Factory': [23.81, 90.41, 'Dhaka, BD'], 'Osaka DC': [34.69, 135.5, 'Osaka, JP'], 'Ginza Store': [35.67, 139.76, 'Ginza, Tokyo, JP'], 'Tokyo Quality Lab': [35.65, 139.7, 'Shibuya, Tokyo, JP'], 'Osaka Repair Center': [34.7, 135.49, 'Osaka, JP'], 'Chiba Recycling': [35.6, 140.1, 'Chiba, JP'] };

const dateKeyJst = (d) => { const j = new Date(d.getTime() + 9 * 3600000); return `${j.getUTCFullYear()}${String(j.getUTCMonth() + 1).padStart(2, '0')}${String(j.getUTCDate()).padStart(2, '0')}`; };

(async () => {
  await mongoose.connect(process.env.DATABASE, { useNewUrlParser: true, useUnifiedTopology: true });
  const db = mongoose.connection.db;

  // 1. Backup.
  const backup = {};
  for (const c of ['products', 'qrcodes', 'securityqrcodes', 'productidentifiers', 'pmcs', 'pmcidentifiers', 'scanrecords', 'capturerecords', 'albumitems', 'productreactions', 'cartitems', 'counters', 'productholdings', 'platformsettings']) {
    backup[c] = await db.collection(c).find({}).toArray();
  }
  const backupFile = `/home/ubuntu/backup-${dateKeyJst(new Date())}-seed-luxury.json`;
  fs.writeFileSync(backupFile, JSON.stringify(backup));
  console.log('backup', backupFile);

  // 2. Item categories for watches and jewellery, then products with images.
  const cats = [['watches', 'Watches', 'WAT'], ['rings', 'Rings', 'RNG'], ['necklaces', 'Necklaces', 'NEC'], ['earrings', 'Earrings', 'EAR'], ['bracelets', 'Bracelets', 'BRC']];
  const settings = await db.collection('platformsettings').findOne({ key: 'itemCategories' });
  if (settings) {
    const have = new Set((settings.itemCategories || []).map((c) => c.key));
    const add = cats.filter(([k]) => !have.has(k)).map(([key, label, skuPrefix]) => ({ key, label, skuPrefix }));
    if (add.length) await db.collection('platformsettings').updateOne({ _id: settings._id }, { $push: { itemCategories: { $each: add } } });
  }
  fs.mkdirSync(UPLOADS, { recursive: true });
  const products = [];
  for (const [i, d] of P.entries()) {
    let prod = await Product.findOne({ skuStyleNumber: d.sku, is_deleted: { $ne: true } });
    const gtin = ean13(`4560471${String(10 + i).padStart(5, '0')}`);
    if (!prod) {
      const images = [1, 2, 3].map((n) => {
        const name = `seed-${d.sku.toLowerCase()}-${n}.jpg`;
        fs.copyFileSync(path.join(IMG_DIR, `p${d.key}-${n}.jpg`), path.join(UPLOADS, name));
        return name;
      });
      const [from, to, mode, distance, co2p, co2t] = d.route;
      prod = await Product.create({
        company_id: COMPANY, current_owner: { kind: 'Company', id: COMPANY },
        name: d.name, model: d.model, detail: d.detail, aboutProduct: d.about, productType: d.type, color: d.color, size: d.size,
        manufactureDate: d.date, warrantyStatus: 'Active', warrantyValidYears: d.warranty, detailFacts: d.facts,
        itemCategory: d.cat, skuStyleNumber: d.sku, gtin: `0${gtin}`, gs1DigitalLink: i % 3 === 1, brandInfo,
        price: d.price, currency: 'EUR', purchaseUrl: `https://yometel.jp/shop/${d.sku.toLowerCase()}`,
        certifications: [], images, files: [], videos: [],
        warrantyAndGuarantee: { images: [], files: [], videos: [], warranty: { period: d.warranty, unit: 0, notime: false, lifetime: false }, guarantee: { period: 0, unit: 0, notime: false, lifetime: false } },
        materialSize: { size: d.size, materials: d.materials.map(([m, pct, origin]) => ({ material: m, percent: pct, origin, icon: '', required: false, certificate: '' })) },
        maintenance: d.kind === 'watch' ? watchCare : jewelCare,
        disposal: { repairUrl: 'https://yometel.jp/service', reuseUrl: 'https://yometel.jp/pre-owned', rentalUrl: d.kind === 'watch' ? '' : 'https://yometel.jp/occasions', disposeUrl: 'https://yometel.jp/take-back' },
        circularity: d.kind === 'watch' ? watchCircularity : jewelCircularity,
        traceabilityEsg: { madeIn: d.made, originCountry: d.made, materialOrigins: d.materials.map(([m, , country, companyName]) => ({ material: m, country, companyName, icon: '' })), shippingLog: `Shipping ${from} to ${to}`, distance, co2Production: co2p, co2Transportation: co2t, route: { origin: from, destination: to, mode, emissions: co2t } },
        sustainabilityImpact: { co2Avoided: d.kind === 'watch' ? '' : '18kg (recycled gold)', waterSaved: '', energySaved: '', items: [] },
        tabVideos: { materials: [], care: [], dispose: [], traceability: [], warranty: [] },
        total_minted_amount: 0, printed_amount: 0,
      });
      console.log('product', d.name, String(prod._id));
    } else {
      console.log('exists', d.name);
    }
    products.push({ doc: prod, d, gtin });
  }

  // 3. Codes: QR, Security QR, barcode, GS1 Digital Link, RFID.
  for (const { doc, d, gtin } of products) {
    if (doc.total_minted_amount >= QR_PER_PRODUCT) continue;
    const haveQr = await QRcode.countDocuments({ product_id: doc._id });
    for (let q = haveQr + 1; q <= QR_PER_PRODUCT; q++) {
      await QRcode.create({ product_id: doc._id, company_id: COMPANY, qrcode_id: q });
      await resolvePmc({ product_id: doc._id, company_id: COMPANY, qrcode_id: q, source_type: 'qr', raw_value: buildPublicProductUrl(doc._id, q) });
    }
    const canEncrypt = !!(process.env.ENCRYPT_ALGORITHM && process.env.AES_KEY && process.env.AES_IV);
    if (!canEncrypt) console.log('  Security QR skipped: ENCRYPT_ALGORITHM / AES_KEY / AES_IV are not set in .env');
    for (let s = 1; canEncrypt && s <= SECURITY_PER_PRODUCT; s++) {
      const key = encrypt(JSON.stringify({ product_id: doc._id, security_token_id: s }));
      await SecurityQRCode.create({ product_id: doc._id, company_id: COMPANY, security_qrcode_id: s, encrypted_key: key });
      await resolvePmc({ product_id: doc._id, company_id: COMPANY, security_qrcode_id: s, source_type: 'qr', raw_value: key });
    }
    await ProductIdentifier.create({ product_id: doc._id, company_id: COMPANY, source_type: 'barcode', raw_value: gtin, gtin, note: 'Box label (EAN-13)' });
    for (let q = 1; q <= 5; q++) {
      const link = buildGs1DigitalLink(`0${gtin}`, q);
      await ProductIdentifier.create({ product_id: doc._id, company_id: COMPANY, source_type: 'gs1dl', raw_value: link, gtin: `0${gtin}`, note: `Item #${q}` });
      await resolvePmc({ product_id: doc._id, company_id: COMPANY, qrcode_id: q, source_type: 'gs1dl', raw_value: link });
    }
    for (let q = 1; q <= RFID_PER_PRODUCT; q++) {
      const epc = `30340F${(0x4A00 + products.findIndex((x) => x.doc === doc)).toString(16).toUpperCase()}${String(q).padStart(12, '0')}`.slice(0, 24).padEnd(24, '0');
      await ProductIdentifier.create({ product_id: doc._id, company_id: COMPANY, source_type: 'rfid', raw_value: epc, gtin: '', note: `Item #${q}` });
      await resolvePmc({ product_id: doc._id, company_id: COMPANY, qrcode_id: q, source_type: 'rfid', raw_value: epc });
    }
    await Product.updateOne({ _id: doc._id }, { $set: { total_minted_amount: QR_PER_PRODUCT, printed_amount: 16, security_printed_amount: canEncrypt ? 4 : 0, 'identifier_printed_amounts.rfid': RFID_PER_PRODUCT, 'identifier_printed_amounts.gs1dl': 5, 'identifier_printed_amounts.barcode': 1 } });
    // Ownership ledger: the company holds the stock; the test shopper owns item #3 of two pieces.
    const owned = [0, 2].includes(products.findIndex((x) => x.doc === doc));
    await ProductHolding.create({ product_id: doc._id, owner: { kind: 'Company', id: COMPANY, email: '', name: 'Yometel' }, quantity: QR_PER_PRODUCT - (owned ? 1 : 0) });
    if (owned) await ProductHolding.create({ product_id: doc._id, owner: { kind: 'User', id: SHOPPER, email: '', name: '' }, quantity: 1 });
    console.log('codes', d.name);
  }

  // 4. Shopper scans over the last 60 days.
  const already = await ScanRecord.countDocuments({ product_id: { $in: products.map((p) => p.doc._id) } });
  if (!already) {
    const now = Date.now();
    const pmcCode = {};
    for (const p of products) for (const pm of await PMC.find({ product_id: p.doc._id, qrcode_id: { $ne: null } }).select('qrcode_id pmc_code').lean()) pmcCode[`${p.doc._id}:${pm.qrcode_id}`] = pm.pmc_code;
    const docs = [];
    const scan = (p, q, when, city, extra = {}) => {
      const [country, region, cityName, lat, lon] = city;
      const kind = extra.kind || weighted([['qr', 76], ['gs1dl', 12], ['barcode', 12]]);
      const raw = kind === 'qr' ? buildPublicProductUrl(p.doc._id, q) : kind === 'gs1dl' ? buildGs1DigitalLink(`0${p.gtin}`, q) : p.gtin;
      const user = extra.user !== undefined ? extra.user : weighted([[SHOPPER, 22], [pick(OTHER_USERS), 18], [null, 60]]);
      docs.push({ product_id: p.doc._id, qrcode_id: kind === 'barcode' ? null : q, encrypt_data: raw, user_id: user, scanned_at: new Date(when), createdAt: new Date(when), updatedAt: new Date(when), source: rnd() < 0.85 ? 'scan' : 'visit', ip: '', location: { country, region, city: cityName, latitude: +(lat + (rnd() - 0.5) * 0.08).toFixed(4), longitude: +(lon + (rnd() - 0.5) * 0.08).toFixed(4), source: rnd() < 0.6 ? 'gps' : 'ip' }, security_verified: extra.security ? true : null, security_qrcode_id: extra.security || null, pmc_code: kind === 'barcode' ? '' : (pmcCode[`${p.doc._id}:${q}`] || ''), identifier_type: kind });
    };
    const popularity = [10, 6, 9, 8, 6, 5, 4, 7, 5, 4];
    for (let i = 0; i < 640; i++) {
      const p = weighted(products.map((x, k) => [x, popularity[k]]));
      const daysAgo = Math.floor(Math.pow(rnd(), 1.7) * 60);
      const when = now - daysAgo * 86400000 - Math.floor(rnd() * 86400000 * 0.9);
      scan(p, 1 + Math.floor(rnd() * QR_PER_PRODUCT), when, weighted(CITIES.map((c) => [c, c[5]])));
    }
    // Security QR checks that passed.
    if (await SecurityQRCode.countDocuments({ product_id: { $in: products.map((x) => x.doc._id) } })) for (let i = 0; i < 24; i++) { const p = pick(products); scan(p, 1 + Math.floor(rnd() * 20), now - Math.floor(rnd() * 30) * 86400000, weighted(CITIES.map((c) => [c, c[5]])), { kind: 'qr', security: 1 + Math.floor(rnd() * SECURITY_PER_PRODUCT) }); }
    // Two patterns a genuine label doesn't show (for Scans & Security).
    const t0 = now - 3 * 86400000;
    [[0, CITIES[0]], [12, CITIES[2]], [25, CITIES[4]], [40, CITIES[0]], [55, CITIES[9]], [58, CITIES[2]]].forEach(([m, c]) => scan(products[0], 7, t0 + m * 60000, c, { kind: 'qr', user: null }));
    for (let i = 0; i < 40; i++) scan(products[2], 12, now - 5 * 86400000 + i * 1200000, CITIES[11], { kind: 'qr', user: null });
    // Today, so "today" views are not empty.
    for (let i = 0; i < 18; i++) scan(pick(products), 1 + Math.floor(rnd() * QR_PER_PRODUCT), now - Math.floor(rnd() * 8 * 3600000), weighted(CITIES.map((c) => [c, c[5]])));
    await ScanRecord.insertMany(docs);
    console.log('scans', docs.length);
  }

  // 5. Staff work records over 45 days (+ today).
  const company = await db.collection('companies').findOne({ _id: new mongoose.Types.ObjectId(COMPANY) });
  const steps = company.processSteps || [];
  const existingCaptures = await CaptureRecord.countDocuments({ productId: { $in: products.map((p) => String(p.doc._id)) } });
  if (!existingCaptures && steps.length) {
    const now = Date.now();
    const seqs = {};
    const caps = [];
    const flow = [4, 3, 2, 1, 0, 6, 7];
    const make = (stepIndex, when, p, q, emp) => {
      const step = steps[stepIndex];
      const dateKey = dateKeyJst(new Date(when));
      const refCode = deriveEntityCode(step.entity);
      const counterKey = `ref:${COMPANY}:${stepIndex}:${dateKey}`;
      seqs[counterKey] = (seqs[counterKey] || 0) + 1;
      const rfid = rnd() < 0.35 && q <= RFID_PER_PRODUCT;
      const place = STEP_PLACES[step.entity] || [35.68, 139.76, 'Tokyo, JP'];
      caps.push({
        company_id: new mongoose.Types.ObjectId(COMPANY), employee_id: new mongoose.Types.ObjectId(emp[0]), stepIndex, stepEntity: step.entity, stepType: step.type, refCode,
        seq: seqs[counterKey], dateKey, refNumber: `${refCode}-${stepIndex + 1}-${dateKey}-${String(seqs[counterKey]).padStart(3, '0')}`,
        rawValue: rfid ? `30340F${(0x4A00 + products.indexOf(p)).toString(16).toUpperCase()}${String(q).padStart(12, '0')}`.slice(0, 24).padEnd(24, '0') : buildPublicProductUrl(p.doc._id, q),
        identifierType: rfid ? 'rfid' : 'qr', imagePath: rfid ? '' : `/files/${p.doc.images[0]}`, productId: String(p.doc._id), qrcodeId: String(q), productImage: p.doc.images[0],
        location: { latitude: place[0], longitude: place[1], accuracy: 25, address: place[2] }, device: { model: 'iPhone 16 Pro', os: 'iOS', osVersion: '26.1' },
        terminalId: '1', workerLabel: emp[1], flagged: rnd() < 0.05, capturedAt: new Date(when),
      });
    };
    for (let i = 0; i < 26; i++) {
      const p = pick(products);
      const q = 1 + Math.floor(rnd() * QR_PER_PRODUCT);
      let when = now - (45 - Math.floor(rnd() * 3) - i * 1.6) * 86400000;
      for (const s of flow) {
        if (s >= steps.length || when > now - 86400000) break;
        make(s, when + Math.floor(rnd() * 6 * 3600000), p, q, weighted(EMPLOYEES.map((e) => [e, e[2]])));
        when += (1 + rnd() * 2.5) * 86400000;
      }
    }
    for (let i = 0; i < 12; i++) make(0, now - Math.floor(rnd() * 6 * 3600000), pick(products), 1 + Math.floor(rnd() * QR_PER_PRODUCT), EMPLOYEES[0]);
    for (const c of caps) c.createdAt = c.capturedAt;
    await CaptureRecord.insertMany(caps);
    for (const [key, seq] of Object.entries(seqs)) await Counter.updateOne({ key }, { $max: { seq } }, { upsert: true });
    console.log('work records', caps.length);
  }

  // 6. The test shopper's favourites, likes and cart.
  const shopperId = new mongoose.Types.ObjectId(SHOPPER);
  for (const idx of [2, 3, 7, 0]) {
    const { doc } = products[idx];
    const exists = await AlbumItem.findOne({ user_id: shopperId, product_id: doc._id });
    if (!exists) await AlbumItem.create({ user_id: shopperId, product_id: doc._id, token_id: 3, productSnapshot: { name: doc.name, model: doc.model, detail: doc.detail, images: doc.images, brandInfo } });
    await ProductReaction.updateOne({ user_id: shopperId, product_id: doc._id, token_id: 3 }, { $set: { reaction: 'like' } }, { upsert: true });
  }
  for (const u of OTHER_USERS) for (const idx of [0, 2, 4]) await ProductReaction.updateOne({ user_id: new mongoose.Types.ObjectId(u), product_id: products[idx].doc._id, token_id: 5 }, { $set: { reaction: 'like' } }, { upsert: true });
  try {
    for (const idx of [0, 2]) {
      const { doc } = products[idx];
      if (!(await CartItem.findOne({ user_id: shopperId, product_id: doc._id }))) await CartItem.create({ user_id: shopperId, product_id: doc._id, token_id: 3, quantity: 1 });
    }
  } catch (e) { console.log('cart skipped:', e.message); }
  console.log('favourites, likes and cart done');
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
