// The brand's online shop page for one product (2026-11-28): the app's
// "Online store" / "View in shop" buttons open it, so every product has a
// real, working shop page — https://dpp.innosynch.com/shop/<productId>
// (nginx sends /shop on that domain here). Server-drawn HTML: photos, name,
// price, colour, sizes (from stock), Add to bag, details and care.
const Product = require('../models/productModel');

const esc = (v: any) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const FILES = process.env.PUBLIC_FILES_BASE_URL || 'https://api.innosynch.com/files';
const fileUrl = (f: any) => {
    const s = String((f && (f.url || f.path || f.file)) || f || '').trim();
    if (!s) return '';
    return /^https?:\/\//i.test(s) ? s : `${FILES}/${s.replace(/^\/+/, '').replace(/^files\//, '')}`;
};
const money = (price: any, currency: any) => {
    const n = Number(price);
    if (!Number.isFinite(n) || n <= 0) return '';
    try {
        return new Intl.NumberFormat('en-IE', { style: 'currency', currency: String(currency || 'EUR'), maximumFractionDigits: 0 }).format(n);
    } catch (e) {
        return `€${Math.round(n)}`;
    }
};
// Sizes with stock first (sizes[].label, floor + back), else the size text.
const sizesOf = (p: any): { label: string; inStock: boolean }[] => {
    if (Array.isArray(p?.sizes) && p.sizes.length) {
        return p.sizes.filter((s: any) => s && s.label).map((s: any) => ({ label: String(s.label), inStock: (Number(s.floor) || 0) + (Number(s.back) || 0) > 0 }));
    }
    return String(p?.size || p?.materialSize?.size || '').split(/[,/·|]/).map((x) => x.trim()).filter(Boolean).map((label) => ({ label, inStock: true }));
};

const page = (title: string, body: string, brandName: string, logo: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1c2430;background:#fff}
a{color:inherit}
header{display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid #eceff3;position:sticky;top:0;background:#fff;z-index:5}
header .brand{display:flex;align-items:center;gap:10px;font-size:15px;letter-spacing:.12em;text-transform:uppercase;color:#1b4f72;text-decoration:none}
header img{height:26px}
header .bag{display:flex;align-items:center;gap:6px;font-size:14px;color:#1b4f72}
header .bag b{display:inline-flex;min-width:20px;height:20px;border-radius:10px;background:#1b4f72;color:#fff;font-size:12px;align-items:center;justify-content:center;padding:0 6px}
main{max-width:1080px;margin:0 auto;padding:20px}
.crumbs{font-size:13px;color:#6b7480;margin-bottom:14px}
.grid{display:grid;grid-template-columns:1fr;gap:28px}
@media(min-width:860px){.grid{grid-template-columns:1.15fr 1fr}}
.main-img{width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:14px;background:#f2f4f7;display:block}
.thumbs{display:flex;gap:8px;margin-top:10px;overflow-x:auto}
.thumbs img{width:64px;height:80px;object-fit:cover;border-radius:8px;border:2px solid transparent;cursor:pointer;flex:none}
.thumbs img.on{border-color:#1b4f72}
h1{font-size:28px;font-weight:400;margin:0 0 4px}
.model{color:#5f6b78;margin:0 0 12px}
.price{font-size:22px;margin:0 0 18px}
.label{font-size:13px;color:#5f6b78;text-transform:uppercase;letter-spacing:.06em;margin:18px 0 8px}
.colour{display:flex;align-items:center;gap:8px}
.swatch{width:22px;height:22px;border-radius:50%;border:1px solid #d5dbe3}
.sizes{display:flex;flex-wrap:wrap;gap:8px}
.sizes button{min-width:52px;height:42px;padding:0 12px;border-radius:10px;border:1.5px solid #c9d2de;background:#fff;font-size:15px;cursor:pointer}
.sizes button.on{border-color:#1b4f72;background:#1b4f72;color:#fff}
.sizes button:disabled{color:#b0b8c3;text-decoration:line-through;cursor:not-allowed}
.add{width:100%;height:52px;margin-top:22px;border:0;border-radius:26px;background:linear-gradient(135deg,#2a78bd,#1b4f72);color:#fff;font-size:17px;cursor:pointer}
.add:disabled{opacity:.5;cursor:not-allowed}
.note{font-size:13px;color:#6b7480;margin-top:8px;min-height:18px}
.perks{margin:18px 0 0;padding:0;list-style:none;font-size:14px;color:#3d4753;display:grid;gap:6px}
details{border-top:1px solid #eceff3;padding:14px 0}details:last-of-type{border-bottom:1px solid #eceff3}
summary{cursor:pointer;font-size:16px;list-style:none;display:flex;justify-content:space-between}summary::after{content:"+";color:#6b7480}details[open] summary::after{content:"−"}
details p,details li{color:#3d4753;font-size:15px;line-height:1.55}
footer{max-width:1080px;margin:30px auto;padding:20px;color:#8a94a3;font-size:13px;border-top:1px solid #eceff3}
.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#1c2430;color:#fff;padding:12px 18px;border-radius:12px;font-size:15px;opacity:0;transition:opacity .2s}
.toast.show{opacity:1}
</style></head><body>
<header><a class="brand" href="#">${logo ? `<img src="${esc(logo)}" alt="">` : ''}<span>${esc(brandName)} Shop</span></a><span class="bag">Bag <b id="bagCount">0</b></span></header>
${body}
<footer>© ${new Date().getFullYear()} ${esc(brandName)}. Prices include VAT. Free delivery and 30-day returns.</footer>
<div class="toast" id="toast"></div>
</body></html>`;

exports.getShopPage = async (req: any, res: any) => {
    let p: any = null;
    try {
        p = await Product.findById(String(req.params.id || '')).lean();
    } catch (e) { p = null; }
    res.set('Content-Type', 'text/html; charset=utf-8');
    // This page's own small script and styles (helmet's default blocks inline ones).
    res.set('Content-Security-Policy', "default-src 'self'; img-src * data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; script-src-attr 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'");
    if (!p || p.is_deleted) {
        res.status(404).send(page('Product not found', '<main><h1>Sorry, this product is not available.</h1><p class="model">It may have been removed from the shop.</p></main>', 'Yometel', ''));
        return;
    }
    const brandName = String(p.brandInfo?.name || 'Yometel');
    const logo = fileUrl(p.brandInfo?.logoUrl);
    const imgs = (Array.isArray(p.images) ? p.images : []).map(fileUrl).filter(Boolean).slice(0, 8);
    const sizes = sizesOf(p);
    const price = money(p.price, p.currency);
    const facts = p.detailFacts || {};
    const detailLines = String(p.detail || '').split('\n').map((x) => x.trim()).filter(Boolean);
    const mats = (p.materialSize?.materials || []).filter((m: any) => m && m.material)
        .map((m: any) => `${m.percent ? `${m.percent}% ` : ''}${m.material}${m.origin ? ` (${m.origin})` : ''}`);
    const body = `<main>
<div class="crumbs">${esc(brandName)} / ${esc(p.itemCategory ? String(p.itemCategory).replace(/^./, (c: string) => c.toUpperCase()) : 'Shop')} / ${esc(p.name)}</div>
<div class="grid">
  <div>
    ${imgs.length ? `<img class="main-img" id="mainImg" src="${esc(imgs[0])}" alt="${esc(p.name)}">` : '<div class="main-img"></div>'}
    ${imgs.length > 1 ? `<div class="thumbs">${imgs.map((u: string, i: number) => `<img src="${esc(u)}" alt="" class="${i === 0 ? 'on' : ''}" onclick="pick(this)">`).join('')}</div>` : ''}
  </div>
  <div>
    <h1>${esc(p.name)}</h1>
    ${p.model ? `<p class="model">${esc(p.model)}</p>` : ''}
    ${price ? `<p class="price">${esc(price)}</p>` : ''}
    ${p.color ? `<div class="label">Colour</div><div class="colour">${p.colorHex ? `<span class="swatch" style="background:${esc(p.colorHex)}"></span>` : ''}<span>${esc(p.color)}</span></div>` : ''}
    ${sizes.length ? `<div class="label">Size</div><div class="sizes">${sizes.map((s) => `<button type="button" ${s.inStock ? '' : 'disabled'} onclick="size(this)">${esc(s.label)}</button>`).join('')}</div>` : ''}
    <button class="add" id="add" ${sizes.length ? 'disabled' : ''} onclick="add()">Add to bag</button>
    <div class="note" id="note">${sizes.length ? 'Please choose a size.' : ''}</div>
    <ul class="perks"><li>Free delivery in 2–4 working days</li><li>Free returns within 30 days</li><li>Digital Product Passport included</li></ul>
    ${p.aboutProduct ? `<details open><summary>About this product</summary><p>${esc(p.aboutProduct)}</p></details>` : ''}
    ${detailLines.length ? `<details><summary>Details</summary><ul>${detailLines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></details>` : ''}
    ${(mats.length || facts.material) ? `<details><summary>Materials</summary><ul>${(mats.length ? mats : [facts.material]).map((l: string) => `<li>${esc(l)}</li>`).join('')}</ul></details>` : ''}
    ${(facts.fit || facts.wash || facts.durability) ? `<details><summary>Fit and care</summary><ul>${[facts.fit && `Fit: ${facts.fit}`, facts.wash && `Care: ${facts.wash}`, facts.durability && `Durability: ${facts.durability}`].filter(Boolean).map((l: string) => `<li>${esc(l)}</li>`).join('')}</ul></details>` : ''}
  </div>
</div>
</main>
<script>
var chosen='';var bag=0;
function pick(el){document.getElementById('mainImg').src=el.src;document.querySelectorAll('.thumbs img').forEach(function(i){i.classList.toggle('on',i===el)});}
function size(el){chosen=el.textContent;document.querySelectorAll('.sizes button').forEach(function(b){b.classList.toggle('on',b===el)});document.getElementById('add').disabled=false;document.getElementById('note').textContent='Size '+chosen+' selected.';}
function add(){bag++;document.getElementById('bagCount').textContent=bag;var t=document.getElementById('toast');t.textContent='Added to your bag'+(chosen?' (size '+chosen+')':'')+'.';t.classList.add('show');setTimeout(function(){t.classList.remove('show')},2200);}
</script>`;
    res.set('Cache-Control', 'public, max-age=300');
    res.send(page(`${p.name} – ${brandName} Shop`, body, brandName, logo));
};
