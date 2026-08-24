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

        const roomParam = urlParams.get('room');

        if (roomParam) {
            UI.showScreen('screen-setup');
            setTimeout(() => {
                const btn = document.getElementById('tab-multiplayer');
                if (btn) btn.click();
                const roomInput = document.getElementById('mp-room-input');
                if (roomInput) roomInput.value = roomParam.toUpperCase();
            }, 100);
        } else if (playlistParam) {
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
        // --- Setup screen tabs ---
        const switchTab = (tabId) => {
            const tabs = ['play', 'multiplayer', 'leaderboards'];
            tabs.forEach(t => {
                const content = document.getElementById(`setup-content-${t}`);
                const btn = document.getElementById(`tab-${t}`);
                if (content) content.style.display = (t === tabId) ? 'block' : 'none';
                if (btn) btn.className = (t === tabId) ? 'btn btn-primary' : 'btn btn-secondary';
            });
            if (tabId === 'leaderboards') this._loadHomeLeaderboards();
        };

        this._on('tab-play', 'click', () => switchTab('play'));
        this._on('tab-multiplayer', 'click', () => switchTab('multiplayer'));
        this._on('tab-leaderboards', 'click', () => switchTab('leaderboards'));
        
        this._on('leaderboard-select', 'change', () => this._fetchSelectedLeaderboard());

        // --- Multiplayer ---
        this._on('mp-create-btn', 'click', () => this._mpCreateRoom());
        this._on('mp-join-btn', 'click', () => this._mpJoinRoom());
        this._on('mp-leave-btn', 'click', () => this._mpLeaveRoom());
        this._on('mp-copy-link-btn', 'click', () => {
            if (window.MP && window.MP.roomId) {
                const url = new URL(window.location.href);
                url.search = '';
                url.searchParams.set('room', window.MP.roomId);
                navigator.clipboard.writeText(url.toString()).then(() => {
                    UI.showToast('Invite link copied to clipboard!', 'success');
                }).catch(() => {
                    UI.showToast('Failed to copy link', 'error');
                });
            }
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

    // ─── Multiplayer Lobby Logic ─────────────────────────────────────

    async _mpCreateRoom() {
        const nameInput = document.getElementById('mp-name-input');
        const name = nameInput ? nameInput.value.trim() : '';
        if (!name) return UI.showToast('Please enter your nickname', 'error');

        const btn = document.getElementById('mp-create-btn');
        btn.disabled = true;
        btn.textContent = 'Creating...';

        try {
            const roomId = await window.MP.createRoom(name);
            this._mpShowLobby(roomId, true);
            this._mpSetupListeners();
        } catch (e) {
            UI.showToast('Failed to create room: ' + e.message, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Create Room (Host)';
        }
    },

    async _mpJoinRoom() {
        const nameInput = document.getElementById('mp-name-input');
        const roomInput = document.getElementById('mp-room-input');
        const name = nameInput ? nameInput.value.trim() : '';
        const roomId = roomInput ? roomInput.value.trim() : '';
        
        if (!name) return UI.showToast('Please enter your nickname', 'error');
        if (!roomId) return UI.showToast('Please enter a room code', 'error');

        const btn = document.getElementById('mp-join-btn');
        btn.disabled = true;
        btn.textContent = 'Joining...';

        try {
            await window.MP.joinRoom(roomId, name);
            this._mpShowLobby(roomId, false);
            this._mpSetupListeners();
        } catch (e) {
            UI.showToast('Failed to join room: ' + e.message, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Join';
        }
    },
    
    _mpLeaveRoom() {
        if (window.MP && window.MP.peer) {
            window.MP.peer.destroy();
        }
        window.MP = new MultiplayerNetwork(); // Reset
        
        document.getElementById('mp-join-section').style.display = 'block';
        document.getElementById('mp-lobby-section').style.display = 'none';
        UI.showToast('Left the room');
    },

    _mpShowLobby(roomId, isHost) {
        document.getElementById('mp-join-section').style.display = 'none';
        document.getElementById('mp-lobby-section').style.display = 'block';
        document.getElementById('mp-lobby-code').textContent = roomId;
        document.getElementById('mp-host-instruction').style.display = isHost ? 'block' : 'none';
        document.getElementById('mp-guest-instruction').style.display = isHost ? 'none' : 'block';
    },

    _mpSetupListeners() {
        window.MP.on('UPDATE_PLAYERS', (data) => {
            const list = document.getElementById('mp-player-list');
            const count = document.getElementById('mp-player-count');
            if (list && count) {
                count.textContent = data.players.length;
                list.innerHTML = '';
                data.players.forEach(p => {
                    const div = document.createElement('div');
                    div.style.padding = '0.5rem';
                    div.style.background = 'rgba(255,255,255,0.05)';
                    div.style.borderRadius = '0.25rem';
                    div.style.display = 'flex';
                    div.style.justifyContent = 'space-between';
                    
                    const nameSpan = document.createElement('span');
                    nameSpan.textContent = p.name + (p.id === window.MP.myId ? ' (You)' : '');
                    
                    const scoreSpan = document.createElement('span');
                    scoreSpan.textContent = `${p.score} pts`;
                    scoreSpan.style.color = '#4ade80';
                    
                    div.appendChild(nameSpan);
                    div.appendChild(scoreSpan);
                    list.appendChild(div);
                });
            }
        });
        
        window.MP.on('disconnected', () => {
            UI.showToast('Disconnected from host', 'error');
            this._mpLeaveRoom();
        });
        
        window.MP.on('message', (msg) => {
            this._handleMultiplayerMessage(msg);
        });
    },

    _handleMultiplayerMessage(msg) {
        if (!msg) return;
        const payload = msg.payload || {};
        
        switch (msg.type) {
            case 'START_GAME':
                this.game = new Game(payload.tracks, payload.totalRounds);
                UI.showScreen('screen-game');
                break;
                
            case 'SYNC_ROUND':
                this.game.currentRound = payload.roundNum - 1;
                this._mcOptions = payload.options;
                
                UI.updateRoundInfo(this.game.getCurrentRoundNumber(), this.game.getTotalRounds());
                UI.updateScore(this.game.getScore());
                UI.updateDurationLabel(this.game.getCurrentDuration());
                UI.updateSkipDots(this.game.getAttemptNumber(), this.game.getMaxAttempts());
                UI.resetGuessInput();
                
                if (this._mcOptions) {
                    UI.toggleMultipleChoiceMode(true);
                    UI.renderMultipleChoice(this._mcOptions, (selectedTrack, btnElement) => {
                        this._selectedTrack = selectedTrack;
                        this._lastClickedMcBtn = btnElement;
                        this._submitGuess();
                    });
                } else {
                    UI.toggleMultipleChoiceMode(false);
                }
                
                if (payload.videoId) {
                    UI.setBlurredBackground(payload.videoId);
                    if (!this.player.isReady()) {
                        this.player.init().then(() => this.player.loadVideo(payload.videoId));
                    } else {
                        this.player.loadVideo(payload.videoId);
                    }
                }
                
                UI.setPlayButtonState('ready');
                document.getElementById('play-btn').disabled = true;
                break;
                
            case 'PLAY_CLIP':
                this._mpOverrideDuration = payload.durationMs;
                this._isFromHost = true;
                this._playClip();
                this._isFromHost = false;
                break;
                
            case 'GUESS':
                if (window.MP && window.MP.isHost) {
                    const { track, text } = payload;
                    const peerId = msg.from;
                    const peer = window.MP.connections.get(peerId);
                    const name = peer ? peer.name : 'Unknown';

                    const isCorrect = this.game.checkGuessOnly(track, text);
                    
                    if (isCorrect) {
                        // The player guessed correctly! They win the round!
                        const points = CONFIG.POINTS[this.game.getAttemptNumber()] || 1;
                        
                        // Notify everyone that someone won!
                        window.MP.broadcast('ROUND_RESULT', {
                            winnerId: peerId,
                            winnerName: name || peerId,
                            points: points,
                            track: this.game.getCurrentTrack()
                        });
                        
                        // Add points to the winner in the multiplayer scoreboard
                        window.MP.addScore(peerId, points);

                        // Also process it locally as the host to advance the game!
                        this._processGuessLocally(track, text, peerId);
                    } else {
                        // Send failure message back to just that peer? Or broadcast a miss?
                        // Simple approach: broadcast they missed, or just do nothing (peer will have no response).
                        // Better: peer handles wrong guesses locally by evaluating before sending? No, because Host is source of truth.
                        // Let's send them a WRONG_GUESS message
                        window.MP.sendToPeer(peerId, 'WRONG_GUESS', {});
                    }
                }
                break;
                
            case 'WRONG_GUESS':
                SFX.playWrong();
                UI.showWrongGuess();
                UI.showToast('Wrong answer!', 'error');
                const input = document.getElementById('guess-input');
                if (input) input.value = '';
                
                if (this._lastClickedMcBtn) {
                    this._lastClickedMcBtn.classList.add('wrong');
                    this._lastClickedMcBtn = null;
                }
                break;

            case 'ROUND_RESULT':
                // Someone won the round!
                if (!window.MP.isHost) {
                    // Update the guest's local game state to match
                    this.game.score += payload.points; // Add points to the winner? Wait, the scoreboard is managed by Host!
                    
                    SFX.playCorrect();
                    const videoId = this._searchedVideos.get(this.game.currentRound);
                    
                    // Show a special toast if YOU won or someone else won
                    if (payload.winnerId === window.MP.myId) {
                        UI.showToast(`You guessed it first! +${payload.points} pts`, 'success');
                        UI.showRoundResult(true, payload.track, videoId, payload.points);
                    } else {
                        UI.showToast(`${payload.winnerName} guessed it first!`, 'info');
                        UI.showRoundResult(false, payload.track, videoId, 0); // show as failed for local player
                    }
                    
                }
                break;
                
            case 'SKIP_VOTE':
                if (window.MP && window.MP.isHost) {
                    const peer = window.MP.connections.get(msg.from);
                    if (peer) peer.skipVote = true;
                    this._checkSkipVotes();
                }
                break;
                
            case 'SKIP_SUCCESS':
                if (!window.MP.isHost) {
                    this._processSkipLocally();
                }
                break;
        }
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
        
        // Disable special modes to keep it fair for everyone
        const startPosSelect = document.getElementById('start-pos-select');
        if (startPosSelect) startPosSelect.value = 'beginning';
        
        const mcCheckbox = document.getElementById('multiple-choice-checkbox');
        if (mcCheckbox) mcCheckbox.checked = false;
        
        this._loadPlaylist(dailyUrl);
    },



    async _loadPlaylist(predefinedUrl = null, customPlaylistId = null) {
        const isCustomTracks = Array.isArray(predefinedUrl);
        const url = isCustomTracks ? 'custom' : (predefinedUrl || UI.getPlaylistUrl());
        if (!url) {
            UI.showToast('Please enter a playlist URL', 'error');
            return;
        }

        let platform = 'custom';
        if (!isCustomTracks) {
            platform = MusicFetcher.detectPlatform(url);
            if (!platform) {
                UI.showToast('Unsupported URL. Use Spotify or YouTube Music playlist links.', 'error');
                return;
            }
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
        this._currentPlaylistUrl = isCustomTracks ? '' : url;

        try {
            // Step 1: Fetch playlist tracks
            let tracks = [];
            if (isCustomTracks) {
                tracks = predefinedUrl;
                UI.updateLoadingProgress(tracks.length, tracks.length, 'Loaded search results!');
            } else {
                tracks = await MusicFetcher.loadPlaylist(url, (current, total, msg) => {
                    UI.updateLoadingProgress(current, total, msg);
                });
            }

            if (this._loadingCancelled) return;

            if (!tracks || tracks.length === 0) {
                throw new Error('Playlist is empty or could not be loaded.');
            }

            UI.setTrackList(tracks);
            UI.showToast(`Loaded ${tracks.length} tracks!`, 'success');

            // Step 2: Extract clean playlist ID for the leaderboard key
            let cleanPlaylistId = customPlaylistId || 'unknown';
            if (!isCustomTracks) {
                if (platform === 'spotify') {
                    const sp = MusicFetcher.parseSpotifyId(url);
                    if (sp) cleanPlaylistId = sp.id;
                } else if (platform === 'youtube') {
                    const yt = MusicFetcher.parseYouTubeId(url);
                    if (yt) cleanPlaylistId = yt;
                } else if (platform === 'apple') {
                    const match = url.match(/pl\.[a-zA-Z0-9]+/);
                    if (match) cleanPlaylistId = match[0];
                }
            }

            // Step 3: Build composite boardId
            const numRounds = UI.getSelectedRounds();
            const startPosSelect = document.getElementById('start-pos-select');
            const startMode = startPosSelect ? startPosSelect.value : 'beginning';
            const mcCheckbox = document.getElementById('multiple-choice-checkbox');
            const isMultipleChoice = mcCheckbox ? mcCheckbox.checked : false;

            this._currentBoardId = `${this._currentSeed}_${cleanPlaylistId}_${numRounds}_${startMode}_${isMultipleChoice ? 'mc' : 'text'}`;

            // Step 4: Start the game
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
            
            if (window.MP && window.MP.isHost) {
                window.MP.broadcast('START_GAME', {
                    tracks: gameTracks,
                    totalRounds: numRounds
                });
            }

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
        
        if (window.MP && window.MP.peer && !window.MP.isHost) {
            UI.setPlayButtonState('loading');
            UI.setSkipButtonLabel('Waiting for Host...');
            document.getElementById('play-btn').disabled = true;
            return; // Guests wait for SYNC_ROUND
        }
        
        // Setup Multiple Choice Mode
        const mcCheckbox = document.getElementById('multiple-choice-checkbox');
        const isMultipleChoice = mcCheckbox ? mcCheckbox.checked : false;
        UI.toggleMultipleChoiceMode(isMultipleChoice);
        
        if (isMultipleChoice) {
            // Generate options only once per round
            if (!this._mcOptions) {
                UI.setPlayButtonState('loading'); // Show loading while fetching distractors
                const options = [track];
                let distractorPool = [];
                
                // Get current artist (split by feat/&/,)
                const currentArtist = track.artist.split(/,|&|feat\.?/i)[0].trim();
                
                // Get a random artist from the playlist
                const otherTracks = this.game.tracks.filter(t => t.id !== track.id);
                let randomArtist = currentArtist;
                if (otherTracks.length > 0) {
                    const randomTrack = otherTracks[Math.floor(Math.random() * otherTracks.length)];
                    randomArtist = randomTrack.artist.split(/,|&|feat\.?/i)[0].trim();
                }

                try {
                    // Fetch distractors concurrently (fail silently if offline or blocked)
                    const [res1, res2] = await Promise.all([
                        fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(currentArtist)}&entity=song&limit=15`).catch(()=>null),
                        (currentArtist !== randomArtist) 
                            ? fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(randomArtist)}&entity=song&limit=15`).catch(()=>null)
                            : Promise.resolve(null)
                    ]);
                    
                    if (res1 && res1.ok) {
                        const data = await res1.json();
                        distractorPool.push(...(data.results || []).map(r => ({ name: r.trackName, artist: r.artistName, displayName: `${r.artistName} — ${r.trackName}` })));
                    }
                    if (res2 && res2.ok) {
                        const data = await res2.json();
                        distractorPool.push(...(data.results || []).map(r => ({ name: r.trackName, artist: r.artistName, displayName: `${r.artistName} — ${r.trackName}` })));
                    }
                } catch(e) {
                    console.warn("Could not fetch distractors", e);
                }

                // 1. Add up to 3 distractors from the SAME artist
                const sameArtistPool = distractorPool.filter(t => t.artist.toLowerCase().includes(currentArtist.toLowerCase()) && t.name.toLowerCase() !== track.name.toLowerCase());
                sameArtistPool.sort(() => 0.5 - Math.random());
                for (const d of sameArtistPool) {
                    if (options.length >= 4) break; // max 3 distractors for current artist
                    if (!options.find(o => o.name.toLowerCase() === d.name.toLowerCase())) options.push(d);
                }

                // 2. Add some distractors from the RANDOM artist we fetched
                const otherArtistPool = distractorPool.filter(t => !t.artist.toLowerCase().includes(currentArtist.toLowerCase()));
                otherArtistPool.sort(() => 0.5 - Math.random());
                for (const d of otherArtistPool) {
                    if (options.length >= 8) break;
                    if (!options.find(o => o.name.toLowerCase() === d.name.toLowerCase())) options.push(d);
                }

                // 3. Fill the rest from the actual playlist pool
                const playlistPool = this.game.tracks.filter(t => t.id !== track.id);
                playlistPool.sort(() => 0.5 - Math.random());
                for (const p of playlistPool) {
                    if (options.length >= 8) break;
                    if (!options.find(o => o.name.toLowerCase() === p.name.toLowerCase())) options.push(p);
                }

                // 4. If STILL not 8, add generic fillers
                if (options.length < 8) {
                    const GENERIC_FILLERS = [
                        {name: 'Blinding Lights', artist: 'The Weeknd'},
                        {name: 'Shape of You', artist: 'Ed Sheeran'},
                        {name: 'Someone Like You', artist: 'Adele'},
                        {name: 'Bohemian Rhapsody', artist: 'Queen'},
                        {name: 'Billie Jean', artist: 'Michael Jackson'},
                        {name: 'Smells Like Teen Spirit', artist: 'Nirvana'},
                        {name: 'Rolling in the Deep', artist: 'Adele'},
                        {name: 'Hotel California', artist: 'Eagles'},
                        {name: 'Wonderwall', artist: 'Oasis'},
                        {name: 'Toxic', artist: 'Britney Spears'}
                    ];
                    GENERIC_FILLERS.sort(() => 0.5 - Math.random());
                    for (const f of GENERIC_FILLERS) {
                        if (options.length >= 8) break;
                        if (!options.find(o => o.name.toLowerCase() === f.name.toLowerCase())) options.push(f);
                    }
                }

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
        
        if (window.MP && window.MP.isHost) {
            window.MP.broadcast('SYNC_ROUND', {
                roundNum: this.game.getCurrentRoundNumber(),
                track: track,
                options: this._mcOptions,
                videoId: videoId
            });
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
        if (this._clipPlaying) return;
        
        // If Guest, we can't click Play. This is triggered by MP broadcast.
        if (window.MP && window.MP.peer && !window.MP.isHost && !this._isFromHost) {
            return; // Ignore local clicks if guest
        }
        
        if (window.MP && window.MP.isHost && !this._isFromHost) {
            window.MP.broadcast('PLAY_CLIP', { durationMs: this.game.getCurrentDurationMs() });
            // Let the local broadcast loopback handle it!
            return; 
        }

        this._clipPlaying = true;
        UI.setPlayButtonState('playing');

        // MULTIPLAYER COUNTDOWN
        if (window.MP && window.MP.peer) {
             await UI.showCountdown(3);
        }

        const durationMs = this._mpOverrideDuration || this.game.getCurrentDurationMs();
        this._mpOverrideDuration = null;
        
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
        
        // AUTOSKIPPER LOGIC
        const autoCheckbox = document.getElementById('autoskipper-checkbox');
        if (autoCheckbox && autoCheckbox.checked) {
             if (window.MP && window.MP.isHost) {
                 this._startAutoskipperTimer();
             } else if (!window.MP || !window.MP.peer) {
                 // Singleplayer autoskipper
                 this._startAutoskipperTimer();
             }
        }
    },
    
    _startAutoskipperTimer() {
        if (this._autoskipperTimer) {
            clearTimeout(this._autoskipperTimer);
        }
        
        // Skip automatically after 10 seconds if no guess
        this._autoskipperTimer = setTimeout(() => {
            // Check if we're still waiting for a guess on the active round
            if (!document.getElementById('screen-result').classList.contains('active') && 
                document.getElementById('screen-game').classList.contains('active')) {
                UI.showToast('Autoskipper: Time is up!', 'info');
                this._skip(); // Automatically skip to the next length
            }
        }, 10000);
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

        const originalBtnText = document.getElementById('infinite-search-btn').innerHTML;
        document.getElementById('infinite-search-btn').innerHTML = '<span><div class="loading-spinner" style="width: 14px; height: 14px; display: inline-block; border-width: 2px;"></div></span>';
        document.getElementById('infinite-search-btn').disabled = true;

        try {
            const response = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=50`);
            if (!response.ok) throw new Error('Search failed');
            const data = await response.json();
            
            if (!data.results || data.results.length < 5) {
                throw new Error('Not enough songs found for this search.');
            }

            // Convert iTunes results to our track format
            let allTracks = data.results.map(track => {
                return {
                    name: track.trackName,
                    artist: track.artistName,
                    displayName: `${track.artistName} — ${track.trackName}`
                };
            });

            // Remove duplicates
            const uniqueTracks = [];
            const seen = new Set();
            for (const t of allTracks) {
                const key = t.displayName.toLowerCase();
                if (!seen.has(key)) {
                    seen.add(key);
                    uniqueTracks.push(t);
                }
            }

            if (uniqueTracks.length < 5) {
                throw new Error('Not enough unique songs found for this search.');
            }

            // Start game directly using _loadPlaylist array override
            this._loadPlaylist(uniqueTracks, `search_${encodeURIComponent(query).replace(/[^a-zA-Z0-9]/g, '')}`);
        } catch (e) {
            console.error('Search error:', e);
            UI.showToast(e.message || `Could not find enough tracks for "${query}"`, 'error');
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

        if (window.MP && window.MP.peer) {
            window.MP.sendToHost('GUESS', {
                track: this._selectedTrack,
                text: guessText
            });
            this._selectedTrack = null;
            return;
        }

        const t = this._selectedTrack;
        this._selectedTrack = null;
        this._processGuessLocally(t, guessText, null);
    },

    _processGuessLocally(selectedTrack, guessText, peerId) {
        if (this._autoskipperTimer) {
            clearTimeout(this._autoskipperTimer);
        }
        this.player.stop();

        let result;
        if (selectedTrack) {
            result = this.game.submitTrackGuess(selectedTrack);
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
            const input = document.getElementById('guess-input');
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
            
            // Restart autoskipper for the next duration!
            const autoCheckbox = document.getElementById('autoskipper-checkbox');
            if (autoCheckbox && autoCheckbox.checked) {
                 this._startAutoskipperTimer();
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
        if (window.MP && window.MP.peer && !window.MP.isHost) {
            window.MP.sendToHost('SKIP_VOTE', {});
            const btn = document.getElementById('skip-btn');
            if (btn) {
                btn.disabled = true;
                btn.textContent = "Voted!";
            }
            return;
        }
        
        if (window.MP && window.MP.isHost) {
            const peer = window.MP.connections.get(window.MP.myId);
            if (peer) peer.skipVote = true;
            const btn = document.getElementById('skip-btn');
            if (btn) {
                btn.disabled = true;
                btn.textContent = "Voted!";
            }
            this._checkSkipVotes();
            return;
        }

        this._processSkipLocally();
    },
    
    _checkSkipVotes() {
        if (!window.MP.isHost) return;
        
        let votes = 0;
        let total = 0;
        window.MP.connections.forEach(p => {
            if (p.conn || p.name === window.MP.myName) { // count active or self
                total++;
                if (p.skipVote) votes++;
            }
        });
        
        if (votes >= Math.ceil(total / 2)) {
            // Majority reached!
            window.MP.connections.forEach(p => p.skipVote = false);
            window.MP.broadcast('SKIP_SUCCESS', {});
            this._processSkipLocally();
        }
    },

    _processSkipLocally() {
        if (this._autoskipperTimer) {
            clearTimeout(this._autoskipperTimer);
        }
        this.player.stop();
        const result = this.game.skip();

        if (result.canContinue) {
            SFX.playPop();
            UI.updateDurationLabel(result.duration);
            UI.updateSkipDots(this.game.getAttemptNumber(), this.game.getMaxAttempts());
            UI.showToast(`Clip extended to ${this._formatDuration(result.duration)}`, 'info');
            
            const btn = document.getElementById('skip-btn');
            if (btn) {
                btn.disabled = false;
                btn.textContent = "Skip";
            }
            
            // Restart autoskipper for the next duration!
            const autoCheckbox = document.getElementById('autoskipper-checkbox');
            if (autoCheckbox && autoCheckbox.checked) {
                 this._startAutoskipperTimer();
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
            const res = await fetch(`${CONFIG.WORKER_URL}/leaderboard?boardId=${this._currentBoardId}`);
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

    _loadHomeLeaderboards() {
        const select = document.getElementById('leaderboard-select');
        if (!select) return;
        
        select.innerHTML = '';
        
        // Add Daily Challenge
        const dateStr = new Date().toISOString().split('T')[0];
        const dailyBoardId = `daily_challenge_${dateStr}`;
        const dailyOpt = document.createElement('option');
        dailyOpt.value = dailyBoardId;
        dailyOpt.textContent = `Daily Challenge (${dateStr})`;
        select.appendChild(dailyOpt);

        // Add Last Played Game if it exists and isn't the daily challenge
        if (this._currentBoardId && this._currentBoardId !== dailyBoardId) {
            const lastOpt = document.createElement('option');
            lastOpt.value = this._currentBoardId;
            lastOpt.textContent = '🌟 Last Played Game';
            select.appendChild(lastOpt);
        }


        // Add Curated Modes (we'll just use a default configuration for them: 10 rounds, beginning, text)
        let playlists = CONFIG.PREDEFINED_PLAYLISTS;
        if (!playlists && CONFIG.CURATED_MODES) {
            playlists = { "Curated": CONFIG.CURATED_MODES };
        }
        
        if (playlists) {
            for (const [categoryName, items] of Object.entries(playlists)) {
                const optgroup = document.createElement('optgroup');
                optgroup.label = categoryName;

                items.forEach(item => {
                    const url = item.url || item.name;
                    let cleanPlaylistId = 'unknown';
                    const sp = MusicFetcher.parseSpotifyId(url);
                    if (sp) cleanPlaylistId = sp.id;
                    else {
                        const yt = MusicFetcher.parseYouTubeId(url);
                        if (yt) cleanPlaylistId = yt;
                        else {
                            const match = url.match(/pl\.[a-zA-Z0-9]+/);
                            if (match) cleanPlaylistId = match[0];
                        }
                    }
                    
                    if (cleanPlaylistId !== 'unknown') {
                        const boardId = `none_${cleanPlaylistId}_10_beginning_text`;
                        const opt = document.createElement('option');
                        opt.value = boardId;
                        opt.textContent = `${item.name} (10 rounds, Normal)`;
                        optgroup.appendChild(opt);
                    }
                });
                if (optgroup.children.length > 0) select.appendChild(optgroup);
            }
        }
        
        this._fetchSelectedLeaderboard();
    },

    async _fetchSelectedLeaderboard() {
        if (!CONFIG.WORKER_URL) return;
        const select = document.getElementById('leaderboard-select');
        const list = document.getElementById('home-leaderboard-list');
        if (!select || !list) return;

        const boardId = select.value;
        if (!boardId) return;

        list.innerHTML = '<div style="text-align: center; color: #9ca3af;"><i data-lucide="loader-2" class="icon-spin"></i> Loading...</div>';
        if (window.lucide) lucide.createIcons();

        try {
            const res = await fetch(`${CONFIG.WORKER_URL}/leaderboard?boardId=${boardId}`);
            if (!res.ok) throw new Error('Network response was not ok');
            const data = await res.json();
            
            list.innerHTML = '';
            if (!data || data.length === 0) {
                list.innerHTML = '<div style="text-align: center; color: #9ca3af;">No scores yet.</div>';
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
            const res = await fetch(`${CONFIG.WORKER_URL}/leaderboard?boardId=${this._currentBoardId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: name,
                    score: this.game.getScore(),
                    maxScore: this.game.getMaxScore(),
                    timeMs: this._gameTimeMs,
                    boardId: this._currentBoardId
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
