import { AudioLayer } from './AudioLayer.js';

export class AudioMixer {
    constructor() {
        this.ctx = null;
        this.layers = [];
        this.coreLayerId = null;
        this.isPlaying = false;
        this.startTime = 0;
        this.startOffset = 0;
        this.onEnded = null;
        this._nextId = 1;
        this._exportDest = null;
        this.masterGain = null;
        this.masterPanner = null;
    }

    async init() {
        if (this.ctx) {
            try {
                this.layers.forEach(l => l.stop());
                this.layers = [];
                await this.ctx.close();
            } catch (err) {
                console.warn('[AudioMixer] Failed to close context:', err.message);
            }
            this.ctx = null;
        }
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        
        // ✅ Master stereo panner for all layers
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 1.0;

        this.masterPanner = this.ctx.createStereoPanner();
        this.masterPanner.pan.value = 0;
    }

    /** Set pan on the core (starred) layer */
    setCorePan(value) {
        const core = this.getCoreLayer();
        if (core) core.setPan(value);
    }

    /** Set pan on a specific layer */
    setLayerPan(layerId, value) {
        const layer = this.layers.find(l => l.id === layerId);
        if (layer) layer.setPan(value);
    }

    /** Set master volume for all layers (0 to 1) */
    setMasterVolume(value) {
        if (this.masterGain && this.ctx) {
            this.masterGain.gain.setTargetAtTime(value, this.ctx.currentTime, 0.02);
        }
    }

    async addLayer(name, file) {
        if (!this.ctx) await this.init();
        if (this.ctx.state === 'suspended') await this.ctx.resume();

        const id = `layer_${this._nextId++}`;
        const layer = new AudioLayer(id, name, this.ctx);
        await layer.load(file);
        this.layers.push(layer);

        if (!this.coreLayerId) {
            this.coreLayerId = id;
            layer.isCore = true;
        }

        if (this._exportDest && layer.gainNode) {
            try { layer.gainNode.connect(this._exportDest); } catch (err) {
                console.warn('[AudioMixer] Failed to connect gainNode:', err.message);
            }
            layer._exportDest = this._exportDest;
        }

        return id;
    }

    removeLayer(id) {
        const idx = this.layers.findIndex(l => l.id === id);
        if (idx === -1) return;
        const layer = this.layers[idx];
        layer.stop();
        // Safe disconnection with error logging
        if (layer.sourceNode) try { layer.sourceNode.disconnect(); } catch (err) { console.warn('[AudioMixer] sourceNode disconnect failed:', err.message); }
        if (layer.analyser) try { layer.analyser.disconnect(); } catch (err) { console.warn('[AudioMixer] analyser disconnect failed:', err.message); }
        if (layer.pannerNode) try { layer.pannerNode.disconnect(); } catch (err) { console.warn('[AudioMixer] pannerNode disconnect failed:', err.message); }
        if (layer.gainNode) try { layer.gainNode.disconnect(); } catch (err) { console.warn('[AudioMixer] gainNode disconnect failed:', err.message); }
        this.layers.splice(idx, 1);

        if (this.coreLayerId === id) {
            this.coreLayerId = this.layers.length > 0 ? this.layers[0].id : null;
            if (this.coreLayerId) {
                const newCore = this.layers.find(l => l.id === this.coreLayerId);
                if (newCore) newCore.isCore = true;
            }
        }
    }

    setCoreLayer(id) {
        this.layers.forEach(l => { l.isCore = (l.id === id); });
        this.coreLayerId = id;
    }

    getCoreLayer() {
        return this.layers.find(l => l.id === this.coreLayerId) || null;
    }

    play(offset) {
        if (this.layers.length === 0) return;
        if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();

        this.layers.forEach(l => l.stop());

        this.startOffset = offset || 0;
        this.startTime = this.ctx.currentTime - this.startOffset;
        this.isPlaying = true;

        const anySoloed = this.layers.some(l => l.soloed);
        this.layers.forEach(layer => {
            layer.play(this.startOffset);
            layer.applySoloState(anySoloed);

            if (this._exportDest && layer.gainNode) {
                try { layer.gainNode.connect(this._exportDest); } catch (err) {
                    console.warn('[AudioMixer] Failed to connect gainNode for export:', err.message);
                }
            }
        });

        const core = this.getCoreLayer();
        if (core && core.sourceNode) {
            core.sourceNode.onended = () => {
                if (this.isPlaying && this.getCurrentTime() >= this.getDuration() - 0.05) {
                    this.pause();
                    this.startOffset = 0;
                    this.onEnded?.();
                }
            };
        }
    }

    pause() {
        this.startOffset = this.getCurrentTime();
        this.isPlaying = false;
        this.layers.forEach(l => {
            l.stop();
            if (l.sourceNode) try { l.sourceNode.disconnect(); } catch (err) { console.warn('[AudioMixer] sourceNode disconnect failed:', err.message); }
        });
    }

    seekTo(time) {
        const dur = this.getDuration();
        time = Math.max(0, Math.min(time, dur));
        const wasPlaying = this.isPlaying;
        if (wasPlaying) this.pause();
        this.startOffset = time;
        if (wasPlaying) this.play(time);
        return time;
    }

    getCurrentTime() {
        if (!this.ctx) return 0;
        return this.isPlaying ? this.ctx.currentTime - this.startTime : this.startOffset;
    }

    getDuration() {
        let max = 0;
        this.layers.forEach(l => { if (l.buffer && l.buffer.duration > max) max = l.buffer.duration; });
        return max;
    }

    getCoreFrequencyData() {
        const core = this.getCoreLayer();
        return core ? core.getFrequencyData() : null;
    }

    getCoreChannelData() {
        const core = this.getCoreLayer();
        return core?.buffer?.getChannelData(0) || null;
    }

    getCoreBuffer() {
        const core = this.getCoreLayer();
        return core?.buffer || null;
    }

    updateSoloState() {
        const anySoloed = this.layers.some(l => l.soloed);
        this.layers.forEach(l => l.applySoloState(anySoloed));
    }

    setExportDestination(dest) {
        this._exportDest = dest;
        this.layers.forEach(layer => {
            if (!layer.gainNode) return;
            if (layer._exportDest) {
                try { layer.gainNode.disconnect(layer._exportDest); } catch (err) { console.warn('[AudioMixer] gainNode disconnect failed:', err.message); }
            }
            layer._exportDest = dest;
            if (dest) {
                try { layer.gainNode.connect(dest); } catch (err) { console.warn('[AudioMixer] gainNode connect failed:', err.message); }
            }
        });
    }

    destroy() {
        this.layers.forEach(l => {
            l.stop();
            if (l.sourceNode) try { l.sourceNode.disconnect(); } catch (err) { console.warn('[AudioMixer] sourceNode disconnect failed:', err.message); }
            if (l.analyser) try { l.analyser.disconnect(); } catch (err) { console.warn('[AudioMixer] analyser disconnect failed:', err.message); }
            if (l.pannerNode) try { l.pannerNode.disconnect(); } catch (err) { console.warn('[AudioMixer] pannerNode disconnect failed:', err.message); }
            if (l.gainNode) try { l.gainNode.disconnect(); } catch (err) { console.warn('[AudioMixer] gainNode disconnect failed:', err.message); }
            l._exportDest = null;
        });
        this.layers = [];
        this._exportDest = null;
        if (this.ctx) {
            this.ctx.close().catch(err => console.warn('[AudioMixer] Failed to close context:', err.message));
            this.ctx = null;
        }
        this.coreLayerId = null;
        this.isPlaying = false;
    }

    serialize() {
        return {
            layers: this.layers.map(l => l.serialize()),
            coreLayerId: this.coreLayerId,
            nextId: this._nextId,
        };
    }
}