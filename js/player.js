/**
 * player.js — YouTube IFrame Player wrapper for audio-only playback.
 *
 * Creates an invisible YouTube player and provides precise clip timing control.
 * The player container must NOT use display:none (YouTube requires a renderable element).
 * Instead, it's positioned off-screen with opacity:0.
 */
class AudioPlayer {
    constructor(containerId) {
        this._containerId = containerId;
        this._player = null;
        this._ready = false;
        this._readyPromise = null;
        this._readyResolve = null;
        this._readyReject = null;
        this._clipTimeout = null;
        this._clipResolve = null;
        this._currentVideoId = null;
        this._errorCallback = null;
        this._loadResolve = null;
        this._loadReject = null;
        this._loadFallbackTimeout = null; // tracks fallback timer so it can be cancelled on error
    }

    /**
     * Initialize the YouTube IFrame API and create the player.
     * Must be called once before any other methods.
     * @returns {Promise<void>}
     */
    init() {
        if (this._readyPromise) return this._readyPromise;

        this._readyPromise = new Promise((resolve, reject) => {
            this._readyResolve = resolve;
            this._readyReject = reject;

            // If the YT API is already loaded, create the player immediately
            if (window.YT && window.YT.Player) {
                this._createPlayer();
                return;
            }

            // Register global callback
            const existingCallback = window.onYouTubeIframeAPIReady;
            window.onYouTubeIframeAPIReady = () => {
                if (existingCallback) existingCallback();
                this._createPlayer();
            };

            // Load the API script if not already present
            if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
                const tag = document.createElement('script');
                tag.src = 'https://www.youtube.com/iframe_api';
                tag.onerror = () => {
                    this._readyPromise = null; // allow retry
                    reject(new Error('Failed to load YouTube IFrame API. Check your internet connection.'));
                };
                const firstScript = document.getElementsByTagName('script')[0];
                firstScript.parentNode.insertBefore(tag, firstScript);
            }

            // Timeout after 15 seconds
            setTimeout(() => {
                if (!this._ready) {
                    this._readyPromise = null; // allow retry
                    reject(new Error('YouTube API load timeout (15s). Check your internet connection.'));
                }
            }, 15000);
        });

        return this._readyPromise;
    }

    /** @private */
    _createPlayer() {
        this._player = new YT.Player(this._containerId, {
            height: '1',
            width: '1',
            playerVars: {
                enablejsapi: 1,
                origin: window.location.origin,
                controls: 0,
                disablekb: 1,
                fs: 0,
                modestbranding: 1,
                playsinline: 1,
                rel: 0,
                iv_load_policy: 3  // hide annotations
            },
            events: {
                onReady: () => this._onReady(),
                onStateChange: (e) => this._onStateChange(e),
                onError: (e) => this._onError(e)
            }
        });
    }

    /** @private */
    _onReady() {
        this._ready = true;
        if (this._player.setVolume) {
            this._player.setVolume(100);
        }
        if (this._readyResolve) {
            this._readyResolve();
        }
    }

    /** @private */
    _onStateChange(event) {
        const state = event.data;

        // Resolve video load when playback starts or video is cued
        if (state === YT.PlayerState.PLAYING || state === YT.PlayerState.CUED) {
            if (this._loadResolve) {
                const resolve = this._loadResolve;
                this._loadResolve = null;
                this._loadReject = null;
                resolve();
            }
        }

        // Handle precise clip timing
        if (this._pendingClipDuration !== undefined && this._pendingClipDuration > 0) {
            if (state === YT.PlayerState.PLAYING) {
                this._lastPlayStartTime = performance.now();
                
                // Clear the fallback timeout since it actually started playing
                if (this._clipFallbackTimeout) {
                    clearTimeout(this._clipFallbackTimeout);
                    this._clipFallbackTimeout = null;
                }
                
                this._clipTimeout = setTimeout(() => {
                    this._player.pauseVideo();
                    this._pendingClipDuration = 0;
                    this._clipTimeout = null;
                    if (this._clipResolve) {
                        const res = this._clipResolve;
                        this._clipResolve = null;
                        this._clipReject = null;
                        res();
                    }
                }, this._pendingClipDuration);
            } else {
                // Transitioned out of PLAYING (e.g., to BUFFERING or PAUSED)
                if (this._clipTimeout) {
                    clearTimeout(this._clipTimeout);
                    this._clipTimeout = null;
                    
                    const elapsed = performance.now() - (this._lastPlayStartTime || performance.now());
                    this._pendingClipDuration -= elapsed;
                    if (this._pendingClipDuration < 0) this._pendingClipDuration = 0;
                }
            }
        }
    }

    /** @private */
    _onError(event) {
        const code = event.data;
        console.error('YouTube player error code:', code);

        // Cancel the fallback resolve timeout so it doesn't call resolve after reject
        if (this._loadFallbackTimeout) {
            clearTimeout(this._loadFallbackTimeout);
            this._loadFallbackTimeout = null;
        }

        // Translate error code to a human-readable message
        const errorMessages = {
            2:   'Invalid video ID.',
            5:   'HTML5 player error.',
            100: 'Video not found or is private.',
            101: 'Embedding disabled by the video owner.',
            150: 'Embedding disabled by the video owner.'
        };
        const message = errorMessages[code] || `YouTube player error (code ${code}).`;

        // Reject any pending load
        if (this._loadReject) {
            const reject = this._loadReject;
            this._loadResolve = null;
            this._loadReject = null;
            reject(new Error(message));
        }
        
        // Reject any pending clip play
        if (this._clipReject) {
            const reject = this._clipReject;
            this._clipResolve = null;
            this._clipReject = null;
            reject(new Error(message));
        }

        // Notify external error handler
        if (this._errorCallback) {
            this._errorCallback(code, message);
        }
    }

    /**
     * Register an error callback.
     */
    onError(callback) {
        this._errorCallback = callback;
    }

    /**
     * Fetch SponsorBlock data to skip non-music intros.
     * @private
     */
    async _getSponsorBlockData(videoId) {
        let startSeconds = 0;
        let highlightSeconds = null;
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 2000);
            
            const res = await fetch(
                `https://sponsor.ajay.app/api/skipSegments?videoID=${videoId}&categories=["music_offtopic","poi_highlight"]`,
                { signal: controller.signal }
            );
            clearTimeout(timeout);
            
            if (res.ok) {
                const data = await res.json();
                for (const segment of data) {
                    if (segment.category === 'music_offtopic' && segment.segment && segment.segment[0] <= 5) {
                        startSeconds = segment.segment[1];
                    }
                    if (segment.category === 'poi_highlight' && segment.segment) {
                        highlightSeconds = segment.segment[0];
                    }
                }
            }
        } catch (e) {}
        
        return { startSeconds, highlightSeconds };
    }

    /**
     * Load (cue) a YouTube video by ID. Does NOT auto-play.
     * @param {string} videoId
     * @returns {Promise<void>}
     */
    async loadVideo(videoId) {
        if (!this._ready || !this._player) {
            throw new Error('Player not initialized');
        }

        // Find true start time and chorus highlight
        const { startSeconds, highlightSeconds } = await this._getSponsorBlockData(videoId);
        
        this._currentVideoId = videoId;
        this._currentStartSeconds = startSeconds;
        this._currentHighlightSeconds = highlightSeconds;

        return new Promise((resolve, reject) => {
            this._loadResolve = resolve;
            this._loadReject = reject;

            try {
                this._player.cueVideoById({ videoId, startSeconds });
            } catch (e) {
                this._loadResolve = null;
                this._loadReject = null;
                reject(e);
                return;
            }

            // Resolve after timeout even if state event didn't fire
            // (YouTube sometimes doesn't fire CUED for short videos)
            // Store the timeout ID so _onError can cancel it (prevents resolve-after-reject race).
            this._loadFallbackTimeout = setTimeout(() => {
                this._loadFallbackTimeout = null;
                if (this._loadResolve) {
                    const res = this._loadResolve;
                    this._loadResolve = null;
                    this._loadReject = null;
                    res();
                }
            }, 3000);
        });
    }

    /**
     * Start playing muted to unlock browser autoplay restrictions before an async delay.
     */
    preparePlayback() {
        if (this._ready && this._player) {
            try {
                this._player.mute();
                this._player.playVideo();
            } catch (e) {}
        }
    }

    /**
     * Play a clip of the currently loaded video for exactly `durationMs` milliseconds.
     * Seeks to true start, plays, then pauses after the duration.
     * @param {number} durationMs - Clip duration in milliseconds
     * @param {string} startMode - 'beginning', 'chorus', or 'random'
     * @returns {Promise<void>} Resolves when the clip finishes playing
     */
    playClip(durationMs, startMode = 'beginning') {
        return new Promise((resolve, reject) => {
            if (!this._ready || !this._player) {
                resolve();
                return;
            }

            // Cancel any existing clip
            this._cancelClip();

            this._clipResolve = resolve;
            this._clipReject = reject;
            
            // Store the duration so _onStateChange can start the timer 
            // exactly when the audio starts (bypassing buffering delays).
            this._pendingClipDuration = durationMs;
            this._lastPlayStartTime = 0;

            // Seek to true start of the music (skipping intros)
            let start = this._currentStartSeconds || 0;
            const totalDur = this._player.getDuration() || 0;
            
            if (startMode === 'random') {
                const minStart = start + 30; // skip intro
                const maxStart = totalDur - (durationMs / 1000) - 5; // leave buffer at the end
                if (maxStart > minStart) {
                    start = minStart + Math.random() * (maxStart - minStart);
                }
            } else if (startMode === 'chorus') {
                // If SponsorBlock gave us a highlight, use it!
                if (this._currentHighlightSeconds) {
                    start = this._currentHighlightSeconds;
                } else if (totalDur > 45) {
                    // Fallback to 33% of the song if no highlight is found
                    start = totalDur * 0.33;
                }
            }
            
            this._player.seekTo(start, true);
            this._player.unMute();
            this._player.setVolume(100);
            this._player.playVideo();

            // If it's already playing (e.g., instant seek), start the timer manually
            if (this._player.getPlayerState() === YT.PlayerState.PLAYING) {
                this._onStateChange({ data: YT.PlayerState.PLAYING });
            }
            
            // Fallback timeout in case YouTube gets stuck buffering indefinitely
            this._clipFallbackTimeout = setTimeout(() => {
                const reject = this._clipReject;
                this._clipFallbackTimeout = null;
                this._cancelClip();
                if (reject) reject(new Error('Audio playback timed out. Video might be region-blocked.'));
            }, 6000);
        });
    }

    /**
     * Stop playback and seek to beginning.
     */
    stop() {
        this._cancelClip();
        if (this._ready && this._player) {
            try {
                this._player.pauseVideo();
                const start = this._currentStartSeconds || 0;
                this._player.seekTo(start, true);
            } catch (e) {
                // Player might be in a bad state, ignore
            }
        }
    }

    /** @private */
    _cancelClip() {
        this._pendingClipDuration = 0;
        if (this._clipTimeout) {
            clearTimeout(this._clipTimeout);
            this._clipTimeout = null;
        }
        if (this._clipFallbackTimeout) {
            clearTimeout(this._clipFallbackTimeout);
            this._clipFallbackTimeout = null;
        }
        if (this._clipResolve) {
            const res = this._clipResolve;
            this._clipResolve = null;
            this._clipReject = null;
            res();
        }
    }

    /**
     * Set volume (0-100).
     */
    setVolume(vol) {
        if (this._ready && this._player) {
            this._player.setVolume(vol);
        }
    }

    /**
     * @returns {boolean} Whether the player is ready to receive commands.
     */
    isReady() {
        return this._ready;
    }

    /**
     * Destroy the player instance and remove the iframe.
     */
    destroy() {
        this.stop();
        if (this._player) {
            try { this._player.destroy(); } catch (e) { /* ignore */ }
            this._player = null;
        }
        this._ready = false;
        this._readyPromise = null;
    }
}
