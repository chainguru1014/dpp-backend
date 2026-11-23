const fetch = require('node-fetch');
const mongoose = require('mongoose');
const Product = require('../models/productModel');
const ScanRecord = require('../models/scanRecordModel');
const ProductReaction = require('../models/productReactionModel');
const CartItem = require('../models/cartItemModel');
const AlbumItem = require('../models/albumItemModel');

// What a shopper has done, read from the database, for the AI to analyse:
// what they scanned, liked, disliked and put in the cart, and the product
// they are looking at now. Each product as "name (type, brand)".
async function shopperHistory(userId: string, currentProductId?: string) {
    let uid: any;
    try {
        uid = mongoose.Types.ObjectId(String(userId));
    } catch (e) {
        return null;
    }
    const [scans, reactions, cart, album] = await Promise.all([
        ScanRecord.find({ user_id: uid, product_id: { $ne: null } }).sort({ scanned_at: -1 }).limit(40).select('product_id').lean().catch(() => []),
        ProductReaction.find({ user_id: uid }).select('product_id reaction').lean().catch(() => []),
        CartItem.find({ user_id: uid }).select('product_id').lean().catch(() => []),
        AlbumItem.find({ user_id: uid }).select('product_id').lean().catch(() => []),
    ]);
    const ids = new Set<string>();
    const add = (list: any[]) => list.forEach((x: any) => x?.product_id && ids.add(String(x.product_id)));
    [scans, reactions, cart, album].forEach(add);
    if (currentProductId) ids.add(String(currentProductId));
    const valid = [...ids].filter((id) => mongoose.Types.ObjectId.isValid(id));
    const docs = await Product.find({ _id: { $in: valid } }).select('name productType itemCategory brandInfo').lean().catch(() => []);
    const label: any = {};
    docs.forEach((p: any) => {
        const bits = [p.productType || p.itemCategory, p.brandInfo?.name].filter(Boolean).join(', ');
        label[String(p._id)] = bits ? `${p.name} (${bits})` : p.name;
    });
    const names = (list: any[]) => [...new Set(list.map((x: any) => label[String(x.product_id)]).filter(Boolean))].slice(0, 15);
    const disliked = reactions.filter((r: any) => r.reaction === 'dislike');
    return {
        current: currentProductId ? label[String(currentProductId)] || null : null,
        liked: names([...reactions.filter((r: any) => r.reaction === 'like'), ...album]),
        disliked: names(disliked),
        inCart: names(cart),
        scanned: names(scans),
        dislikedIds: disliked.map((r: any) => String(r.product_id)),
    };
}

// OpenAI is called server-side only — the API key never reaches the client.
// Configure OPENAI_API_KEY (and optionally OPENAI_MODEL) in the backend env.
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

async function callOpenAI(messages: any[], opts: any = {}) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) {
        const e: any = new Error('AI is not configured. Set OPENAI_API_KEY on the server.');
        e.statusCode = 503;
        throw e;
    }
    const resp = await fetch(OPENAI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
            model: MODEL,
            messages,
            temperature: opts.temperature ?? 0.6,
            max_tokens: opts.max_tokens ?? 600,
            ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
        }),
    });
    if (!resp.ok) {
        const text = await resp.text();
        const e: any = new Error(`OpenAI request failed (${resp.status})`);
        e.statusCode = 502;
        e.detail = text;
        throw e;
    }
    const data: any = await resp.json();
    return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || '').trim();
}

// POST /chat — customer ⇄ brand assistant answered by OpenAI.
exports.chat = async (req: any, res: any) => {
    try {
        const { message, history = [] } = req.body || {};
        if (!message || !String(message).trim()) {
            return res.status(400).json({ status: 'fail', message: 'message is required' });
        }
        const system = {
            role: 'system',
            content:
                'You are the product assistant for a Digital Product Passport (DPP) platform. ' +
                'Help shoppers with questions about products: authenticity, materials, care instructions, ' +
                'sustainability / ESG, warranty, and where to buy. Be concise, friendly and factual. ' +
                'If you are unsure about a specific product detail, say so and suggest contacting the brand.',
        };
        const trimmed = (Array.isArray(history) ? history : [])
            .filter((h: any) => h && h.content && (h.role === 'user' || h.role === 'assistant'))
            .slice(-10)
            .map((h: any) => ({ role: h.role, content: String(h.content).slice(0, 2000) }));
        const reply = await callOpenAI([system, ...trimmed, { role: 'user', content: String(message).slice(0, 2000) }], {
            max_tokens: 500,
        });
        res.json({ status: 'success', reply });
    } catch (err: any) {
        res.status(err.statusCode || 500).json({ status: 'error', message: err.message });
    }
};

// POST /recommendations — rank a brand's catalogue for a shopper using OpenAI.
// POST /chat/transcribe — voice input for the chat: a short recording
// (multipart field "audio") is turned into text by OpenAI speech-to-text.
// Uses Node's own fetch/FormData (node-fetch v2 cannot send multipart).
const TRANSCRIBE_URL = 'https://api.openai.com/v1/audio/transcriptions';
const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1';

exports.transcribe = async (req: any, res: any) => {
    try {
        const key = process.env.OPENAI_API_KEY;
        if (!key) {
            return res.status(503).json({ status: 'error', message: 'AI is not configured. Set OPENAI_API_KEY on the server.' });
        }
        if (!req.file || !req.file.buffer?.length) {
            return res.status(400).json({ status: 'fail', message: 'audio is required' });
        }
        const form = new FormData();
        const name = req.file.originalname || 'speech.webm';
        form.append('file', new Blob([req.file.buffer], { type: req.file.mimetype || 'audio/webm' }), name);
        form.append('model', TRANSCRIBE_MODEL);
        const language = String(req.body?.language || '').slice(0, 5);
        if (/^[a-z]{2}$/.test(language)) form.append('language', language);
        const resp = await (globalThis as any).fetch(TRANSCRIBE_URL, {
            method: 'POST',
            headers: { Authorization: `Bearer ${key}` },
            body: form,
        });
        if (!resp.ok) {
            console.error('OpenAI transcription failed:', resp.status, await resp.text());
            return res.status(502).json({ status: 'error', message: `Transcription failed (${resp.status})` });
        }
        const data: any = await resp.json();
        res.json({ status: 'success', text: String(data?.text || '').trim() });
    } catch (err: any) {
        res.status(500).json({ status: 'error', message: err.message });
    }
};

exports.recommendations = async (req: any, res: any) => {
    try {
        const { ownerId, ownerKind, preferences } = req.body || {};
        // How many picks (the Recommend page asks for 9); products never to
        // pick (the one being looked at, the ones the shopper said no to).
        const count = Math.max(1, Math.min(12, parseInt(req.body?.count, 10) || 8));
        const exclude = new Set((Array.isArray(req.body?.excludeIds) ? req.body.excludeIds : []).map(String));
        // A signed-in shopper (user_id): their history is read here and
        // analysed with the product they are looking at (currentProductId).
        let prefs = preferences;
        const userId = req.body?.user_id;
        const currentProductId = req.body?.currentProductId ? String(req.body.currentProductId) : '';
        if (userId) {
            const h = await shopperHistory(String(userId), currentProductId);
            if (h) {
                h.dislikedIds.forEach((id: string) => exclude.add(id));
                const { dislikedIds, ...history } = h;
                prefs = { ...(preferences || {}), ...history };
            }
        }
        if (currentProductId) exclude.add(currentProductId);
        const filter: any = { is_deleted: false };
        // Brand-scoped recommendations recommend that brand's own catalogue.
        if (ownerKind === 'Company' && ownerId) {
            try {
                filter.company_id = mongoose.Types.ObjectId(String(ownerId));
            } catch (e) {
                filter.company_id = ownerId;
            }
        }
        const products = (await Product.find(filter).limit(60).lean()).filter((p: any) => !exclude.has(String(p._id)));
        if (!products.length) {
            return res.json({ status: 'success', data: [] });
        }

        const catalogue = products.map((p: any) => ({
            id: String(p._id),
            name: p.name || '',
            model: p.model || '',
            type: p.productType || p.itemCategory || '',
            brand: p.brandInfo?.name || '',
            detail: String(p.detail || '').slice(0, 160),
        }));
        const system = {
            role: 'system',
            content:
                'You are a merchandising assistant. Given a product catalogue (JSON) and optional shopper ' +
                'preferences, choose and rank the best products to recommend. Respond ONLY as JSON: ' +
                '{"ranked":[{"id":"<id>","reason":"<short reason>"}]}. ' +
                `Include exactly ${count} items when the catalogue has that many, most relevant first. ` +
                'Analyse the shopper history: "current" is the product they are looking at now, "liked" and "inCart" show what they want, ' +
                '"scanned" what interested them, "disliked" what to steer away from. Favour products similar in type, style and brand ' +
                'to current, liked and inCart; avoid ones like disliked. Each reason: one short sentence to the shopper.',
        };
        const user = {
            role: 'user',
            content:
                `Shopper history and preferences: ${prefs ? JSON.stringify(prefs) : 'none provided — recommend broadly appealing, high-quality items'}\n\n` +
                `Catalogue:\n${JSON.stringify(catalogue)}`,
        };
        const raw = await callOpenAI([system, user], { json: true, max_tokens: 900, temperature: 0.4 });

        let ranked: any[] = [];
        try {
            const parsed = JSON.parse(raw);
            ranked = Array.isArray(parsed) ? parsed : parsed.ranked || parsed.products || [];
        } catch (e) {
            ranked = [];
        }
        const byId: any = {};
        products.forEach((p: any) => {
            byId[String(p._id)] = p;
        });
        const reasons: any = {};
        const ordered = ranked
            .map((r: any) => {
                const id = typeof r === 'string' ? r : r && r.id;
                if (r && r.reason) reasons[id] = r.reason;
                return byId[id];
            })
            .filter(Boolean);
        // Fewer picks than asked for: filled up from the rest of the catalogue.
        // Each product once (the AI can name one twice), then filled up.
        const seen = new Set<string>();
        const unique = ordered.filter((p: any) => { const id = String(p._id); if (seen.has(id)) return false; seen.add(id); return true; });
        const filled = [...unique, ...products.filter((p: any) => !seen.has(String(p._id)))].slice(0, count);
        const result = filled.map((p: any) => ({
            ...p,
            ai_reason: reasons[String(p._id)] || undefined,
        }));
        res.json({ status: 'success', data: result });
    } catch (err: any) {
        res.status(err.statusCode || 500).json({ status: 'error', message: err.message });
    }
};
