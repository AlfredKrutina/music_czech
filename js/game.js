/**
 * game.js — Game state machine, round management, and scoring.
 *
 * States: IDLE → PLAYING → ROUND_RESULT → GAME_OVER
 *
 * Scoring:
 *   Attempt 1 (0.1s clip) = 6 pts
 *   Attempt 2 (0.2s clip) = 5 pts
 *   ...
 *   Attempt 6 (4.0s clip) = 1 pt
 *   Failed = 0 pts
 */
class Game {
    constructor() {
        this.tracks = [];          // All playlist tracks
        this.gameTracks = [];      // Selected subset for this game
        this.currentRound = 0;     // 0-indexed
        this.currentAttempt = 0;   // 0-indexed into SKIP_DURATIONS
        this.score = 0;
        this.results = [];         // Per-round results
        this.state = 'IDLE';       // IDLE | PLAYING | ROUND_RESULT | GAME_OVER
    }

    /**
     * Initialize a new game: shuffle tracks and select the first numRounds.
     */
    startGame(tracks, numRounds) {
        this.tracks = tracks;
        this.gameTracks = this._shuffle([...tracks]).slice(0, Math.min(numRounds, tracks.length));
        this.currentRound = 0;
        this.currentAttempt = 0;
        this.score = 0;
        this.results = [];
        this.state = 'PLAYING';
    }

    /**
     * Get the track for the current round.
     */
    getCurrentTrack() {
        if (this.currentRound >= this.gameTracks.length) return null;
        return this.gameTracks[this.currentRound];
    }

    /**
     * Get the current clip duration in seconds.
     */
    getCurrentDuration() {
        return CONFIG.SKIP_DURATIONS[this.currentAttempt] ||
               CONFIG.SKIP_DURATIONS[CONFIG.SKIP_DURATIONS.length - 1];
    }

    /**
     * Get the current clip duration in milliseconds.
     */
    getCurrentDurationMs() {
        return Math.round(this.getCurrentDuration() * 1000);
    }

    /**
     * Get the current attempt number (0-indexed).
     */
    getAttemptNumber() {
        return this.currentAttempt;
    }

    /**
     * Get the maximum number of attempts (= number of skip durations).
     */
    getMaxAttempts() {
        return CONFIG.SKIP_DURATIONS.length;
    }

    /**
     * Whether the player can still skip (has remaining attempts).
     */
    canSkip() {
        return this.currentAttempt < CONFIG.SKIP_DURATIONS.length - 1;
    }

    /**
     * Skip (or wrong guess): advance to the next attempt duration.
     * If no more attempts, records a failed result.
     * @returns {{ canContinue: boolean, duration?: number }}
     */
    skip() {
        if (this.canSkip()) {
            this.currentAttempt++;
            return {
                canContinue: true,
                duration: this.getCurrentDuration()
            };
        }
        // Out of attempts → fail
        this._recordResult(false, 0);
        return { canContinue: false };
    }

    /**
     * Submit a guess. If correct → record success. If wrong → acts like a skip.
     * @param {string} guessText - The user's guess text
     * @returns {{ correct: boolean, points?: number, canContinue?: boolean, duration?: number }}
     */
    submitGuess(guessText) {
        const track = this.getCurrentTrack();
        if (!track) return { correct: false, canContinue: false };

        const correct = FuzzySearch.isMatch(guessText, track);

        if (correct) {
            const points = CONFIG.POINTS[this.currentAttempt] || 1;
            this.score += points;
            this._recordResult(true, points);
            return { correct: true, points };
        }

        // Wrong guess → acts as skip
        return this._handleWrongGuess();
    }

    /**
     * Submit a guess by selecting a specific track object from autocomplete.
     * @param {object} selectedTrack - The track object selected by the user
     * @returns {{ correct: boolean, points?: number, canContinue?: boolean, duration?: number }}
     */
    submitTrackGuess(selectedTrack) {
        const track = this.getCurrentTrack();
        if (!track) return { correct: false, canContinue: false };

        // Check if it's the same track (by name + artist or ID)
        const correct = (
            (track.id && selectedTrack.id && track.id === selectedTrack.id) ||
            (FuzzySearch.normalize(track.name) === FuzzySearch.normalize(selectedTrack.name) &&
             FuzzySearch.normalize(track.artist) === FuzzySearch.normalize(selectedTrack.artist))
        );

        if (correct) {
            const points = CONFIG.POINTS[this.currentAttempt] || 1;
            this.score += points;
            this._recordResult(true, points);
            return { correct: true, points };
        }

        return this._handleWrongGuess();
    }

    /**
     * Check if a guess is correct without modifying the game state.
     */
    checkGuessOnly(selectedTrack, guessText) {
        const track = this.getCurrentTrack();
        if (!track) return false;

        if (selectedTrack) {
            return (
                (track.id && selectedTrack.id && track.id === selectedTrack.id) ||
                (FuzzySearch.normalize(track.name) === FuzzySearch.normalize(selectedTrack.name) &&
                 FuzzySearch.normalize(track.artist) === FuzzySearch.normalize(selectedTrack.artist))
            );
        } else if (guessText) {
            return FuzzySearch.isMatch(guessText, track);
        }
        return false;
    }

    /** @private */
    _handleWrongGuess() {
        if (this.canSkip()) {
            this.currentAttempt++;
            return {
                correct: false,
                canContinue: true,
                duration: this.getCurrentDuration()
            };
        }
        // Out of attempts
        this._recordResult(false, 0);
        return { correct: false, canContinue: false };
    }

    /** @private */
    _recordResult(correct, points) {
        this.results.push({
            track: this.getCurrentTrack(),
            correct,
            points,
            attempts: this.currentAttempt + 1
        });
        this.state = 'ROUND_RESULT';
    }

    /**
     * Advance to the next round.
     * @returns {boolean} true if there are more rounds, false if game is over.
     */
    nextRound() {
        this.currentRound++;
        this.currentAttempt = 0;

        if (this.currentRound >= this.gameTracks.length) {
            this.state = 'GAME_OVER';
            return false;
        }

        this.state = 'PLAYING';
        return true;
    }

    isGameOver() {
        return this.state === 'GAME_OVER' || this.currentRound >= this.gameTracks.length;
    }

    getScore() {
        return this.score;
    }

    getMaxScore() {
        return this.gameTracks.length * (CONFIG.POINTS[0] || 6);
    }

    getTotalRounds() {
        return this.gameTracks.length;
    }

    getCurrentRoundNumber() {
        return this.currentRound + 1;
    }

    getResults() {
        return [...this.results];
    }

    /** Fisher-Yates shuffle */
    _shuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }
}
