/**
 * playlist.js — Playlist URL parsing and track fetching.
 *
 * Supports:
 *   - Spotify playlists (requires PKCE auth via SpotifyAuth)
 *   - YouTube / YouTube Music playlists (via Invidious/Piped, no auth needed)
 *   - Apple Music playlists (via CORS proxy + JSON-LD extraction, no auth needed)
 */
const PlaylistLoader = {
    /**
     * Detect the platform from a URL string.
     * @returns {'spotify'|'youtube'|'apple'|null}
     */
    detectPlatform(url) {
        if (!url || typeof url !== 'string') return null;
        const u = url.trim().toLowerCase();

        if (u.includes('spotify.com/playlist/') || u.startsWith('spotify:playlist:')) {
            return 'spotify';
        }
        if (u.includes('music.youtube.com/playlist') ||
            u.includes('youtube.com/playlist') ||
            (u.includes('youtube.com') && u.includes('list='))) {
            return 'youtube';
        }
        if (u.includes('music.apple.com') && u.includes('/playlist/')) {
            return 'apple';
        }
        return null;
    },

    /**
     * Extract Spotify playlist ID from URL or URI.
     */
    parseSpotifyId(url) {
        const match = url.match(/(?:playlist\/|spotify:playlist:)([a-zA-Z0-9]+)/);
        return match ? match[1] : null;
    },

    /**
     * Extract YouTube playlist ID from URL.
     */
    parseYouTubeId(url) {
        const match = url.match(/[?&]list=([a-zA-Z0-9_-]+)/);
        return match ? match[1] : null;
    },

    /**
     * Load tracks from a playlist URL.
     * @param {string} url - Spotify or YouTube Music playlist URL
     * @param {function} onProgress - Callback (current, total, message)
     * @returns {Promise<Array<{name, artist, id?, videoId?, displayName}>>}
     */
    async loadPlaylist(url, onProgress) {
        const platform = this.detectPlatform(url);

        if (platform === 'spotify') {
            return this._loadSpotify(url, onProgress);
        }
        if (platform === 'youtube') {
            return this._loadYouTube(url, onProgress);
        }
        if (platform === 'apple') {
            return this._loadAppleMusic(url, onProgress);
        }

        throw new Error(
            'Unsupported playlist URL.\n\n' +
            'Supported formats:\n' +
            '• Spotify: https://open.spotify.com/playlist/...\n' +
            '• YouTube Music: https://music.youtube.com/playlist?list=...\n' +
            '• YouTube: https://www.youtube.com/playlist?list=...\n' +
            '• Apple Music: https://music.apple.com/.../playlist/...'
        );
    },

    // ─── Spotify ─────────────────────────────────────────────────────

    async _loadSpotify(url, onProgress) {
        const playlistId = this.parseSpotifyId(url);
        if (!playlistId) {
            throw new Error('Could not extract playlist ID from the Spotify URL.');
        }

        // Ensure we have a valid token
        let token = SpotifyAuth.getToken();
        if (!token) {
            if (onProgress) onProgress(0, 0, 'Authenticating with Spotify...');
            await SpotifyAuth.authenticate();
            token = SpotifyAuth.getToken();
        }
        if (!token) {
            throw new Error('Failed to obtain Spotify access token.');
        }

        const tracks = [];
        let offset = 0;
        const limit = 100;
        let total = null;

        while (true) {
            const apiUrl = `${CONFIG.SPOTIFY.API_BASE}/playlists/${playlistId}/tracks` +
                `?offset=${offset}&limit=${limit}` +
                `&fields=${encodeURIComponent('total,items(track(name,artists(name),id,duration_ms))')}`;

            const response = await fetch(apiUrl, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (response.status === 401) {
                SpotifyAuth.logout();
                throw new Error('Spotify token expired. Please try again to re-authenticate.');
            }
            if (response.status === 429) {
                const retryAfter = parseInt(response.headers.get('Retry-After') || '2', 10);
                if (onProgress) onProgress(tracks.length, total || 100, `Spotify rate limit. Waiting ${retryAfter}s...`);
                await new Promise(r => setTimeout(r, retryAfter * 1000));
                continue; // Retry the same offset
            }
            if (response.status === 404) {
                throw new Error('Playlist not found. Check the URL and make sure the playlist is public or you have access.');
            }
            if (!response.ok) {
                throw new Error(`Spotify API error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            if (total === null) total = data.total || 0;

            for (const item of (data.items || [])) {
                if (!item.track || !item.track.name) continue;
                if (item.track.is_local) continue; // Skip local files

                const artist = item.track.artists.map(a => a.name).join(', ');
                tracks.push({
                    name: item.track.name,
                    artist: artist,
                    id: item.track.id,
                    displayName: `${artist} — ${item.track.name}`
                });
            }

            if (onProgress) onProgress(tracks.length, total, 'Fetching playlist tracks...');

            offset += limit;
            if (offset >= total || (data.items || []).length === 0) break;
        }

        if (tracks.length === 0) {
            throw new Error('The playlist is empty or all tracks are unavailable.');
        }

        return tracks;
    },

    // ─── YouTube / YouTube Music ─────────────────────────────────────

    async _loadYouTube(url, onProgress) {
        const playlistId = this.parseYouTubeId(url);
        if (!playlistId) {
            throw new Error('Could not extract playlist ID from the YouTube URL.');
        }

        if (onProgress) onProgress(0, 0, 'Fetching YouTube playlist...');

        // Try Invidious instances first
        for (const instance of CONFIG.YOUTUBE_SEARCH.INVIDIOUS) {
            try {
                const tracks = await this._fetchInvidiousPlaylist(instance, playlistId, onProgress);
                if (tracks && tracks.length > 0) return tracks;
            } catch (e) {
                console.warn(`Invidious playlist fetch from ${instance} failed:`, e.message);
            }
        }

        // Try Piped instances
        for (const instance of CONFIG.YOUTUBE_SEARCH.PIPED) {
            try {
                const tracks = await this._fetchPipedPlaylist(instance, playlistId, onProgress);
                if (tracks && tracks.length > 0) return tracks;
            } catch (e) {
                console.warn(`Piped playlist fetch from ${instance} failed:`, e.message);
            }
        }

        throw new Error(
            'Could not load the YouTube playlist from any available service.\n' +
            'The playlist might be private, or all search backends might be down.'
        );
    },

    async _fetchInvidiousPlaylist(instance, playlistId, onProgress) {
        let allTracks = [];
        let page = 1;
        const MAX_PAGES = 10; // Support up to 1000 tracks (100 per page)

        while (page <= MAX_PAGES) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 12000);

            try {
                const response = await fetch(
                    `${instance}/api/v1/playlists/${playlistId}?page=${page}`,
                    { signal: controller.signal }
                );
                if (!response.ok) throw new Error(`HTTP ${response.status}`);

                const data = await response.json();
                const videos = data.videos || [];
                if (videos.length === 0) break;

                const tracks = videos
                    .filter(v => v.videoId && v.title)
                    .map(v => {
                        const parts = this._splitArtistTitle(v.title, v.author);
                        return {
                            name: parts.title,
                            artist: parts.artist,
                            videoId: v.videoId,
                            displayName: `${parts.artist} — ${parts.title}`
                        };
                    });

                allTracks = allTracks.concat(tracks);
                if (onProgress) onProgress(allTracks.length, allTracks.length, `Fetched ${allTracks.length} tracks...`);

                if (videos.length < 100) break; // Last page
                page++;
            } finally {
                clearTimeout(timeout);
            }
        }

        if (onProgress) onProgress(allTracks.length, allTracks.length, 'Playlist loaded!');
        return allTracks;
    },

    async _fetchPipedPlaylist(instance, playlistId, onProgress) {
        let allTracks = [];
        let nextpage = null;
        let page = 0;
        const MAX_PAGES = 10;

        do {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 12000);

            try {
                let endpoint;
                if (page === 0) {
                    endpoint = `${instance}/playlists/${playlistId}`;
                } else {
                    endpoint = `${instance}/nextpage/playlists/${playlistId}?nextpage=${encodeURIComponent(nextpage)}`;
                }

                const response = await fetch(endpoint, { signal: controller.signal });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);

                const data = await response.json();
                const streams = (data.relatedStreams || []);

                const tracks = streams
                    .filter(v => v.url && v.title)
                    .map(v => {
                        const videoId = v.url.split('?v=')[1]?.split('&')[0] || '';
                        const parts = this._splitArtistTitle(v.title, v.uploaderName);
                        return {
                            name: parts.title,
                            artist: parts.artist,
                            videoId: videoId,
                            displayName: `${parts.artist} — ${parts.title}`
                        };
                    })
                    .filter(t => t.videoId); // Only tracks with valid videoId

                allTracks = allTracks.concat(tracks);
                if (onProgress) onProgress(allTracks.length, allTracks.length, `Fetched ${allTracks.length} tracks...`);

                nextpage = data.nextpage || null;
                page++;
            } finally {
                clearTimeout(timeout);
            }
        } while (nextpage && page < MAX_PAGES);

        if (onProgress) onProgress(allTracks.length, allTracks.length, 'Playlist loaded!');
        return allTracks;
    },

    /**
     * Try to split a YouTube video title into artist and song title.
     * Common formats: "Artist - Title", "Artist — Title", "Artist | Title"
     */
    _splitArtistTitle(title, channelName) {
        // Try various separators
        const separators = [' - ', ' — ', ' – ', ' | '];
        for (const sep of separators) {
            const idx = title.indexOf(sep);
            if (idx > 0 && idx < title.length - sep.length) {
                return {
                    artist: title.substring(0, idx).trim(),
                    title: title.substring(idx + sep.length).trim()
                        .replace(/\s*\(.*?(official|lyrics|audio|video|hd|hq).*?\)\s*/gi, '')
                        .replace(/\s*\[.*?(official|lyrics|audio|video|hd|hq).*?\]\s*/gi, '')
                        .trim()
                };
            }
        }
        // Fallback: use channel name as artist, full title as track name
        return {
            artist: channelName || 'Unknown Artist',
            title: title
                .replace(/\s*\(.*?(official|lyrics|audio|video|hd|hq).*?\)\s*/gi, '')
                .replace(/\s*\[.*?(official|lyrics|audio|video|hd|hq).*?\]\s*/gi, '')
                .trim()
        };
    },

    // ─── Apple Music ─────────────────────────────────────────────────

    /**
     * Load tracks from an Apple Music playlist.
     *
     * Strategy:
     *   1. Cloudflare Worker proxy (fast, reliable — set APPLE_MUSIC_WORKER_URL in config.js)
     *   2. Local dev proxy (only when running on localhost)
     *   3. Fallback public CORS proxies (usually blocked by Apple, shown as last resort)
     */
    async _loadAppleMusic(url, onProgress) {
        if (onProgress) onProgress(0, 0, 'Fetching Apple Music playlist...');

        let html = null;

        // ── Step 1: Try Cloudflare Worker (primary, reliable) ──────────────
        const workerUrl = CONFIG.APPLE_MUSIC_WORKER_URL;
        if (workerUrl && workerUrl.trim()) {
            if (onProgress) onProgress(0, 0, 'Connecting to proxy...');
            try {
                const endpoint = workerUrl.trim().replace(/\/$/, '') + '?url=' + encodeURIComponent(url.trim());
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 15000);

                const response = await fetch(endpoint, { signal: controller.signal });
                clearTimeout(timeout);

                if (response.ok) {
                    const text = await response.text();
                    if (text && text.length > 1000 &&
                        (text.includes('serialized-server-data') ||
                         text.includes('music.apple.com') ||
                         text.includes('MusicPlaylist'))) {
                        html = text;
                    }
                }
            } catch (e) {
                console.warn('Cloudflare Worker proxy failed:', e.message);
            }
        }

        // ── Step 2: Local dev proxy (localhost only) ───────────────────────
        const isLocal = window.location.hostname.match(/^(localhost|127\.|0\.0\.0\.0|::1)/);
        if (!html && isLocal) {
            if (onProgress) onProgress(0, 0, 'Trying local proxy...');
            try {
                const proxyUrl = '/api/proxy?url=' + encodeURIComponent(url.trim());
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 15000);
                const response = await fetch(proxyUrl, { signal: controller.signal });
                clearTimeout(timeout);
                if (response.ok) {
                    const text = await response.text();
                    if (text && text.length > 1000 &&
                        (text.includes('serialized-server-data') || text.includes('MusicPlaylist'))) {
                        html = text;
                    }
                }
            } catch (e) {
                console.warn('Local proxy failed:', e.message);
            }
        }

        // ── Step 3: Fallback public CORS proxies ───────────────────────────
        if (!html) {
            for (const proxy of CONFIG.CORS_PROXIES) {
                if (proxy.startsWith('/')) continue; // already tried local above
                const proxyLabel = new URL(proxy).hostname;
                if (onProgress) onProgress(0, 0, `Trying ${proxyLabel}...`);

                try {
                    const proxyUrl = proxy + encodeURIComponent(url.trim());
                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), 12000);
                    const response = await fetch(proxyUrl, { signal: controller.signal });
                    clearTimeout(timeout);
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    const text = await response.text();
                    if (text && text.length > 1000 &&
                        (text.includes('serialized-server-data') || text.includes('music.apple.com') || text.includes('MusicPlaylist'))) {
                        html = text;
                        break;
                    }
                } catch (e) {
                    console.warn(`CORS proxy failed (${proxy}):`, e.message);
                }
            }
        }

        // ── No proxy worked ────────────────────────────────────────────────
        if (!html) {
            if (!workerUrl || !workerUrl.trim()) {
                // Worker not configured — give actionable setup instructions
                throw new Error(
                    'Apple Music requires a one-time proxy setup.\n\n' +
                    'Quick setup (free, 5 minutes):\n' +
                    '  1. Go to workers.cloudflare.com → Create free account\n' +
                    '  2. Create Worker → paste code from worker/cors-proxy.js\n' +
                    '  3. Deploy → copy URL → paste into js/config.js\n\n' +
                    'Alternatively, convert your playlist to Spotify or YouTube Music\n' +
                    'at TuneMyMusic.com (free).'
                );
            }
            throw new Error(
                'Could not fetch the Apple Music playlist.\n' +
                'The proxy may be temporarily unavailable. Please try again in a moment.'
            );
        }

        // Strategy 1: Extract from serialized Shoebox data (Apple's server-rendered data)
        // This is the most reliable and contains artist names
        let tracks = this._parseAppleMusicShoebox(html);

        // Strategy 2: Extract JSON-LD (schema.org) data as fallback
        if (!tracks || tracks.length === 0) {
            tracks = this._parseAppleMusicJsonLd(html);
        }

        // Strategy 3: Extract from meta tags as last resort
        if (!tracks || tracks.length === 0) {
            tracks = this._parseAppleMusicMeta(html);
        }

        if (!tracks || tracks.length === 0) {
            throw new Error(
                'Could not extract tracks from the Apple Music playlist.\n' +
                'The playlist might be empty or the page structure has changed.\n\n' +
                'Tip: Try converting your playlist at Soundiiz.com or TuneMyMusic.com.'
            );
        }

        if (onProgress) onProgress(tracks.length, tracks.length, 'Playlist loaded!');
        return tracks;
    },

    /**
     * Parse JSON-LD schema.org MusicPlaylist from Apple Music HTML.
     */
    _parseAppleMusicJsonLd(html) {
        const tracks = [];
        // Find all JSON-LD script blocks
        const jsonLdRegex = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
        let match;

        while ((match = jsonLdRegex.exec(html)) !== null) {
            try {
                const data = JSON.parse(match[1]);
                const playlists = Array.isArray(data) ? data : [data];

                for (const item of playlists) {
                    if (item['@type'] === 'MusicPlaylist' && item.track) {
                        const trackList = Array.isArray(item.track) ? item.track : [item.track];
                        for (const t of trackList) {
                            if (t.name || t['@type'] === 'MusicRecording') {
                                const name = t.name || 'Unknown';
                                let artist = 'Unknown Artist';

                                if (t.byArtist) {
                                    artist = typeof t.byArtist === 'string'
                                        ? t.byArtist
                                        : (t.byArtist.name || 'Unknown Artist');
                                }

                                tracks.push({
                                    name: name,
                                    artist: artist,
                                    displayName: `${artist} — ${name}`
                                });
                            }
                        }
                    }
                }
            } catch (e) {
                // Invalid JSON, try next block
                continue;
            }
        }
        return tracks;
    },

    /**
     * Parse Apple's "shoebox" server-rendered data blocks.
     * Apple embeds serialized data in <script id="serialized-server-data">
     *
     * Uses iterative BFS with an explicit stack to avoid stack overflow
     * on large playlists (500+ tracks create deeply nested JSON).
     */
    _parseAppleMusicShoebox(html) {
        // Look for the new serialized-server-data block
        const dataRegex = /id="serialized-server-data"[^>]*>([\s\S]*?)<\/script>/i;
        const match = dataRegex.exec(html);

        if (!match) return [];

        let rootData;
        try {
            rootData = JSON.parse(match[1]);
        } catch (e) {
            console.warn('Failed to parse serialized-server-data:', e);
            return [];
        }

        const tracks = [];
        const seen = new Set();

        // Iterative BFS using an explicit stack — avoids call stack overflow
        // on deeply nested Apple Music JSON objects.
        const stack = [rootData];
        const MAX_NODES = 100000; // Safety: stop after visiting this many nodes
        let visited = 0;

        while (stack.length > 0 && visited < MAX_NODES) {
            const obj = stack.pop();
            visited++;

            if (!obj || typeof obj !== 'object') continue;

            if (Array.isArray(obj)) {
                for (const item of obj) stack.push(item);
                continue;
            }

            // The track object contains artistName and title
            if (obj.artistName && obj.title && obj.id &&
                (obj.playAction || obj.kind === 'song' || obj.contentDescriptor)) {
                const key = `${obj.artistName}|${obj.title}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    tracks.push({
                        name: obj.title,
                        artist: obj.artistName,
                        displayName: `${obj.artistName} — ${obj.title}`
                    });
                }
            }

            // Push all object values onto the stack for further traversal
            for (const key in obj) {
                const val = obj[key];
                if (val && typeof val === 'object') stack.push(val);
            }
        }

        if (visited >= MAX_NODES) {
            console.warn('Apple Music shoebox: MAX_NODES limit reached, result may be partial.');
        }

        return tracks;
    },

    /**
     * Last-resort: extract track info from meta tags.
     * Apple Music pages have <meta property="music:song"> tags.
     */
    _parseAppleMusicMeta(html) {
        const tracks = [];

        // Try to extract from the page title and any structured content
        const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
        const songPattern = /<meta[^>]*property=["']music:song(?::track)?["'][^>]*content=["']([^"']+)["'][^>]*>/gi;
        let match;

        while ((match = songPattern.exec(html)) !== null) {
            // These URLs point to individual songs — extract the name from URL
            const songUrl = match[1];
            const nameMatch = songUrl.match(/\/([^/]+)\/\d+$/);
            if (nameMatch) {
                const name = nameMatch[1]
                    .replace(/-/g, ' ')
                    .replace(/\b\w/g, c => c.toUpperCase());
                tracks.push({
                    name: name,
                    artist: 'Unknown Artist',
                    displayName: `Unknown Artist — ${name}`
                });
            }
        }

        return tracks;
    }
};
