/**
 * app.js — Main application orchestrator.
 *
 * Wires together all modules: Auth, MusicFetcher, YouTubeSearch,
 * AudioPlayer, Game, FuzzySearch, and UI.
 *
 * Self-initializes on DOMContentLoaded.
 */

// Simple Seeded PRNG (Linear Congruential Generator)
let _globalSeed = 0;
Math.setSeed = function(s) {
    // Generate a simple numeric seed from string if needed
    let numericSeed = 0;
    if (typeof s === 'string') {
        for (let i = 0; i < s.length; i++) {
            numericSeed = (numericSeed << 5) - numericSeed + s.charCodeAt(i);
            numericSeed |= 0;
        }
    } else {
        numericSeed = s;
    }
    
    _globalSeed = numericSeed;
    // Override Math.random globally for this session
    Math.random = function() {
        _globalSeed = (_globalSeed * 9301 + 49297) % 233280;
        return _globalSeed / 233280;
    };
};

const App = {
    player: null,
    game: null,
    _searchedVideos: new Map(), // round index → videoId
    _selectedTrack: null,       // currently selected autocomplete track
    _loadingCancelled: false,   // flag to abort playlist loading mid-search
    _clipPlaying: false,        // guard against double-click on play button

    // ─── Initialization ──────────────────────────────────────────────

    async init() {
        this.game = new Game();
        this.player = new AudioPlayer('yt-player');

        UI.init((url) => this._loadPlaylist(url));
        this._bindEvents();
        this._registerGlobalErrorHandler();

        // Check for URL parameters (Challenge / Daily Mode)
        const urlParams = new URLSearchParams(window.location.search);
        let seedParam = urlParams.get('seed');
        const playlistParam = urlParams.get('playlist');
        const hardcoreParam = urlParams.get('hardcore');
        const mcParam = urlParams.get('mc');

        // Always use a seed so games can be shared later
        if (!seedParam) {
            seedParam = Math.floor(Math.random() * 90000) + 10000;
        }
        Math.setSeed(seedParam);
        this._currentSeed = seedParam; // Store for sharing

        if (playlistParam) {
            // Apply game option params if present
            if (hardcoreParam === '1') {
                const hcCheckbox = document.getElementById('hardcore-mode-checkbox');
                if (hcCheckbox) hcCheckbox.checked = true;
            }
            if (mcParam === '1') {
                const mcCheckbox = document.getElementById('multiple-choice-checkbox');
                if (mcCheckbox) mcCheckbox.checked = true;
            }
            
            // Wait a tiny bit for UI to settle, then load the playlist
            setTimeout(() => {
                this._loadPlaylist(playlistParam);
            }, 100);
        } else {
            UI.showScreen('screen-setup');
        }

        // Pre-initialize YouTube player (non-blocking)
        this.player.init().catch(e => {
            console.warn('YouTube player pre-init failed (will retry later):', e.message);
        });
    },

    /**
     * Catch any unhandled Promise rejections and surface them as error toasts
     * instead of silently failing in the console.
     * @private
     */
    _registerGlobalErrorHandler() {
        window.addEventListener('unhandledrejection', (event) => {
            const msg = event.reason?.message || String(event.reason) || 'An unexpected error occurred.';
            // Don't show toasts for aborted fetches (user-initiated)
            if (msg.toLowerCase().includes('abort') || msg.toLowerCase().includes('cancel')) return;
            console.error('Unhandled rejection:', event.reason);
            UI.showToast(`Unexpected error: ${msg}`, 'error');
            event.preventDefault(); // Suppress browser's default console error
        });
    },

    // ─── Event Binding ───────────────────────────────────────────────

    _bindEvents() {
        // --- Setup screen ---
        this._on('load-playlist-btn', 'click', () => this._loadPlaylist());
        this._on('playlist-url-input', 'keydown', (e) => {
            if (e.key === 'Enter') this._loadPlaylist();
        });
        this._on('load-playlist-btn', 'click', () => this._loadPlaylist());
        this._on('infinite-search-btn', 'click', () => this._searchAndLoad());
        this._on('infinite-search-input', 'keydown', (e) => {
            if (e.key === 'Enter') this._searchAndLoad();
        });

        // --- Game screen ---
        this._on('quit-game-btn', 'click', () => this._quitGame());
        this._on('play-btn', 'click', () => this._playClip());
        this._on('submit-btn', 'click', () => this._submitGuess());
        this._on('skip-btn', 'click', () => this._skip());

        // Guess input
        const guessInput = document.getElementById('guess-input');
        if (guessInput) {
            guessInput.addEventListener('input', () => this._onGuessInput());
            guessInput.addEventListener('keydown', (e) => this._onGuessKeydown(e));
            guessInput.addEventListener('focus', () => this._onGuessInput());
        }

        // Autocomplete click delegation
        this._on('autocomplete-dropdown', 'click', (e) => {
            const item = e.target.closest('.autocomplete-item');
            if (item) {
                const index = parseInt(item.dataset.index, 10);
                this._selectAutocompleteItem(index);
            }
        });

        // Close autocomplete on outside click
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.autocomplete-container')) {
                UI.hideAutocomplete();
            }
        });

        this._on('next-round-btn', 'click', () => this._nextRound());
        this._on('next-round-btn-inline', 'click', () => this._nextRound());
        this._on('play-again-btn', 'click', () => this._playAgain());
        this._on('share-btn', 'click', () => this._shareResult());
        this._on('daily-challenge-btn', 'click', () => this._playDailyChallenge());
    },

    /** Helper to bind an event listener by element ID */
    _on(id, event, handler) {
        const el = document.getElementById(id);
        if (el) el.addEventListener(event, handler);
    },

    // ─── Setup Screen Actions ────────────────────────────────────────

    _playDailyChallenge() {
        const now = new Date();
        const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
        const seed = parseInt(dateStr, 10);
        
        Math.setSeed(seed);
        this._currentSeed = seed;
        
        // Hide the main menu
        document.getElementById('screen-setup').classList.remove('active');
        
        // Use Spotify's "Today's Top Hits" for the daily challenge
        const dailyUrl = "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M";
        this._loadPlaylist(dailyUrl);
        
        // Force 10 rounds
        const roundsSelect = document.getElementById('rounds-select');
        if (roundsSelect) roundsSelect.value = "10";
        
        // Disable hardcore/multiple choice to keep it fair for everyone
        const hcCheckbox = document.getElementById('hardcore-mode-checkbox');
        if (hcCheckbox) hcCheckbox.checked = false;
        
        const mcCheckbox = document.getElementById('multiple-choice-checkbox');
        if (mcCheckbox) mcCheckbox.checked = false;
        
        this._loadPlaylist(dailyUrl);
    },



    async _loadPlaylist(predefinedUrl = null) {
        const url = predefinedUrl || UI.getPlaylistUrl();
        if (!url) {
            UI.showToast('Please enter a playlist URL', 'error');
            return;
        }

        const platform = MusicFetcher.detectPlatform(url);
        if (!platform) {
            UI.showToast('Unsupported URL. Use Spotify or YouTube Music playlist links.', 'error');
            return;
        }

        // Spotify scraper is used via Cloudflare Worker, no auth needed!

        // Switch to loading screen
        this._loadingCancelled = false;
        UI.showScreen('screen-loading');
        UI.updateLoadingProgress(0, 0, 'Connecting...');
        UI.setCancelButton(true, () => {
            this._loadingCancelled = true;
            UI.showScreen('screen-setup');
            UI.setCancelButton(false);
            UI.showToast('Loading cancelled.', 'info');
        });

        UI.setCancelButton(true);
        this._loadingCancelled = false;
        
        // Store the url for sharing
        this._currentPlaylistUrl = url;

        try {
            // Step 1: Fetch playlist tracks
            const tracks = await MusicFetcher.loadPlaylist(url, (current, total, msg) => {
                UI.updateLoadingProgress(current, total, msg);
            });

            if (this._loadingCancelled) return;

            if (!tracks || tracks.length === 0) {
                throw new Error('Playlist is empty or could not be loaded.');
            }

            UI.setTrackList(tracks);
            UI.showToast(`Loaded ${tracks.length} tracks!`, 'success');

            // Step 2: Start the game
            const numRounds = UI.getSelectedRounds();
            this.game.startGame(tracks, numRounds);

            // Step 3: Pre-search YouTube for game tracks
            const gameTracks = this.game.gameTracks;
            this._searchedVideos.clear();

            UI.updateLoadingProgress(0, gameTracks.length, 'Finding tracks on YouTube...');

            let searched = 0;
            for (let i = 0; i < gameTracks.length; i++) {
                // Check if user cancelled
                if (this._loadingCancelled) return;

                const track = gameTracks[i];

                if (track.videoId) {
                    // YouTube playlist tracks already have videoId
                    this._searchedVideos.set(i, track.videoId);
                } else {
                    // Search YouTube for Spotify/Apple Music tracks
                    try {
                        const result = await YouTubeSearch.search(track.artist, track.name);
                        if (result) {
                            this._searchedVideos.set(i, result.videoId);
                        } else {
                            console.warn(`No YouTube result for: ${track.displayName}`);
                        }
                    } catch (e) {
                        console.warn(`YouTube search failed for ${track.displayName}:`, e.message);
                    }
                }

                searched++;
                UI.updateLoadingProgress(
                    searched,
                    gameTracks.length,
                    `Finding tracks on YouTube... (${searched}/${gameTracks.length})`
                );

                // Rate limiting delay
                if (i < gameTracks.length - 1 && !track.videoId) {
                    await this._delay(CONFIG.SEARCH_DELAY_MS);
                }
            }

            if (this._loadingCancelled) return;

            // Check results
            const foundCount = this._searchedVideos.size;
            if (foundCount === 0) {
                throw new Error(
                    'Could not find any tracks on YouTube.\n' +
                    'This might be due to search API limits. Please try again in a moment.'
                );
            }

            if (foundCount < gameTracks.length) {
                UI.showToast(
                    `Found ${foundCount}/${gameTracks.length} tracks. Missing ones will be skipped.`,
                    'warning'
                );
            }

            UI.setCancelButton(false);

            // Step 4: Start the first round
            this._gameStartTime = performance.now();
            await this._startRound();

        } catch (e) {
            if (this._loadingCancelled) return; // Silently ignore if user cancelled
            console.error('Playlist load error:', e);
            UI.setCancelButton(false);
            UI.showToast(e.message || 'Failed to load playlist', 'error');
            UI.showScreen('screen-setup');
        }
    },

    // ─── Game Flow ───────────────────────────────────────────────────
    
    _quitGame() {
        if (!confirm('Are you sure you want to quit to the main menu? Your progress will be lost.')) return;
        
        // Stop audio
        if (this.player) this.player.stop();
        
        // Clear any auto-play timers
        if (this._autoPlayTimer) {
            clearTimeout(this._autoPlayTimer);
            this._autoPlayTimer = null;
        }

        // Reset UI background
        UI.clearBlurredBackground();

        // Go back to setup screen
        UI.showScreen('screen-setup');
    },

    async _startRound() {
        const track = this.game.getCurrentTrack();
        if (!track) return;

        this._selectedTrack = null;
        this._mcOptions = null;

        // Update UI
        UI.showScreen('screen-game');
        UI.updateRoundInfo(this.game.getCurrentRoundNumber(), this.game.getTotalRounds());
        UI.updateScore(this.game.getScore());
        UI.updateDurationLabel(this.game.getCurrentDuration());
        UI.updateSkipDots(this.game.getAttemptNumber(), this.game.getMaxAttempts());
        UI.resetGuessInput();
        
        // Setup Multiple Choice Mode
        const mcCheckbox = document.getElementById('multiple-choice-checkbox');
        const isMultipleChoice = mcCheckbox ? mcCheckbox.checked : false;
        UI.toggleMultipleChoiceMode(isMultipleChoice);
        
        if (isMultipleChoice) {
            // Generate options only once per round
            if (!this._mcOptions) {
                const options = [track];
                const pool = this.game.playlist.filter(t => t.id !== track.id);
                pool.sort(() => 0.5 - Math.random());
                options.push(...pool.slice(0, 7));
                options.sort(() => 0.5 - Math.random());
                this._mcOptions = options;
            }
            
            UI.renderMultipleChoice(this._mcOptions, (selectedTrack, btnElement) => {
                this._selectedTrack = selectedTrack;
                this._lastClickedMcBtn = btnElement;
                this._submitGuess();
            });
        }
        UI.setPlayButtonState('loading');
        UI.setSkipButtonLabel('Skip');

        // Load the YouTube video
        const videoId = this._searchedVideos.get(this.game.currentRound);
        if (videoId) {
            UI.setBlurredBackground(videoId);
        }

        if (!videoId) {
            // No video found — skip this round
            UI.showToast(`Skipping "${track.displayName}" — not found on YouTube`, 'warning');
            this.game._recordResult(false, 0);
            await this._delay(800);
            if (this.game.nextRound()) {
                await this._startRound();
            } else {
                this._showSummary();
            }
            return;
        }

        try {
            // Ensure YouTube player is ready
            if (!this.player.isReady()) {
                await this.player.init();
            }

            await this.player.loadVideo(videoId);
            UI.setPlayButtonState('ready');
        } catch (e) {
            console.error('Failed to load YouTube video:', e);
            UI.showToast(`Skipping "${track.displayName}" — audio unavailable (might be region-blocked)`, 'warning');
            
            // Mark as failed and skip to next round automatically
            this.game._recordResult(false, 0);
            await this._delay(1500);
            
            if (this.game.nextRound()) {
                await this._startRound();
            } else {
                this._showSummary();
            }
        }
    },

    async _playClip() {
        // Guard against double-click (button might have a render delay)
        if (this._clipPlaying) return;
        const btn = document.getElementById('play-btn');
        if (btn && btn.disabled) return;

        this._clipPlaying = true;
        UI.setPlayButtonState('playing');

        const durationMs = this.game.getCurrentDurationMs();
        
        const startPosSelect = document.getElementById('start-pos-select');
        const startMode = startPosSelect ? startPosSelect.value : 'beginning';

        try {
            await this.player.playClip(durationMs, startMode);
        } catch (e) {
            console.error('Playback error:', e);
            UI.showToast('Playback failed. Try again.', 'error');
        } finally {
            this._clipPlaying = false;
        }

        UI.setPlayButtonState('ready');
    },

    // ─── Infinite Search ─────────────────────────────────────────────

    async _searchAndLoad() {
        const input = document.getElementById('infinite-search-input');
        if (!input) return;
        const query = input.value.trim();
        if (!query) {
            UI.showToast('Please enter an artist or genre!', 'error');
            return;
        }

        if (!CONFIG.WORKER_URL) {
            UI.showToast('Cloudflare Worker URL is required for searching!', 'error');
            return;
        }

        const originalBtnText = document.getElementById('infinite-search-btn').innerHTML;
        document.getElementById('infinite-search-btn').innerHTML = '<span><div class="loading-spinner" style="width: 14px; height: 14px; display: inline-block; border-width: 2px;"></div></span>';
        document.getElementById('infinite-search-btn').disabled = true;

        try {
            const response = await fetch(`${CONFIG.WORKER_URL}/youtube-playlist?q=${encodeURIComponent(query)}`);
            if (!response.ok) throw new Error('Search failed');
            const data = await response.json();
            
            if (data.error || !data.playlistId) {
                throw new Error(data.error || 'Playlist not found on YouTube');
            }

            // Create a fake URL so _loadPlaylist processes it as a YouTube playlist
            const ytUrl = `https://www.youtube.com/playlist?list=${data.playlistId}`;
            this._loadPlaylist(ytUrl);
        } catch (e) {
            console.error('Search error:', e);
            UI.showToast(`Could not find a playlist for "${query}"`, 'error');
        } finally {
            document.getElementById('infinite-search-btn').innerHTML = originalBtnText;
            document.getElementById('infinite-search-btn').disabled = false;
        }
    },



    // ─── Guessing ────────────────────────────────────────────────────

    _onGuessInput() {
        const input = document.getElementById('guess-input');
        const query = input ? input.value.trim() : '';
        const submitBtn = document.getElementById('submit-btn');

        this._selectedTrack = null;

        if (query.length < 2) {
            UI.hideAutocomplete();
            if (submitBtn) submitBtn.disabled = !query;
            return;
        }

        // Fuzzy search through all tracks
        const results = FuzzySearch.search(query, this.game.tracks, 'displayName');
        UI.showAutocomplete(results);

        if (submitBtn) submitBtn.disabled = false;
    },

    _onGuessKeydown(e) {
        if (!UI.isAutocompleteVisible()) {
            if (e.key === 'Enter') {
                e.preventDefault();
                this._submitGuess();
            }
            return;
        }

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                UI.navigateAutocomplete('down');
                break;

            case 'ArrowUp':
                e.preventDefault();
                UI.navigateAutocomplete('up');
                break;

            case 'Enter':
                e.preventDefault();
                const selected = UI.getSelectedAutocompleteItem();
                if (selected) {
                    this._selectAutocompleteItem(
                        UI._selectedIndex >= 0 ? UI._selectedIndex : 0
                    );
                } else {
                    this._submitGuess();
                }
                break;

            case 'Escape':
                e.preventDefault();
                UI.hideAutocomplete();
                break;
        }
    },

    _selectAutocompleteItem(index) {
        const item = UI.getAutocompleteItemByIndex(index);
        if (!item) return;

        const input = document.getElementById('guess-input');
        if (input) input.value = item.displayName;

        this._selectedTrack = item;
        UI.hideAutocomplete();

        const submitBtn = document.getElementById('submit-btn');
        if (submitBtn) submitBtn.disabled = false;
    },

    _submitGuess() {
        const input = document.getElementById('guess-input');
        const guessText = input ? input.value.trim() : '';

        if (!guessText && !this._selectedTrack) return;

        UI.hideAutocomplete();
        this.player.stop();

        let result;
        if (this._selectedTrack) {
            result = this.game.submitTrackGuess(this._selectedTrack);
        } else {
            result = this.game.submitGuess(guessText);
        }

        this._selectedTrack = null;

        if (result.correct) {
            SFX.playCorrect();
            const lastResult = this.game.results[this.game.results.length - 1];
            const videoId = this._searchedVideos.get(this.game.currentRound);
            UI.showRoundResult(true, lastResult.track, videoId, result.points);
            
            this.player.playClip(15000).then(() => {
                if (document.getElementById('screen-result').classList.contains('active')) {
                    this._nextRound();
                }
            }).catch(() => {
                if (document.getElementById('screen-result').classList.contains('active')) {
                    this._nextRound();
                }
            });
        } else if (result.canContinue) {
            SFX.playWrong();
            UI.showWrongGuess();
            UI.showToast('Wrong answer! Clip extended.', 'error');
            UI.updateDurationLabel(result.duration);
            UI.updateSkipDots(this.game.getAttemptNumber(), this.game.getMaxAttempts());
            if (input) input.value = '';
            const submitBtn = document.getElementById('submit-btn');
            if (submitBtn) submitBtn.disabled = true;
            
            if (this._lastClickedMcBtn) {
                this._lastClickedMcBtn.classList.add('wrong');
                const mcArea = document.getElementById('multiple-choice-area');
                if (mcArea) {
                    Array.from(mcArea.children).forEach(b => {
                        if (!b.classList.contains('wrong')) b.disabled = false;
                    });
                }
                this._lastClickedMcBtn = null;
            }
        } else {
            SFX.playWrong();
            const lastResult = this.game.results[this.game.results.length - 1];
            const videoId = this._searchedVideos.get(this.game.currentRound);
            UI.showRoundResult(false, lastResult.track, videoId, 0);
            
            this.player.playClip(15000).then(() => {
                if (document.getElementById('screen-result').classList.contains('active')) {
                    this._nextRound();
                }
            }).catch(() => {
                if (document.getElementById('screen-result').classList.contains('active')) {
                    this._nextRound();
                }
            });
        }
    },

    _skip() {
        this.player.stop();
        const result = this.game.skip();

        if (result.canContinue) {
            SFX.playPop();
            UI.updateDurationLabel(result.duration);
            UI.updateSkipDots(this.game.getAttemptNumber(), this.game.getMaxAttempts());
            UI.showToast(`Clip extended to ${this._formatDuration(result.duration)}`, 'info');
        } else {
            SFX.playWrong();
            const lastResult = this.game.results[this.game.results.length - 1];
            const videoId = this._searchedVideos.get(this.game.currentRound);
            UI.showRoundResult(false, lastResult.track, videoId, 0);
            
            this.player.playClip(15000).then(() => {
                if (document.getElementById('screen-result').classList.contains('active')) {
                    this._nextRound();
                }
            }).catch(() => {
                if (document.getElementById('screen-result').classList.contains('active')) {
                    this._nextRound();
                }
            });
        }
    },

    // ─── Round Transitions ───────────────────────────────────────────

    async _nextRound() {
        if (this._isTransitioning) return;
        this._isTransitioning = true;
        
        this.player.stop();
        UI.clearBlurredBackground();
        
        if (this.game.nextRound()) {
            await this._startRound();
        } else {
            this._showSummary();
        }
        
        this._isTransitioning = false;
    },

    _showSummary() {
        this._gameEndTime = performance.now();
        this._gameTimeMs = Math.round(this._gameEndTime - (this._gameStartTime || this._gameEndTime));
        
        UI.showGameSummary(
            this.game.getScore(),
            this.game.getMaxScore(),
            this.game.getResults()
        );
        
        // Setup leaderboard
        const submitBtn = document.getElementById('leaderboard-submit-btn');
        if (submitBtn) {
            submitBtn.onclick = () => this._submitScore();
        }
        
        const nameInput = document.getElementById('leaderboard-name-input');
        if (nameInput) {
            const savedName = localStorage.getItem('music_guess_name');
            if (savedName) nameInput.value = savedName;
        }

        this._loadLeaderboard();
    },

    async _loadLeaderboard() {
        if (!CONFIG.WORKER_URL) return;
        const container = document.getElementById('leaderboard-container');
        const list = document.getElementById('leaderboard-list');
        if (!container || !list) return;

        container.style.display = 'block';
        list.innerHTML = '<div style="text-align: center; color: #9ca3af;">Loading leaderboard...</div>';

        try {
            const res = await fetch(`${CONFIG.WORKER_URL}/leaderboard?seed=${this._currentSeed}`);
            if (!res.ok) throw new Error('Network error');
            const data = await res.json();
            
            if (data.error) throw new Error(data.error);
            
            list.innerHTML = '';
            if (!data || data.length === 0) {
                list.innerHTML = '<div style="text-align: center; color: #9ca3af;">No scores yet. Be the first!</div>';
                return;
            }

            data.forEach((entry, idx) => {
                const row = document.createElement('div');
                row.style.display = 'flex';
                row.style.justifyContent = 'space-between';
                row.style.padding = '0.5rem';
                row.style.background = idx === 0 ? 'rgba(251, 191, 36, 0.1)' : 'rgba(255,255,255,0.05)';
                row.style.borderRadius = '0.25rem';
                
                const rankName = document.createElement('div');
                let medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}.`;
                rankName.innerHTML = `<span style="display:inline-block; width: 24px; color: #fbbf24;">${medal}</span> <strong>${this._escapeHtml(entry.name)}</strong>`;
                
                const scoreTime = document.createElement('div');
                const timeStr = entry.timeMs ? (entry.timeMs / 1000).toFixed(1) + 's' : '';
                scoreTime.innerHTML = `<span style="color: #4ade80;">${entry.score}/${entry.maxScore}</span> <small style="color: #9ca3af; margin-left: 0.5rem;">${timeStr}</small>`;
                
                row.appendChild(rankName);
                row.appendChild(scoreTime);
                list.appendChild(row);
            });
        } catch (e) {
            list.innerHTML = `<div style="text-align: center; color: #ef4444;">Failed to load leaderboard.</div>`;
        }
    },

    async _submitScore() {
        if (!CONFIG.WORKER_URL) return;
        const nameInput = document.getElementById('leaderboard-name-input');
        const submitBtn = document.getElementById('leaderboard-submit-btn');
        if (!nameInput || !submitBtn) return;

        const name = nameInput.value.trim();
        if (!name) {
            UI.showToast('Please enter your nickname!', 'error');
            return;
        }

        localStorage.setItem('music_guess_name', name);
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting...';

        try {
            const res = await fetch(`${CONFIG.WORKER_URL}/leaderboard?seed=${this._currentSeed}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: name,
                    score: this.game.getScore(),
                    maxScore: this.game.getMaxScore(),
                    timeMs: this._gameTimeMs,
                    seed: this._currentSeed
                })
            });

            if (!res.ok) throw new Error('Submission failed');
            
            UI.showToast('Score submitted successfully!', 'success');
            await this._loadLeaderboard();
        } catch (e) {
            UI.showToast('Failed to submit score.', 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit Score';
        }
    },

    _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    _playAgain() {
        this.player.stop();
        this._searchedVideos.clear();
        this._selectedTrack = null;
        YouTubeSearch.clearCache();
        // Remove URL params on replay so it plays a fresh game
        window.history.replaceState({}, document.title, window.location.pathname);
        UI.showScreen('screen-setup');
    },

    _shareResult() {
        const score = this.game.getScore();
        const maxScore = this.game.getMaxScore();
        const results = this.game.getResults();
        
        let emojiStr = '';
        results.forEach(r => {
            if (r.correct) {
                emojiStr += (r.attempts === 1) ? '🟩' : '🟨';
            } else {
                emojiStr += '🟥';
            }
        });

        // Build URL
        const currentUrl = new URL(window.location.href);
        currentUrl.search = '';
        currentUrl.searchParams.set('playlist', this._currentPlaylistUrl || '');
        currentUrl.searchParams.set('seed', this._currentSeed);
        
        const hcCheckbox = document.getElementById('hardcore-mode-checkbox');
        if (hcCheckbox && hcCheckbox.checked) currentUrl.searchParams.set('hardcore', '1');
        
        const mcCheckbox = document.getElementById('multiple-choice-checkbox');
        if (mcCheckbox && mcCheckbox.checked) currentUrl.searchParams.set('mc', '1');

        const textToShare = `🎵 Music Guess\nScore: ${score}/${maxScore}\n${emojiStr}\n\nCan you beat me? Play same tracks:\n${currentUrl.toString()}`;
        
        navigator.clipboard.writeText(textToShare).then(() => {
            UI.showToast('Result copied to clipboard!', 'success');
            const btn = document.getElementById('share-btn');
            if (btn) {
                const originalText = btn.innerHTML;
                btn.innerHTML = '<i data-lucide="check"></i> Copied!';
                if (window.lucide) lucide.createIcons();
                setTimeout(() => {
                    btn.innerHTML = originalText;
                    if (window.lucide) lucide.createIcons();
                }, 2000);
            }
        }).catch(err => {
            console.error('Clipboard error', err);
            UI.showToast('Failed to copy to clipboard', 'error');
        });
    },

    // ─── Helpers ─────────────────────────────────────────────────────

    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },

    _formatDuration(seconds) {
        return seconds >= 1 ? `${seconds}s` : `${(seconds * 1000).toFixed(0)}ms`;
    }
};

// ─── Bootstrap ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => App.init());
