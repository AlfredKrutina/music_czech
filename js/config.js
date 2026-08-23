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
    WORKER_URL: 'https://music-proxy.alf-krutina.workers.dev', 

    // Fallback CORS proxies (used if worker is not configured; usually blocked by Apple)
    CORS_PROXIES: [
        '/api/proxy?url=',              // local dev server only
        'https://corsproxy.io/?url=',
        'https://api.allorigins.win/raw?url=',
        'https://corsproxy.org/?url=',
    ],

    // ─── Curated Modes (Predefined Playlists & Vibe searches) ─────────────────
    PREDEFINED_PLAYLISTS: {
        "Decades": [
            { name: "2010s Pop Hits", url: "https://music.apple.com/us/playlist/10s-pop-essentials/pl.801ed8fb7eb0407a9dc8870123533ec7" },
            { name: "2000s Pop Hits", url: "https://music.apple.com/us/playlist/00s-pop-essentials/pl.f4d106fed2bd41149aaacabb233eb5eb" },
            { name: "90s Pop Hits", url: "https://music.apple.com/us/playlist/90s-pop-essentials/pl.5ee8333dbe944d9f9151e0f6f707ce56" },
            { name: "80s Pop Hits", url: "https://music.apple.com/us/playlist/80s-pop-essentials/pl.7c94b73347b74f32997e06a3ec02ba6d" }
        ],
        "Genres": [
            { name: "Pop", url: "https://music.apple.com/us/playlist/pop-essentials/pl.f4d106fed2bd41149aaacabb233eb5eb" },
            { name: "Hip-Hop", url: "https://music.apple.com/us/playlist/hip-hop-essentials/pl.004cc511bbab4294a8f949ccf5fc48b2" },
            { name: "Rock", url: "https://music.apple.com/us/playlist/rock-essentials/pl.27d928236306436bac776a94a2ca39b1" },
            { name: "R&B", url: "https://music.apple.com/us/playlist/r-b-essentials/pl.679ff96a1eb143719a770ccb8d65ba95" },
            { name: "Country", url: "https://music.apple.com/us/playlist/country-essentials/pl.87bb5b36a9bd49db8c975607452bfa2b" },
            { name: "EDM / Dance", url: "https://music.apple.com/us/playlist/dance-essentials/pl.76b7db2ce23a4b08b3e3bcacb7ec9903" },
            { name: "K-Pop", url: "https://music.apple.com/us/playlist/k-pop-essentials/pl.9950fa58c42445ccb033ad03e2c1e7a5" }
        ],
        "Top Artists": [
            { name: "The Weeknd", url: "https://music.apple.com/us/playlist/the-weeknd-essentials/pl.9eb97bc913dc40e9858f9188bf7fc900" },
            { name: "Taylor Swift", url: "https://music.apple.com/us/playlist/taylor-swift-essentials/pl.7ee6bc32ebbf41ebaba11ccfe134a475" },
            { name: "Drake", url: "https://music.apple.com/us/playlist/drake-essentials/pl.f10f8a96452f4ebdb9553aa312ed1f42" },
            { name: "Post Malone", url: "https://music.apple.com/us/playlist/post-malone-essentials/pl.807d9dcb8e4942d79d67b2d56a20b7cf" },
            { name: "Billie Eilish", url: "https://music.apple.com/us/playlist/billie-eilish-essentials/pl.0cf532cb16ba4462886fdbf9a15993b3" },
            { name: "Eminem", url: "https://music.apple.com/us/playlist/eminem-essentials/pl.35b1c676f62040c5be6e216999a0cbce" },
            { name: "Ariana Grande", url: "https://music.apple.com/us/playlist/ariana-grande-essentials/pl.e302be4c5e3f43399b3806bf2ce6399b" },
            { name: "Ed Sheeran", url: "https://music.apple.com/us/playlist/ed-sheeran-essentials/pl.98cebfa780d64e93aa25cce3f0ce5982" },
            { name: "Dua Lipa", url: "https://music.apple.com/us/playlist/dua-lipa-essentials/pl.dcd9d0e1b6a1476fba834015822ffbd7" },
            { name: "Bruno Mars", url: "https://music.apple.com/us/playlist/bruno-mars-essentials/pl.12b3f114c02f483cba639da00be28ed9" }
        ],
        "Legends & Bands": [
            { name: "Queen", url: "https://music.apple.com/us/playlist/queen-essentials/pl.a49f57ebbf7c43dfa77e596bb1a02931" },
            { name: "The Beatles", url: "https://music.apple.com/us/playlist/the-beatles-essentials/pl.b1bf82e8d3564024bef84c49f87455b8" },
            { name: "Michael Jackson", url: "https://music.apple.com/us/playlist/michael-jackson-essentials/pl.1345d137b0c841adbdfffa51d07c0e5a" },
            { name: "Coldplay", url: "https://music.apple.com/us/playlist/coldplay-essentials/pl.f339cf0b3687483783a31da5f6cbbaeb" },
            { name: "Oasis", url: "https://music.apple.com/us/playlist/oasis-essentials/pl.4b5e0c818ba040b2a8ed2945d8b7b752" },
            { name: "Linkin Park", url: "https://music.apple.com/us/playlist/linkin-park-essentials/pl.a4c330f576e945c7ad56af0bebb55ba0" },
            { name: "Nirvana", url: "https://music.apple.com/us/playlist/nirvana-essentials/pl.186a2ec64e834098bee30b8d5a6a6237" }
        ]
    }
};

