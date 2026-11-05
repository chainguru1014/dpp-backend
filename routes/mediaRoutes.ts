const express = require('express');
const fetch = require('node-fetch');
const router = express.Router();

// GET /media/youtube-orientation/:videoId -> { orientation: 'portrait' | 'landscape' }
//
// The app's full-screen video viewer turns the player to match the video's
// shape. YouTube's player API and oEmbed don't say whether a video is
// portrait (oEmbed reports 200x113 even for Shorts), but youtube.com/shorts/<id>
// answers 200 for a Short (portrait) and redirects to /watch for any other
// video (landscape). A browser can't read that redirect cross-origin, so the
// check runs here. The consent cookie skips YouTube's EU consent redirect
// (this server is in Sweden). Unknown/failed checks report landscape.
const cache = new Map<string, string>();
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

router.get('/youtube-orientation/:videoId', async (req: any, res: any) => {
    const { videoId } = req.params;
    if (!VIDEO_ID.test(videoId)) {
        return res.status(400).json({ status: 'fail', message: 'Invalid YouTube video id' });
    }
    let orientation = cache.get(videoId);
    if (!orientation) {
        try {
            const r = await fetch(`https://www.youtube.com/shorts/${videoId}`, {
                method: 'GET',
                redirect: 'manual',
                timeout: 8000,
                headers: { 'User-Agent': 'Mozilla/5.0', Cookie: 'SOCS=CAI; CONSENT=YES+cb' },
            });
            if (r.status === 200) orientation = 'portrait';
            else if (r.status >= 300 && r.status < 400 && /\/watch\?/.test(r.headers.get('location') || '')) orientation = 'landscape';
            if (orientation) {
                if (cache.size > 5000) cache.clear();
                cache.set(videoId, orientation);
            }
        } catch (e) {
            // fall through to the default below, uncached, so a retry can succeed
        }
    }
    res.set('Cache-Control', 'public, max-age=86400');
    res.status(200).json({ status: 'success', orientation: orientation || 'landscape' });
});

module.exports = router;
