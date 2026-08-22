/**
 * config.js — Global configuration constants
 */
const CONFIG = {
    // Clip durations for each attempt (seconds)
    // Starts at 0.5s because YouTube's audio buffer often swallows shorter clips
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
            'https://invidious.fdn.fr',
            'https://vid.puffyan.us',
            'https://invidious.nerdvpn.de',
            'https://yewtu.be',
            'https://invidious.lunar.icu',
            'https://invidious.jing.rocks',
            'https://invidious.privacyredirect.com'
        ],
        PIPED: [
            'https://pipedapi.kavin.rocks',
            'https://piped-api.privacy.com.de',
            'https://pipedapi.tokhmi.xyz',
            'https://pipedapi.syncpundit.io'
        ]
    },

    // Local proxy for Apple Music to bypass Apple's blocks on public CORS proxies
    CORS_PROXIES: [
        '/api/proxy?url='
    ]
};
