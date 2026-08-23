/**
 * ui.js — DOM manipulation, screen transitions, autocomplete, and visual feedback.
 *
 * All DOM element IDs referenced here must match index.html.
 */
const UI = {
    _autocompleteItems: [],
    _selectedIndex: -1,
    _allTracks: [],

    // ─── Initialization ──────────────────────────────────────────────

    init(onModeSelected = null) {
        this._ensureToastContainer();
        this.renderCuratedModes(onModeSelected);
    },

    _ensureToastContainer() {
        if (!document.getElementById('toast-container')) {
            const container = document.createElement('div');
            container.id = 'toast-container';
            document.body.appendChild(container);
        }
    },

    // ─── Screen Management ───────────────────────────────────────────

    showScreen(screenId) {
        document.querySelectorAll('.screen').forEach(s => {
            s.classList.remove('active');
            s.setAttribute('aria-hidden', 'true');
        });
        const screen = document.getElementById(screenId);
        if (screen) {
            screen.classList.add('active');
            screen.setAttribute('aria-hidden', 'false');
        }
        
        // Reset Chameleon background if not on result screen
        if (screenId !== 'screen-result') {
            const bgLayer = document.getElementById('bg-layer');
            if (bgLayer) {
                bgLayer.style.opacity = '0';
                setTimeout(() => {
                    if (bgLayer.style.opacity === '0') {
                        bgLayer.style.backgroundImage = 'none';
                    }
                }, 1500);
            }
        }
    },

    // ─── Setup Screen ────────────────────────────────────────────────

    renderCuratedModes(onModeSelected) {
        const container = document.getElementById('curated-modes-container');
        if (!container) return;

        container.innerHTML = '';
        
        if (!CONFIG.PREDEFINED_PLAYLISTS) return;

        const select = document.createElement('select');
        select.className = 'select-input';
        select.style.width = '100%';
        
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = '--- Select a curated vibe ---';
        defaultOption.disabled = true;
        defaultOption.selected = true;
        select.appendChild(defaultOption);

        for (const [categoryName, items] of Object.entries(CONFIG.PREDEFINED_PLAYLISTS)) {
            const optgroup = document.createElement('optgroup');
            optgroup.label = categoryName;

            items.forEach(item => {
                const option = document.createElement('option');
                option.value = item.url || item.name;
                option.textContent = item.name;
                optgroup.appendChild(option);
            });

            select.appendChild(optgroup);
        }

        if (onModeSelected) {
            select.addEventListener('change', (e) => {
                const val = e.target.value;
                if (val) {
                    if (val.startsWith('http')) {
                        onModeSelected(val);
                    } else {
                        // If it's just a name, search it!
                        const searchInput = document.getElementById('infinite-search-input');
                        if (searchInput) searchInput.value = val;
                        document.getElementById('infinite-search-btn')?.click();
                    }
                    select.value = ''; // reset after selection
                }
            });
        }
        
        container.appendChild(select);
    },

    getPlaylistUrl() {
        const el = document.getElementById('playlist-url-input');
        return el ? el.value.trim() : '';
    },

    getSelectedRounds() {
        const el = document.getElementById('rounds-select');
        return el ? parseInt(el.value, 10) || CONFIG.DEFAULT_ROUNDS : CONFIG.DEFAULT_ROUNDS;
    },

    // ─── Loading Screen ──────────────────────────────────────────────

    updateLoadingProgress(current, total, message) {
        const bar = document.getElementById('loading-progress');
        const status = document.getElementById('loading-status');
        const count = document.getElementById('loading-count');

        if (bar) {
            const pct = total > 0 ? Math.min((current / total) * 100, 100) : 0;
            bar.style.width = `${pct}%`;
        }
        if (status && message) status.textContent = message;
        if (count) count.textContent = total > 0 ? `${current} / ${total}` : '';
    },

    // ─── Game Screen ─────────────────────────────────────────────────

    setTrackList(tracks) {
        this._allTracks = tracks;
    },

    updateRoundInfo(current, total) {
        const c = document.getElementById('current-round');
        const t = document.getElementById('total-rounds');
        if (c) c.textContent = current;
        if (t) t.textContent = total;
    },

    updateScore(score) {
        const el = document.getElementById('current-score');
        if (el) {
            el.textContent = score;
            // Score pop animation
            el.classList.remove('score-pop');
            void el.offsetWidth; // Force reflow
            el.classList.add('score-pop');
        }
    },

    updateDurationLabel(duration) {
        const el = document.getElementById('duration-label');
        if (el) {
            el.textContent = duration >= 1 ? `${duration}s` : `${(duration * 1000).toFixed(0)}ms`;
        }
    },

    updateSkipDots(currentAttempt, maxAttempts) {
        const container = document.getElementById('skip-dots');
        if (!container) return;
        container.innerHTML = '';

        for (let i = 0; i < maxAttempts; i++) {
            const dot = document.createElement('div');
            dot.className = 'skip-dot';
            if (i < currentAttempt) dot.classList.add('used');
            if (i === currentAttempt) dot.classList.add('current');

            const label = document.createElement('span');
            label.className = 'dot-label';
            const dur = CONFIG.SKIP_DURATIONS[i];
            label.textContent = dur >= 1 ? `${dur}s` : `${(dur * 1000).toFixed(0)}ms`;
            dot.appendChild(label);

            container.appendChild(dot);
        }
    },

    setPlayButtonState(state) {
        const btn = document.getElementById('play-btn');
        if (!btn) return;
        const icon = btn.querySelector('.play-icon');

        btn.classList.remove('playing', 'loading-state');

        switch (state) {
            case 'ready':
                if (icon) icon.innerHTML = '<i data-lucide="play"></i>';
                btn.disabled = false;
                break;
            case 'playing':
                if (icon) icon.innerHTML = '<i data-lucide="music"></i>';
                btn.classList.add('playing');
                btn.disabled = true;
                break;
            case 'loading':
                if (icon) icon.innerHTML = '<i data-lucide="loader-2" class="icon-spin"></i>';
                btn.classList.add('loading-state');
                btn.disabled = true;
                break;
        }

        if (window.lucide) lucide.createIcons();
    },



    resetGuessInput() {
        const input = document.getElementById('guess-input');
        const submit = document.getElementById('submit-btn');
        const skip = document.getElementById('skip-btn');

        if (input) { input.value = ''; input.disabled = false; }
        if (submit) submit.disabled = true;
        if (skip) skip.disabled = false;
        this.hideAutocomplete();
        
        // Hide multiple choice by default, let app.js trigger it
        this.toggleMultipleChoiceMode(false);
    },

    toggleMultipleChoiceMode(isMultipleChoice) {
        const guessArea = document.getElementById('guess-area');
        const mcArea = document.getElementById('multiple-choice-area');
        if (guessArea) guessArea.style.display = isMultipleChoice ? 'none' : 'flex';
        if (mcArea) mcArea.style.display = isMultipleChoice ? 'grid' : 'none';
        
        if (!isMultipleChoice) {
            const input = document.getElementById('guess-input');
            if (input) input.focus();
        }
    },

    renderMultipleChoice(options, onSelect) {
        const mcArea = document.getElementById('multiple-choice-area');
        if (!mcArea) return;
        
        mcArea.innerHTML = '';
        
        options.forEach((track, index) => {
            const btn = document.createElement('button');
            btn.className = 'mc-btn';
            
            const titleSpan = document.createElement('span');
            titleSpan.textContent = track.name;
            
            const artistSpan = document.createElement('span');
            artistSpan.className = 'mc-artist';
            artistSpan.textContent = track.artist;
            
            btn.appendChild(titleSpan);
            btn.appendChild(artistSpan);
            
            btn.onclick = () => {
                // Disable all after click to prevent multi-clicks
                Array.from(mcArea.children).forEach(b => b.disabled = true);
                onSelect(track, btn);
            };
            
            mcArea.appendChild(btn);
        });
    },

    disableGuessControls() {
        const input = document.getElementById('guess-input');
        const submit = document.getElementById('submit-btn');
        const skip = document.getElementById('skip-btn');

        if (input) input.disabled = true;
        if (submit) submit.disabled = true;
        if (skip) skip.disabled = true;
    },

    setSkipButtonLabel(text) {
        const btn = document.getElementById('skip-btn');
        if (btn) btn.textContent = text;
    },

    // ─── Autocomplete ────────────────────────────────────────────────

    showAutocomplete(items) {
        const dropdown = document.getElementById('autocomplete-dropdown');
        if (!dropdown) return;

        this._autocompleteItems = items;
        this._selectedIndex = -1;

        if (items.length === 0) {
            this.hideAutocomplete();
            return;
        }

        const maxItems = 8;
        dropdown.innerHTML = items.slice(0, maxItems).map((item, i) =>
            `<div class="autocomplete-item" data-index="${i}">` +
            `<span class="ac-name">${this._escapeHtml(item.displayName)}</span>` +
            `</div>`
        ).join('');

        dropdown.classList.add('visible');
    },

    hideAutocomplete() {
        const dropdown = document.getElementById('autocomplete-dropdown');
        if (dropdown) {
            dropdown.classList.remove('visible');
            dropdown.innerHTML = '';
        }
        this._autocompleteItems = [];
        this._selectedIndex = -1;
    },

    navigateAutocomplete(direction) {
        const items = document.querySelectorAll('.autocomplete-item');
        if (items.length === 0) return null;

        // Remove previous highlight
        if (this._selectedIndex >= 0 && this._selectedIndex < items.length) {
            items[this._selectedIndex].classList.remove('selected');
        }

        if (direction === 'down') {
            this._selectedIndex = Math.min(this._selectedIndex + 1, items.length - 1);
        } else {
            this._selectedIndex = Math.max(this._selectedIndex - 1, -1);
        }

        if (this._selectedIndex >= 0 && this._selectedIndex < items.length) {
            items[this._selectedIndex].classList.add('selected');
            items[this._selectedIndex].scrollIntoView({ block: 'nearest' });
            return this._autocompleteItems[this._selectedIndex];
        }
        return null;
    },

    getSelectedAutocompleteItem() {
        if (this._selectedIndex >= 0 && this._selectedIndex < this._autocompleteItems.length) {
            return this._autocompleteItems[this._selectedIndex];
        }
        return null;
    },

    getAutocompleteItemByIndex(index) {
        return this._autocompleteItems[index] || null;
    },

    isAutocompleteVisible() {
        const dropdown = document.getElementById('autocomplete-dropdown');
        return dropdown && dropdown.classList.contains('visible');
    },

    setBlurredBackground(videoId) {
        const bgLayer = document.getElementById('bg-layer');
        if (bgLayer) {
            const imgUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
            bgLayer.style.backgroundImage = `url('${imgUrl}')`;
            bgLayer.style.filter = 'blur(60px) brightness(0.6)';
            bgLayer.style.opacity = '1';
        }
    },

    showRoundResult(correct, track, videoId, points) {
        const icon = document.getElementById('result-icon');
        const title = document.getElementById('result-title');
        const trackName = document.getElementById('result-track-name');
        const trackArtist = document.getElementById('result-track-artist');
        const pointsEl = document.getElementById('result-points');
        const pointsContainer = document.getElementById('result-points-container');
        const resultImage = document.getElementById('result-image');
        const bgLayer = document.getElementById('bg-layer');

        if (videoId) {
            const imgUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
            if (resultImage) resultImage.src = imgUrl;
            
            // Blur Reveal!
            if (bgLayer) {
                bgLayer.style.backgroundImage = `url('${imgUrl}')`;
                bgLayer.style.filter = 'blur(0px) brightness(1)';
                bgLayer.style.opacity = '1';
            }
        }

        if (icon) {
            icon.innerHTML = correct
                ? '<i data-lucide="check"></i>'
                : '<i data-lucide="x"></i>';
            icon.className = `result-icon ${correct ? 'correct' : 'wrong'}`;
        }
        if (title) {
            title.textContent = correct ? 'Correct!' : 'Not this time...';
            title.className = correct ? 'result-heading correct' : 'result-heading wrong';
        }
        if (trackName) trackName.textContent = track.name;
        if (trackArtist) trackArtist.textContent = track.artist;
        if (pointsEl) pointsEl.textContent = points;
        if (pointsContainer) {
            pointsContainer.className = `result-points ${correct ? 'earned' : 'zero'}`;
        }

        if (correct && window.confetti) {
            confetti({
                particleCount: 150,
                spread: 80,
                origin: { y: 0.6 },
                colors: ['#4ade80', '#60a5fa', '#f472b6', '#fbbf24', '#c084fc']
            });
        }
        
        // Update platform links
        const q = encodeURIComponent(`${track.name} ${track.artist}`);
        const linkSpotify = document.getElementById('link-spotify');
        const linkApple = document.getElementById('link-apple');
        if (linkSpotify) linkSpotify.href = `https://open.spotify.com/search/${q}`;
        if (linkApple) linkApple.href = `https://music.apple.com/search?term=${q}`;

        if (window.lucide) lucide.createIcons();
        this.showScreen('screen-result');
    },

    // ─── Game Summary Screen ─────────────────────────────────────────

    showGameSummary(score, maxScore, results) {
        const finalScore = document.getElementById('final-score');
        const maxScoreEl = document.getElementById('max-score');
        const pctEl = document.getElementById('score-percentage');
        const breakdown = document.getElementById('rounds-breakdown');

        if (finalScore) finalScore.textContent = score;
        if (maxScoreEl) maxScoreEl.textContent = maxScore;

        const pct = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
        if (pctEl) {
            pctEl.textContent = `${pct}%`;
            pctEl.className = 'score-percentage ' + this._getScoreClass(pct);
        }

        if (breakdown) {
            breakdown.innerHTML = results.map((r, i) => `
                <div class="breakdown-row ${r.correct ? 'correct' : 'wrong'}">
                    <span class="breakdown-num">#${i + 1}</span>
                    <span class="breakdown-track">${this._escapeHtml(r.track.displayName)}</span>
                    <span class="breakdown-dots">${this._renderDots(r.attempts, r.correct)}</span>
                    <span class="breakdown-pts">${r.correct ? '+' + r.points : '<i data-lucide="x" class="inline-icon"></i>'}</span>
                </div>
            `).join('');
        }

        if (window.lucide) lucide.createIcons();
        this.showScreen('screen-summary');
    },

    _getScoreClass(pct) {
        if (pct >= 80) return 'excellent';
        if (pct >= 60) return 'good';
        if (pct >= 40) return 'okay';
        return 'low';
    },

    _renderDots(attempts, correct) {
        const max = CONFIG.SKIP_DURATIONS.length;
        let html = '';
        for (let i = 0; i < max; i++) {
            if (i < attempts - 1) {
                html += '<span class="mini-dot skipped">&#9679;</span>';
            } else if (i === attempts - 1) {
                html += correct
                    ? '<span class="mini-dot hit">&#9679;</span>'
                    : '<span class="mini-dot miss">&#9679;</span>';
            } else {
                html += '<span class="mini-dot unused">&#9675;</span>';
            }
        }
        return html;
    },

    // ─── Toast Notifications ─────────────────────────────────────────

    showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        
        // Convert plain text newlines to HTML line breaks if present
        const textSpan = document.createElement('span');
        textSpan.innerHTML = this._escapeHtml(message).replace(/\n/g, '<br>');
        toast.appendChild(textSpan);

        const closeBtn = document.createElement('button');
        closeBtn.className = 'toast-close';
        closeBtn.innerHTML = '×';
        closeBtn.onclick = () => {
            toast.classList.remove('visible');
            setTimeout(() => toast.remove(), 400);
        };
        toast.appendChild(closeBtn);

        container.appendChild(toast);

        // Trigger entrance animation
        requestAnimationFrame(() => {
            requestAnimationFrame(() => toast.classList.add('visible'));
        });

        // Auto-dismiss: errors after 10s, others after 4s
        const dismissDelay = type === 'error' ? 10000 : 4000;
        setTimeout(() => {
            if (toast.parentNode) {
                toast.classList.remove('visible');
                setTimeout(() => {
                    if (toast.parentNode) toast.remove();
                }, 400);
            }
        }, dismissDelay);
    },

    // ─── Visual Feedback ─────────────────────────────────────────────

    showWrongGuess() {
        const input = document.getElementById('guess-input');
        if (!input) return;
        input.classList.add('shake');
        setTimeout(() => input.classList.remove('shake'), 600);
    },

    /**
     * Show or hide the Cancel button on the loading screen.
     * @param {boolean} visible
     * @param {function} [onCancel] - Callback when Cancel is clicked
     */
    setCancelButton(visible, onCancel) {
        let btn = document.getElementById('cancel-loading-btn');
        if (!btn) {
            btn = document.createElement('button');
            btn.id = 'cancel-loading-btn';
            btn.className = 'btn btn-secondary';
            btn.textContent = 'Cancel';
            btn.style.marginTop = '1.5rem';
            const container = document.querySelector('.loading-container');
            if (container) container.appendChild(btn);
        }
        btn.style.display = visible ? '' : 'none';
        btn.onclick = onCancel || null;
    },

    // ─── Helpers ─────────────────────────────────────────────────────

    _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    }
};
