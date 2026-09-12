/**
 * Keyframe automation engine for all effect parameters.
 * Supports linear, ease-in, ease-out, ease-in-out, and step interpolation.
 * Each track targets a specific effect.parameter path.
 */
export class KeyframeEngine {
    constructor() {
        // tracks: Map<trackId, { target, param, keyframes: [{time, value}], easing }>
        this.tracks = new Map();
        this.enabled = true;
        this._nextId = 1;
    }

    /**
     * Create a new automation track.
     * @param {string} target - e.g. 'jitter', 'scale', 'masterIntensity', 'overlay.opacity'
     * @param {string} param - e.g. 'intensity', 'speed', 'threshold', 'enabled', 'value'
     * @returns {string} trackId
     */
    addTrack(target, param) {
        const id = `track_${this._nextId++}`;
        this.tracks.set(id, {
            target,
            param,
            keyframes: [],
            easing: 'ease-in-out',
        });
        return id;
    }

    removeTrack(trackId) {
        this.tracks.delete(trackId);
    }

    /**
     * Add a keyframe to a track.
     * @param {string} trackId
     * @param {number} time - seconds
     * @param {number} value
     */
    addKeyframe(trackId, time, value) {
        const track = this.tracks.get(trackId);
        if (!track) return;

        // Remove existing keyframe at same time (snap)
        track.keyframes = track.keyframes.filter(kf => Math.abs(kf.time - time) > 0.01);

        track.keyframes.push({ time, value });
        track.keyframes.sort((a, b) => a.time - b.time);
    }

    removeKeyframe(trackId, time) {
        const track = this.tracks.get(trackId);
        if (!track) return;
        track.keyframes = track.keyframes.filter(kf => Math.abs(kf.time - time) > 0.01);
    }

    setEasing(trackId, easing) {
        const track = this.tracks.get(trackId);
        if (track) track.easing = easing;
    }

    /**
     * Get interpolated value for a track at a given time.
     * Returns null if no keyframes or outside range with no surrounding frames.
     */
    getValueAtTime(trackId, time) {
        const track = this.tracks.get(trackId);
        if (!track || track.keyframes.length === 0) return null;

        const kfs = track.keyframes;

        // Before first keyframe — hold first value
        if (time <= kfs[0].time) return kfs[0].value;
        // After last keyframe — hold last value
        if (time >= kfs[kfs.length - 1].time) return kfs[kfs.length - 1].value;

        // Find surrounding keyframes
        let prev = kfs[0], next = kfs[kfs.length - 1];
        for (let i = 0; i < kfs.length - 1; i++) {
            if (time >= kfs[i].time && time <= kfs[i + 1].time) {
                prev = kfs[i];
                next = kfs[i + 1];
                break;
            }
        }

        // Normalize progress between prev and next
        const duration = next.time - prev.time;
        if (duration === 0) return prev.value;
        let t = (time - prev.time) / duration;

        // Apply easing
        t = this._applyEasing(t, track.easing);

        // Linear interpolate
        return prev.value + (next.value - prev.value) * t;
    }

    _applyEasing(t, easing) {
        switch (easing) {
            case 'linear':      return t;
            case 'ease-in':     return t * t;
            case 'ease-out':    return t * (2 - t);
            case 'ease-in-out': return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
            case 'step':        return t < 0.5 ? 0 : 1;
            default:            return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
        }
    }

    /**
     * Get all automated values at a given time.
     * Returns Map<target.param, value>
     */
    getAllValuesAtTime(time) {
        const result = new Map();
        for (const [id, track] of this.tracks) {
            const val = this.getValueAtTime(id, time);
            if (val !== null) {
                result.set(`${track.target}.${track.param}`, val);
            }
        }
        return result;
    }

    /** Check if a specific target.param has automation */
    hasAutomation(target, param) {
        for (const [, track] of this.tracks) {
            if (track.target === target && track.param === param && track.keyframes.length > 0) {
                return true;
            }
        }
        return false;
    }

    /** Get track ID for a target.param pair */
    getTrackForTarget(target, param) {
        for (const [id, track] of this.tracks) {
            if (track.target === target && track.param === param) return id;
        }
        return null;
    }

    serialize() {
        const data = {};
        for (const [id, track] of this.tracks) {
            data[id] = {
                target: track.target,
                param: track.param,
                easing: track.easing,
                keyframes: track.keyframes.map(kf => ({ time: kf.time, value: kf.value })),
            };
        }
        return { tracks: data, enabled: this.enabled, nextId: this._nextId };
    }

    deserialize(data) {
        if (!data) return;
        this.tracks.clear();
        this.enabled = data.enabled ?? true;
        this._nextId = data.nextId || 1;
        if (data.tracks) {
            for (const [id, track] of Object.entries(data.tracks)) {
                this.tracks.set(id, {
                    target: track.target,
                    param: track.param,
                    easing: track.easing || 'ease-in-out',
                    keyframes: track.keyframes || [],
                });
            }
        }
    }
}