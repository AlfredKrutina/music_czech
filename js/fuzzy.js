/**
 * fuzzy.js — Lightweight fuzzy string matching for autocomplete and guess validation.
 * Handles diacritics (Czech, etc.) by normalizing to ASCII.
 */
const FuzzySearch = {
    /**
     * Normalize a string: lowercase, strip diacritics, remove non-alphanumeric.
     */
    normalize(str) {
        return str
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')  // strip combining diacritical marks
            .replace(/[^a-z0-9\s]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    },

    /**
     * Calculate a fuzzy match score between query and target (0 to 1).
     * Higher = better match. Returns 0 if not all query characters are found in order.
     */
    score(query, target) {
        const q = this.normalize(query);
        const t = this.normalize(target);

        if (!q || !t) return 0;
        if (t === q) return 1.0;
        if (t.startsWith(q)) return 0.95;
        if (t.includes(q)) return 0.9;

        // Subsequence matching with consecutive char bonus
        let qi = 0;
        let consecutive = 0;
        let maxConsecutive = 0;
        let firstMatchIndex = -1;

        for (let ti = 0; ti < t.length && qi < q.length; ti++) {
            if (t[ti] === q[qi]) {
                if (firstMatchIndex === -1) firstMatchIndex = ti;
                qi++;
                consecutive++;
                maxConsecutive = Math.max(maxConsecutive, consecutive);
            } else {
                consecutive = 0;
            }
        }

        // Not all query characters found in sequence
        if (qi < q.length) return 0;

        const completeness = q.length / t.length;             // shorter targets score higher
        const consecutiveRatio = maxConsecutive / q.length;    // reward consecutive matches
        const positionBonus = 1 - (firstMatchIndex / t.length); // reward early matches

        return (completeness * 0.3) + (consecutiveRatio * 0.5) + (positionBonus * 0.2);
    },

    /**
     * Search items by fuzzy matching a query against a key.
     * @param {string} query - User input
     * @param {Array} items - Array of objects
     * @param {string} key - Property name to match against
     * @returns {Array} Filtered and sorted items (best match first)
     */
    search(query, items, key) {
        if (!query || !query.trim() || !items || items.length === 0) return [];

        const scored = items.map(item => ({
            item,
            score: this.score(query, key ? item[key] : String(item))
        }));

        return scored
            .filter(s => s.score > 0.15)
            .sort((a, b) => b.score - a.score)
            .map(s => s.item);
    },

    /**
     * Check if a guess matches the answer within the configured threshold.
     * Tries matching against the full display name and individual parts.
     */
    isMatch(guess, track) {
        const threshold = CONFIG.GUESS_THRESHOLD;
        const fullName = `${track.artist} - ${track.name}`;

        // Exact-ish matches (after normalization)
        if (this.normalize(guess) === this.normalize(fullName)) return true;
        if (this.normalize(guess) === this.normalize(track.name)) return true;

        // Fuzzy match against various representations
        return (
            this.score(guess, fullName) >= threshold ||
            this.score(guess, track.name) >= threshold ||
            this.score(guess, `${track.name} ${track.artist}`) >= threshold
        );
    }
};
