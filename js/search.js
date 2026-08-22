/**
 * search.js — YouTube video search via Invidious & Piped public APIs.
 * No API key required. Includes instance failover and result caching.
 */
const YouTubeSearch = {
    _cache: new Map(),
    _workingInvidious: null,
    _workingPiped: null,

    /**
     * Search for a YouTube video matching the given artist + track name.
     * @returns {Promise<{videoId: string, title: string, channel: string}|null>}
     */
    async search(artist, trackName) {
        const query = `${artist} - ${trackName}`;
        const cacheKey = query.toLowerCase().trim();

        if (this._cache.has(cacheKey)) {
            return this._cache.get(cacheKey);
        }

        let result = null;

        // Try Invidious instances (prefer last working one)
        result = await this._tryInstances(
            CONFIG.YOUTUBE_SEARCH.INVIDIOUS,
            this._workingInvidious,
            (instance) => this._searchInvidious(query, artist, trackName, instance)
        );

        if (result && result._instance) {
            this._workingInvidious = result._instance;
            delete result._instance;
        }

        // Fallback to Piped
        if (!result) {
            result = await this._tryInstances(
                CONFIG.YOUTUBE_SEARCH.PIPED,
                this._workingPiped,
                (instance) => this._searchPiped(query, artist, trackName, instance)
            );

            if (result && result._instance) {
                this._workingPiped = result._instance;
                delete result._instance;
            }
        }

        // Final Fallback: Local Server Proxy (scrapes YouTube directly)
        if (!result) {
            try {
                const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
                if (response.ok) {
                    const data = await response.json();
                    if (data && data.videoId) {
                        result = {
                            videoId: data.videoId,
                            title: trackName,
                            channel: artist
                        };
                    }
                }
            } catch (e) {
                console.warn('Local proxy search failed:', e.message);
            }
        }

        if (result) {
            this._cache.set(cacheKey, result);
        }

        return result;
    },

    /**
     * Try a list of instances, starting with the known-good one.
     */
    async _tryInstances(instances, preferredInstance, searchFn) {
        // Build ordered list: preferred first, then the rest
        const ordered = preferredInstance
            ? [preferredInstance, ...instances.filter(i => i !== preferredInstance)]
            : [...instances];

        for (const instance of ordered) {
            try {
                const result = await searchFn(instance);
                if (result) {
                    result._instance = instance;
                    return result;
                }
            } catch (e) {
                console.warn(`Search instance ${instance} failed:`, e.message);
            }
        }
        return null;
    },

    /**
     * Search via Invidious REST API.
     */
    async _searchInvidious(query, artist, trackName, instance) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);

        try {
            const url = `${instance}/api/v1/search?q=${encodeURIComponent(query)}&type=video&sort_by=relevance`;
            const response = await fetch(url, { signal: controller.signal });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const results = await response.json();
            const videos = Array.isArray(results)
                ? results.filter(r => r.type === 'video' && r.videoId)
                : [];

            const best = this._pickBestVideo(videos, artist, trackName);
            if (best) {
                return {
                    videoId: best.videoId,
                    title: best.title || '',
                    channel: best.author || ''
                };
            }
            return null;
        } finally {
            clearTimeout(timeout);
        }
    },

    /**
     * Search via Piped REST API.
     */
    async _searchPiped(query, artist, trackName, instance) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);

        try {
            const url = `${instance}/search?q=${encodeURIComponent(query)}&filter=videos`;
            const response = await fetch(url, { signal: controller.signal });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const data = await response.json();
            const videos = (data.items || []).filter(
                item => item.type === 'stream' && item.url && item.url.includes('?v=')
            ).map(v => {
                return {
                    ...v,
                    videoId: v.url.split('?v=')[1].split('&')[0]
                };
            });

            const best = this._pickBestVideo(videos, artist, trackName);
            if (best) {
                return {
                    videoId: best.videoId,
                    title: best.title || '',
                    channel: best.uploaderName || ''
                };
            }
            return null;
        } finally {
            clearTimeout(timeout);
        }
    },

    /**
     * Heuristics engine to pick the correct studio version of a song from search results.
     */
    _pickBestVideo(videos, artist, trackName) {
        if (!videos || videos.length === 0) return null;

        const origTitleLower = trackName.toLowerCase();
        const origArtistLower = artist.toLowerCase();

        let bestVideo = videos[0];
        let bestScore = -9999;

        for (const v of videos) {
            let score = 0;
            const title = (v.title || '').toLowerCase();
            const channel = (v.channel || v.author || v.uploaderName || '').toLowerCase();
            const duration = v.lengthSeconds || v.duration || 0;

            // 1. Channel check (Massive bonus for Official Audio / Topic channels)
            // YouTube Music tracks are uploaded to "Artist - Topic" channels.
            if (channel.includes('- topic') || channel.includes('topic -')) {
                score += 50; 
            } else if (channel.includes(origArtistLower) || channel.replace(/\s/g, '').includes(origArtistLower.replace(/\s/g, ''))) {
                score += 20; // Official artist channel
            } else if (channel.includes('vevo')) {
                score += 15;
            }

            // 2. Title Positive check
            if (title.includes('official audio')) score += 15;
            if (title.includes('official video') || title.includes('official music video')) score += 10;
            if (title.includes('lyric')) score += 5; // lyric videos are usually studio audio

            // 3. Title Negative check (Penalize if original song doesn't have these words)
            const badWords = ['live', 'cover', 'karaoke', 'instrumental', 'remix', 'nightcore', 'tutorial', '8d', 'slowed', 'reverb', 'bass boosted'];
            for (const word of badWords) {
                if (title.includes(word) && !origTitleLower.includes(word)) {
                    score -= 50;
                }
            }

            // 4. Duration check (Avoid full albums or tiny clips)
            if (duration > 0) {
                if (duration > 600) score -= 100; // > 10 mins
                if (duration < 60) score -= 50;   // < 1 min
            }

            if (score > bestScore) {
                bestScore = score;
                bestVideo = v;
            }
        }

        return bestVideo;
    },

    /**
     * Clear the search cache.
     */
    clearCache() {
        this._cache.clear();
        this._workingInvidious = null;
        this._workingPiped = null;
    }
};
