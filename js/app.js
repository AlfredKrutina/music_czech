/**
 * app.js — Main application orchestrator.
 *
 * Wires together all modules: Auth, PlaylistLoader, YouTubeSearch,
 * AudioPlayer, Game, FuzzySearch, and UI.
 *
 * Self-initializes on DOMContentLoaded.
 */
const App = {
    player: null,
    game: null,
    _searchedVideos: new Map(), // round index → videoId
    _selectedTrack: null,       // currently selected autocomplete track

    // ─── Initialization ──────────────────────────────────────────────

    async init() {
        this.game = new Game();
        this.player = new AudioPlayer('yt-player');

        UI.init();
        this._bindEvents();
        UI.showScreen('screen-setup');

        // Pre-initialize YouTube player (non-blocking)
        this.player.init().catch(e => {
            console.warn('YouTube player pre-init failed (will retry later):', e.message);
        });
    },

    // ─── Event Binding ───────────────────────────────────────────────

    _bindEvents() {
        // --- Setup screen ---
        this._on('save-client-id-btn', 'click', () => this._saveClientId());
        this._on('load-playlist-btn', 'click', () => this._loadPlaylist());
        this._on('playlist-url-input', 'keydown', (e) => {
            if (e.key === 'Enter') this._loadPlaylist();
        });
        this._on('client-id-input', 'keydown', (e) => {
            if (e.key === 'Enter') this._saveClientId();
        });

        // --- Game screen ---
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

        // --- Result screen ---
        this._on('next-round-btn', 'click', () => this._nextRound());

        // --- Summary screen ---
        this._on('play-again-btn', 'click', () => this._playAgain());
    },

    /** Helper to bind an event listener by element ID */
    _on(id, event, handler) {
        const el = document.getElementById(id);
        if (el) el.addEventListener(event, handler);
    },

    // ─── Setup Screen Actions ────────────────────────────────────────

    _saveClientId() {
        const input = document.getElementById('client-id-input');
        const clientId = input ? input.value.trim() : '';

        if (!clientId) {
            UI.showClientIdError('⚠ Please enter a Client ID');
            return;
        }
        if (clientId.length < 10) {
            UI.showClientIdError('⚠ Client ID seems too short');
            return;
        }

        SpotifyAuth.setClientId(clientId);
        UI.showClientIdSaved();
        UI.showToast('Client ID saved!', 'success');
    },

    async _loadPlaylist() {
        const url = UI.getPlaylistUrl();
        if (!url) {
            UI.showToast('Please enter a playlist URL', 'error');
            return;
        }

        const platform = PlaylistLoader.detectPlatform(url);
        if (!platform) {
            UI.showToast('Unsupported URL. Use Spotify or YouTube Music playlist links.', 'error');
            return;
        }

        // Spotify requires Client ID
        if (platform === 'spotify' && !SpotifyAuth.hasClientId()) {
            UI.showToast('Please save your Spotify Client ID first', 'error');
            return;
        }

        // Switch to loading screen
        UI.showScreen('screen-loading');
        UI.updateLoadingProgress(0, 0, 'Connecting...');

        try {
            // Step 1: Fetch playlist tracks
            const tracks = await PlaylistLoader.loadPlaylist(url, (current, total, msg) => {
                UI.updateLoadingProgress(current, total, msg);
            });

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
                const track = gameTracks[i];

                if (track.videoId) {
                    // YouTube playlist tracks already have videoId
                    this._searchedVideos.set(i, track.videoId);
                } else {
                    // Search YouTube for Spotify tracks
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

            // Step 4: Start the first round
            await this._startRound();

        } catch (e) {
            console.error('Playlist load error:', e);
            UI.showToast(e.message || 'Failed to load playlist', 'error');
            UI.showScreen('screen-setup');
        }
    },

    // ─── Game Flow ───────────────────────────────────────────────────

    async _startRound() {
        const track = this.game.getCurrentTrack();
        if (!track) return;

        this._selectedTrack = null;

        // Update UI
        UI.showScreen('screen-game');
        UI.updateRoundInfo(this.game.getCurrentRoundNumber(), this.game.getTotalRounds());
        UI.updateScore(this.game.getScore());
        UI.updateDurationLabel(this.game.getCurrentDuration());
        UI.updateSkipDots(this.game.getAttemptNumber(), this.game.getMaxAttempts());
        UI.resetGuessInput();
        UI.setPlayButtonState('loading');
        UI.setSkipButtonLabel('Skip');

        // Load the YouTube video
        const videoId = this._searchedVideos.get(this.game.currentRound);

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
        const btn = document.getElementById('play-btn');
        if (btn && btn.disabled) return;

        UI.setPlayButtonState('playing');

        const durationMs = this.game.getCurrentDurationMs();

        try {
            await this.player.playClip(durationMs);
        } catch (e) {
            console.error('Playback error:', e);
            UI.showToast('Playback failed. Try again.', 'error');
        }

        UI.setPlayButtonState('ready');
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

        if (!guessText) return;

        UI.hideAutocomplete();
        this.player.stop();

        let result;
        if (this._selectedTrack) {
            // User selected a specific track from autocomplete
            result = this.game.submitTrackGuess(this._selectedTrack);
        } else {
            // Free text guess
            result = this.game.submitGuess(guessText);
        }

        this._selectedTrack = null;

        if (result.correct) {
            // Correct answer!
            const lastResult = this.game.results[this.game.results.length - 1];
            UI.showRoundResult(true, lastResult.track, result.points);
        } else if (result.canContinue) {
            // Wrong, but can still try
            UI.showWrongGuess();
            UI.showToast('Wrong answer! Clip extended.', 'error');
            UI.updateDurationLabel(result.duration);
            UI.updateSkipDots(this.game.getAttemptNumber(), this.game.getMaxAttempts());
            if (input) input.value = '';
            const submitBtn = document.getElementById('submit-btn');
            if (submitBtn) submitBtn.disabled = true;
        } else {
            // Wrong and no more attempts
            const lastResult = this.game.results[this.game.results.length - 1];
            UI.showRoundResult(false, lastResult.track, 0);
        }
    },

    _skip() {
        this.player.stop();
        const result = this.game.skip();

        if (result.canContinue) {
            UI.updateDurationLabel(result.duration);
            UI.updateSkipDots(this.game.getAttemptNumber(), this.game.getMaxAttempts());
            UI.showToast(`Clip extended to ${this._formatDuration(result.duration)}`, 'info');
        } else {
            // No more skips — failed
            const lastResult = this.game.results[this.game.results.length - 1];
            UI.showRoundResult(false, lastResult.track, 0);
        }
    },

    // ─── Round Transitions ───────────────────────────────────────────

    async _nextRound() {
        if (this.game.nextRound()) {
            await this._startRound();
        } else {
            this._showSummary();
        }
    },

    _showSummary() {
        UI.showGameSummary(
            this.game.getScore(),
            this.game.getMaxScore(),
            this.game.getResults()
        );
    },

    _playAgain() {
        this.player.stop();
        this._searchedVideos.clear();
        this._selectedTrack = null;
        YouTubeSearch.clearCache();
        UI.showScreen('screen-setup');
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
