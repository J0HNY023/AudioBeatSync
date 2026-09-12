/**
 * Audio panning engine.
 * Single-file mode: uses its own StereoPannerNode on AudioEngine.
 * Multi-track mode: drives the core layer's pannerNode via the mixer.
 */
export class AudioPanner {
    constructor(audioEngine) {
        this.engine = audioEngine;
        this.pannerNode = null;
        this.mode = 'center';
        this.speed = 1.0;
        this.intensity = 1.0;
        this.manualPan = 0.0;
        this.smoothing = 0.05;
        this.enabled = true;
        this._startTime = 0;
        this._rafId = null;
        this._randomTarget = 0;
        this._randomTimer = 0;
        this._mixer = null;
        this._lastPanValue = 0;
        this._currentPan = 0;    // Actual smoothed output value
        this._targetPan = 0;     // Where we want to go
    }

    linkMixer(mixer) { this._mixer = mixer; }

    init() {
        if (!this.engine.ctx || !this.engine.analyser) return;
        try { this.engine.analyser.disconnect(); } catch (_) {}
        this.pannerNode = this.engine.ctx.createStereoPanner();
        this.pannerNode.pan.value = 0;
        this.engine.analyser.connect(this.pannerNode);
        this.pannerNode.connect(this.engine.gainNode);
        if (this.engine._exportDest) {
            try { this.pannerNode.connect(this.engine._exportDest); } catch (_) {}
        }
    }

    reconnect() {
        if (!this.pannerNode || !this.engine.analyser) return;
        try { this.engine.analyser.disconnect(); } catch (_) {}
        this.engine.analyser.connect(this.pannerNode);
        this.pannerNode.connect(this.engine.gainNode);
        if (this.engine._exportDest) {
            try { this.pannerNode.connect(this.engine._exportDest); } catch (_) {}
        }
    }

    setMode(mode) {
        this.mode = mode;
        this._startTime = performance.now() / 1000;
        this._randomTarget = 0;
        this._randomTimer = 0;
        switch (mode) {
            case 'center': this._applyPan(0); break;
            case 'left':   this._applyPan(-1 * this.intensity); break;
            case 'right':  this._applyPan(1 * this.intensity); break;
            case 'manual': this._applyPan(this.manualPan * this.intensity); break;
        }
    }

    setSpeed(v) { this.speed = Math.max(0.1, Math.min(5.0, v)); }
    setIntensity(v) { this.intensity = Math.max(0.0, Math.min(1.0, v)); }
    setManualPan(v) {
        this.manualPan = Math.max(-1.0, Math.min(1.0, v));
        if (this.mode === 'manual') this._applyPan(this.manualPan * this.intensity);
    }
    setSmoothing(v) { this.smoothing = Math.max(0.01, Math.min(0.2, v)); }
    setEnabled(v) {
        this.enabled = v;
        if (!v) this._applyPan(0);
    }

    /** Apply pan value with manual smoothing */
    _applyPan(value) {
        const clamped = Math.max(-1, Math.min(1, value));
        this._targetPan = clamped;
        this._lastPanValue = clamped;

        // Smoothed value is applied in update() via lerp
        // Direct audio node update happens below with the smoothed value
        const smoothFactor = 1 - Math.exp(-1 / (this.smoothing * 60)); // per-frame decay
        this._currentPan += (this._targetPan - this._currentPan) * smoothFactor;

        // Snap if very close (avoid infinite micro-adjustments)
        if (Math.abs(this._currentPan - this._targetPan) < 0.001) {
            this._currentPan = this._targetPan;
        }

        const outputPan = this._currentPan;

        // Single-file mode
        if (this.pannerNode && this.engine.ctx) {
            this.pannerNode.pan.value = outputPan;  // Direct set, no setTargetAtTime
        }

        // Multi-track mode
        if (this._mixer) {
            this._mixer.setCorePan(outputPan);
        }
    }

    update(currentTime) {
        if (!this.enabled) return;

        const t = performance.now() / 1000 - this._startTime;
        let panValue = 0;

        switch (this.mode) {
            case 'center':  panValue = 0; break;
            case 'left':    panValue = -1 * this.intensity; break;
            case 'right':   panValue = 1 * this.intensity; break;
            case 'loop': {
                const phase = t * this.speed * Math.PI * 2;
                panValue = Math.sin(phase) * this.intensity;
                break;
            }
            case 'bounce': {
                const cycle = t * this.speed;
                const triangle = 2 * Math.abs(2 * (cycle - Math.floor(cycle + 0.5))) - 1;
                panValue = triangle * this.intensity;
                break;
            }
            case 'random': {
                this._randomTimer += 1 / 60;
                const interval = 1 / this.speed;
                if (this._randomTimer >= interval) {
                    this._randomTimer = 0;
                    this._randomTarget = (Math.random() * 2 - 1) * this.intensity;
                }
                panValue = this._randomTarget;
                break;
            }
            case 'manual':
                panValue = this.manualPan * this.intensity;
                break;
        }

        this._applyPan(panValue);
    }

    getCurrentPan() {
        return this._lastPanValue;
    }

    serialize() {
        return {
            enabled: this.enabled, mode: this.mode, speed: this.speed,
            intensity: this.intensity, manualPan: this.manualPan, smoothing: this.smoothing,
        };
    }

    deserialize(data) {
        if (!data) return;
        if (data.enabled !== undefined) this.enabled = data.enabled;
        if (data.mode) this.mode = data.mode;
        if (data.speed !== undefined) this.speed = data.speed;
        if (data.intensity !== undefined) this.intensity = data.intensity;
        if (data.manualPan !== undefined) this.manualPan = data.manualPan;
        if (data.smoothing !== undefined) this.smoothing = data.smoothing;
    }
}