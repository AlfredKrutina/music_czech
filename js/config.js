/**
 * config.js — Global configuration constants
 */
const CONFIG = {
    // Clip durations for each attempt (seconds)
    SKIP_DURATIONS: [0.5, 1.0, 2.0, 4.0, 8.0, 16.0],

    // Points awarded per attempt (index matches SKIP_DURATIONS)
    POINTS: [6, 5, 4, 3, 2, 1],

    // Default number of rounds per game
    DEFAULT_ROUNDS: 10,

    // Minimum fuzzy match score to accept a guess as correct
    GUESS_THRESHOLD: 0.55,

    // Delay between YouTube searches to avoid rate limiting (ms)
    SEARCH_DELAY_MS: 350,

    // Spotify API configuration
    SPOTIFY: {
        AUTH_URL: 'https://accounts.spotify.com/authorize',
        TOKEN_URL: 'https://accounts.spotify.com/api/token',
        API_BASE: 'https://api.spotify.com/v1',
        SCOPES: 'playlist-read-private playlist-read-collaborative'
    },

    // YouTube search backends (no API key required)
    YOUTUBE_SEARCH: {
        INVIDIOUS: [
            'https://inv.tux.pizza',
            'https://invidious.privacyredirect.com',
            'https://yewtu.be',
            'https://invidious.nerdvpn.de',
            'https://invidious.fdn.fr',
            'https://iv.datura.network',
            'https://invidious.io.lol',
            'https://invidious.lunar.icu'
        ],
        PIPED: [
            'https://pipedapi.kavin.rocks',
            'https://piped-api.privacy.com.de',
            'https://pipedapi.tokhmi.xyz',
            'https://pipedapi.syncpundit.io',
            'https://api.piped.projectsegfau.lt'
        ]
    },

    // ─── Apple Music Configuration ────────────────────────────────────────────
    //
    // Apple Music requires a server-side proxy because browsers block
    // cross-origin requests to music.apple.com.
    //
    // SETUP (one-time, 5 minutes, free):
    //   1. Go to https://workers.cloudflare.com → create a free account
    //   2. Click "Create Worker" → paste the code from worker/cors-proxy.js
    //   3. Click "Save & Deploy" → copy the URL (e.g. https://xxx.workers.dev)
    //   4. Paste it below as WORKER_URL
    //
    // After setup, Apple Music playlists will work for ALL users automatically.
    //
    APPLE_MUSIC_WORKER_URL: 'https://music-proxy.alf-krutina.workers.dev', 

    // Fallback CORS proxies (used if worker is not configured; usually blocked by Apple)
    CORS_PROXIES: [
        '/api/proxy?url=',              // local dev server only
        'https://corsproxy.io/?url=',
        'https://api.allorigins.win/raw?url=',
        'https://corsproxy.org/?url=',
    ]
};

