/**
 * sfx.js - Web Audio API Sound Effects
 */

const SFX = {
    audioCtx: null,

    init() {
        if (!this.audioCtx) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (AudioContext) {
                this.audioCtx = new AudioContext();
            }
        }
    },

    // Play a happy "Ding!" for correct answers
    playCorrect() {
        this._playTone(523.25, 'sine', 0.1, 0.1); // C5
        setTimeout(() => this._playTone(659.25, 'sine', 0.1, 0.2), 100); // E5
        setTimeout(() => this._playTone(783.99, 'sine', 0.1, 0.4), 200); // G5
    },

    // Play a sad "Bzz!" for wrong answers
    playWrong() {
        this._playTone(150, 'sawtooth', 0.2, 0.15); 
        setTimeout(() => this._playTone(130, 'sawtooth', 0.2, 0.2), 150); 
    },

    // Play a neutral "Pop" for transitions
    playPop() {
        this._playTone(400, 'sine', 0.05, 0.1);
    },

    _playTone(frequency, type, volume, duration) {
        if (!this.audioCtx) this.init();
        if (!this.audioCtx) return; // Browser doesn't support Web Audio

        // Resume audio context if suspended (browsers block audio until user interaction)
        if (this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }

        const oscillator = this.audioCtx.createOscillator();
        const gainNode = this.audioCtx.createGain();

        oscillator.type = type;
        oscillator.frequency.setValueAtTime(frequency, this.audioCtx.currentTime);

        // Simple envelope to prevent clicking
        gainNode.gain.setValueAtTime(0, this.audioCtx.currentTime);
        gainNode.gain.linearRampToValueAtTime(volume, this.audioCtx.currentTime + 0.02);
        gainNode.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + duration);

        oscillator.connect(gainNode);
        gainNode.connect(this.audioCtx.destination);

        oscillator.start(this.audioCtx.currentTime);
        oscillator.stop(this.audioCtx.currentTime + duration + 0.1);
    }
};
