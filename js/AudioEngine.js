/**
 * Handles all audio playback, seeking, timing, and AnalyserNode routing.
 * Exposes a clean interface — no DOM or rendering concerns.
 */
export class AudioEngine {
    constructor() {
        this.ctx = null;
        this.analyser = null;
        this.gainNode = null;
        this.sourceNode = null;
        this.buffer = null;
        this.isPlaying = false;
        this.startOffset = 0;
        this.startTime = 0;
        this.onEnded = null;
        this.volume = 1.0;
    }

    async load(file) {
        if (this.ctx) await this.ctx.close().catch(() => {});
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 2048;
        this.analyser.smoothingTimeConstant = 0.8;

        // ✅ Create gain node for volume control
        this.gainNode = this.ctx.createGain();
        this.gainNode.gain.value = this.volume;

        const arrayBuf = await file.arrayBuffer();
        try {
            this.buffer = await this.ctx.decodeAudioData(arrayBuf);
        } catch (err) {
            console.error('❌ Audio decode failed:', err);
            throw new Error('Failed to decode audio file. Try a different format.');
        }
        this.startOffset = 0;
        this.isPlaying = false;
        
        // Resume context if suspended (browser autoplay policy)
        if (this.ctx.state === 'suspended') {
            await this.ctx.resume();
        }
    }

    play() {
        if (!this.buffer) return;
        if (this.startOffset >= this.duration) this.startOffset = 0;

        // Ensure context is running
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }

        this.sourceNode = this.ctx.createBufferSource();
        this.sourceNode.buffer = this.buffer;

        // Chain: source → analyser → gain → destination
        this.sourceNode.connect(this.analyser);
        this.analyser.connect(this.gainNode);
        this.gainNode.connect(this.ctx.destination);

        // If an export destination exists, also route audio there
        if (this._exportDest) {
            this.analyser.connect(this._exportDest);
        }

        this.sourceNode.start(0, this.startOffset);
        this.startTime = this.ctx.currentTime - this.startOffset;
        this.isPlaying = true;

        this.sourceNode.onended = () => {
            if (this.isPlaying && this.getCurrentTime() >= this.duration - 0.05) {
                this.pause();
                this.startOffset = 0;
                this.onEnded?.();
            }
        };
    }

        // Add setter for export destination
    setExportDestination(dest) {
        this._exportDest = dest;
    }

    pause() {
        if (this.sourceNode) try { this.sourceNode.stop(); } catch (_) {}
        this.startOffset = this.getCurrentTime();
        this.isPlaying = false;
    }

    seekTo(time) {
        time = Math.max(0, Math.min(time, this.duration));
        const wasPlaying = this.isPlaying;
        if (wasPlaying) this.pause();
        this.startOffset = time;
        if (wasPlaying) this.play();
        return time;
    }

    getCurrentTime() {
        return this.isPlaying ? this.ctx.currentTime - this.startTime : this.startOffset;
    }

        // ✅ Volume control — works in real-time, even during playback
    setVolume(value) {
        this.volume = Math.max(0, Math.min(1, value));
        if (this.gainNode && this.ctx) {
            // Smooth ramp to avoid clicks
            this.gainNode.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
        }
    }

    getFrequencyData() {
        if (!this.analyser) return null;
        const data = new Uint8Array(this.analyser.frequencyBinCount);
        this.analyser.getByteFrequencyData(data);
        return data;
    }

    getTimeDomainData() {
        if (!this.analyser) return null;
        const data = new Uint8Array(this.analyser.frequencyBinCount);
        this.analyser.getByteTimeDomainData(data);
        return data;
    }

    get duration() { return this.buffer?.duration || 0; }
    get sampleRate() { return this.buffer?.sampleRate || 44100; }
    get channelData() { return this.buffer?.getChannelData(0) || null; }
    get bufferLength() { return this.buffer?.length || 0; }
}