/**
 * Single audio layer with independent volume, pan, mute, solo.
 * Shares playback position with the master timeline.
 */
export class AudioLayer {
    constructor(id, name, audioContext) {
        this.id = id;
        this.name = name;
        this.ctx = audioContext;
        this.buffer = null;
        this.sourceNode = null;
        this.gainNode = null;
        this.pannerNode = null;
        this.analyser = null;

        this.volume = 1.0;
        this.pan = 0.0;
        this.muted = false;
        this.soloed = false;
        this.isCore = false;
        this.loaded = false;
        this.fileName = '';
    }

    async load(file) {
        const arrayBuf = await file.arrayBuffer();
        this.buffer = await this.ctx.decodeAudioData(arrayBuf);
        this.fileName = file.name;
        this.loaded = true;

        // Create nodes
        this.gainNode = this.ctx.createGain();
        this.gainNode.gain.value = this.volume;

        this.pannerNode = this.ctx.createStereoPanner();
        this.pannerNode.pan.value = this.pan;

        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 2048;
        this.analyser.smoothingTimeConstant = 0.8;
    }

    play(offset) {
        if (!this.buffer || !this.ctx) return;
        if (this.sourceNode) try { this.sourceNode.stop(); } catch (_) {}

        this.sourceNode = this.ctx.createBufferSource();
        this.sourceNode.buffer = this.buffer;

        // Chain: source → analyser → panner → gain → destination
        this.sourceNode.connect(this.analyser);
        this.analyser.connect(this.pannerNode);
        this.pannerNode.connect(this.gainNode);
        this.gainNode.connect(this.ctx.destination);

        const safeOffset = Math.min(offset, this.buffer.duration);
        this.sourceNode.start(0, safeOffset);
    }

    stop() {
        if (this.sourceNode) {
            try { this.sourceNode.stop(); } catch (_) {}
            try { this.sourceNode.disconnect(); } catch (_) {}
            this.sourceNode = null;
        }
    }

    setVolume(v) {
        this.volume = Math.max(0, Math.min(1, v));
        if (this.gainNode && this.ctx) {
            this.gainNode.gain.setTargetAtTime(this._effectiveVolume(), this.ctx.currentTime, 0.02);
        }
    }

    setPan(v) {
        this.pan = Math.max(-1, Math.min(1, v));
        if (this.pannerNode) {
            this.pannerNode.pan.value = this.pan;  // Direct set — smoothing handled by AudioPanner
        }
    }

    setMuted(v) {
        this.muted = !!v;
        if (this.gainNode && this.ctx) {
            this.gainNode.gain.setTargetAtTime(this._effectiveVolume(), this.ctx.currentTime, 0.02);
        }
    }

    /** Calculate effective volume considering mute/solo state */
    _effectiveVolume() {
        if (this.muted) return 0;
        return this.volume;
    }

    /** Apply solo logic — called by mixer when any layer's solo changes */
    applySoloState(anySoloed) {
        if (!this.gainNode || !this.ctx) return;
        let vol;
        if (anySoloed) {
            vol = this.soloed ? this.volume : 0;
        } else {
            vol = this.muted ? 0 : this.volume;
        }
        this.gainNode.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.02);
    }

    getFrequencyData() {
        if (!this.analyser) return null;
        const data = new Uint8Array(this.analyser.frequencyBinCount);
        this.analyser.getByteFrequencyData(data);
        return data;
    }

    serialize() {
        return {
            id: this.id, name: this.name, fileName: this.fileName,
            volume: this.volume, pan: this.pan,
            muted: this.muted, soloed: this.soloed, isCore: this.isCore,
        };
    }
}