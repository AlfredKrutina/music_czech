/**
 * Cloudflare Worker — CORS Proxy for Apple Music playlist fetching
 *
 * Deployment:
 *   1. Go to https://workers.cloudflare.com → Sign up (free)
 *   2. Create Worker → Paste this code → Save & Deploy
 *   3. Copy the worker URL (e.g. https://music-proxy.YOUR-NAME.workers.dev)
 *   4. Set WORKER_URL in js/config.js
 *
 * Free tier: 100,000 requests/day — more than enough.
 */

const ALLOWED_ORIGINS = [
  'https://alfredkrutina.github.io',
  'http://localhost',
  'http://127.0.0.1',
];

// Only proxy these domains — security safeguard
const ALLOWED_TARGET_HOSTS = [
  'music.apple.com',
];

export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return corsResponse(null, 204);
    }

    const url = new URL(request.url);

    // ─── YOUTUBE SEARCH ENDPOINT ───────────────────────────────────────
    if (url.pathname === '/youtube') {
      const query = url.searchParams.get('q');
      if (!query) return corsResponse(JSON.stringify({ error: 'Missing ?q=' }), 400, 'application/json');

      try {
        const ytUrl = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(query);
        const ytResponse = await fetch(ytUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
          }
        });
        
        const html = await ytResponse.text();
        const match = html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
        
        if (match && match[1]) {
          return corsResponse(JSON.stringify({ videoId: match[1] }), 200, 'application/json');
        } else {
          return corsResponse(JSON.stringify({ error: 'No video found' }), 404, 'application/json');
        }
      } catch (err) {
        return corsResponse(JSON.stringify({ error: err.message }), 502, 'application/json');
      }
    }
    // ─── SPOTIFY SCRAPER ENDPOINT ──────────────────────────────────────
    if (url.pathname === '/spotify') {
      const playlistId = url.searchParams.get('id');
      if (!playlistId) return corsResponse(JSON.stringify({ error: 'Missing ?id=' }), 400, 'application/json');

      try {
        const embedUrl = `https://open.spotify.com/embed/playlist/${playlistId}`;
        const response = await fetch(embedUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          }
        });
        
        const html = await response.text();
        const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/);
        
        if (match && match[1]) {
          const data = JSON.parse(match[1]);
          const trackList = data.props?.pageProps?.state?.data?.entity?.trackList;
          if (trackList) {
             const cleanTracks = trackList.map(t => ({
                name: t.title,
                artist: t.subtitle,
                coverUrl: t.coverArt?.sources?.[0]?.url || ''
             }));
             return corsResponse(JSON.stringify({ tracks: cleanTracks }), 200, 'application/json');
          }
        }
        return corsResponse(JSON.stringify({ error: 'Failed to extract Spotify data' }), 404, 'application/json');
      } catch (err) {
        return corsResponse(JSON.stringify({ error: err.message }), 502, 'application/json');
      }
    }

    // ─── APPLE MUSIC CORS PROXY ────────────────────────────────────────
    const targetUrl = url.searchParams.get('url');

    if (!targetUrl) {
      return corsResponse(JSON.stringify({ error: 'Missing ?url= parameter' }), 400, 'application/json');
    }

    let parsedTarget;
    try {
      parsedTarget = new URL(targetUrl);
    } catch (e) {
      return corsResponse(JSON.stringify({ error: 'Invalid target URL' }), 400, 'application/json');
    }

    // Security: only proxy allowed hosts
    const targetHost = parsedTarget.hostname;
    const isAllowed = ALLOWED_TARGET_HOSTS.some(h => targetHost === h || targetHost.endsWith('.' + h));
    if (!isAllowed) {
      return corsResponse(JSON.stringify({ error: `Host not allowed: ${targetHost}` }), 403, 'application/json');
    }

    try {
      const response = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Cache-Control': 'no-cache',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
        },
        redirect: 'follow',
        cf: {
          // Cache at Cloudflare edge for 5 minutes to save requests
          cacheTtl: 300,
          cacheEverything: true,
        },
      });

      const contentType = response.headers.get('Content-Type') || 'text/html';
      const body = await response.text();

      return corsResponse(body, response.status, contentType);

    } catch (err) {
      return corsResponse(
        JSON.stringify({ error: 'Fetch failed', detail: err.message }),
        502,
        'application/json'
      );
    }
  }
};

function corsResponse(body, status = 200, contentType = 'text/html; charset=utf-8') {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Max-Age': '86400',
    'Content-Type': contentType,
  };

  if (body === null) {
    return new Response(null, { status, headers });
  }

  return new Response(body, { status, headers });
}
