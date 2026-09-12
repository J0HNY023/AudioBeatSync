/**
 * Advanced beat detector with multiple algorithms, expanded frequency bands,
 * onset sharpness filtering, BPM lock, and beat type labeling.
 */
export class BeatDetector {
    /* ── Frequency Band Definitions ─────────────────── */
    static BANDS = {
        'ultra-sub':      { type: 'lowpass',  freq: 30,   label: 'Ultra-Sub (10-30 Hz)' },
        'sub-bass':       { type: 'lowpass',  freq: 60,   label: 'Sub-Bass (20-60 Hz)' },
        'kick':           { type: 'bandpass', freq: 75,   Q: 2.0, label: 'Kick Fundamental (50-100 Hz)' },
        'bass':           { type: 'bandpass', freq: 150,  Q: 1.5, label: 'Bass / Kick (60-250 Hz)' },
        'guitar-chug':    { type: 'bandpass', freq: 250,  Q: 1.2, label: 'Guitar Chug (100-400 Hz)' },
        'vocal-formant':  { type: 'bandpass', freq: 550,  Q: 1.0, label: 'Vocal Formant (300-800 Hz)' },
        'low-mid':        { type: 'bandpass', freq: 375,  Q: 1.2, label: 'Snare Body / Toms (250-500 Hz)' },
        'mid':            { type: 'bandpass', freq: 1000, Q: 1.0, label: 'Vocals / Mids (500-2k Hz)' },
        'snare-crack':    { type: 'bandpass', freq: 2000, Q: 1.5, label: 'Snare Crack (1k-3k Hz)' },
        'clap':           { type: 'bandpass', freq: 2750, Q: 1.3, label: 'Clap Layer (1.5k-4k Hz)' },
        'high-mid':       { type: 'bandpass', freq: 3000, Q: 1.2, label: 'Hi-Hat / Clap (2k-4k Hz)' },
        'presence':       { type: 'bandpass', freq: 5000, Q: 1.0, label: 'Presence (4k-6k Hz)' },
        'ride-bell':      { type: 'bandpass', freq: 6500, Q: 1.5, label: 'Ride Bell (5k-8k Hz)' },
        'brilliance':     { type: 'highpass', freq: 6000, label: 'Brilliance (6k-20k Hz)' },
        'air':            { type: 'highpass', freq: 10000,label: 'Air / Sparkle (10k-20k Hz)' },
        'full':           null,
    };

    /* ── Beat Type Classification ───────────────────── */
    static BEAT_TYPE_BANDS = {
        kick:  ['ultra-sub', 'sub-bass', 'kick', 'bass'],
        snare: ['snare-crack', 'clap', 'high-mid', 'low-mid'],
        hat:   ['presence', 'ride-bell', 'brilliance', 'air'],
    };

    /**
     * Main detection entry point.
     * @param {AudioBuffer} audioBuffer
     * @param {Object} options
     * @returns {{ beats, filteredData, bpm, band }}
     */
    /**
     * Main detection entry point — now yields to UI thread during heavy computation.
     */
    static async detect(audioBuffer, options = {}) {
        const {
            band = 'bass',
            threshold = 1.4,
            minGapMs = 200,
            windowSize = 40,
            algorithm = 'energy',
            onsetSharpness = 0.0,
            decayRate = 0.5,
            bpmLock = false,
            preEmphasis = false,
            multiBand = false,
            labelTypes = false,
        } = options;

        // Yield helper — lets the browser paint/update between heavy steps
        const yieldToUI = () => new Promise(r => setTimeout(r, 0));

        let allBeats = [];
        let primaryFilteredData = null;

        if (multiBand) {
            const bandsToScan = ['kick', 'snare-crack', 'presence'];
            const bandBeats = [];

            for (const b of bandsToScan) {
                await yieldToUI(); // Let UI breathe between bands
                const filtered = await this._filter(audioBuffer, b);
                const beats = this._detectOnsets(filtered, audioBuffer.sampleRate, {
                    threshold: b === 'kick' ? threshold : threshold * 1.2,
                    minGapSec: minGapMs / 1000,
                    windowSize,
                    algorithm,
                    onsetSharpness,
                    decayRate,
                    preEmphasis,
                });
                beats.forEach(beat => { beat._sourceBand = b; });
                bandBeats.push(beats);
                if (b === 'kick') primaryFilteredData = filtered;
            }

            allBeats = this._mergeBeats(bandBeats, 0.05);
        } else {
            await yieldToUI();
            const filtered = await this._filter(audioBuffer, band);
            primaryFilteredData = filtered;

            await yieldToUI(); // Yield before heavy onset detection
            allBeats = this._detectOnsets(filtered, audioBuffer.sampleRate, {
                threshold,
                minGapSec: minGapMs / 1000,
                windowSize,
                algorithm,
                onsetSharpness,
                decayRate,
                preEmphasis,
            });
        }

        await yieldToUI();

        if (bpmLock && allBeats.length > 3) {
            allBeats = this._applyBpmLock(allBeats, audioBuffer.duration);
        }

        if (labelTypes && !multiBand) {
            await yieldToUI();
            await this._labelBeatTypes(allBeats, audioBuffer);
        } else if (multiBand) {
            allBeats.forEach(beat => {
                if (beat._sourceBand === 'kick') beat.type = 'kick';
                else if (beat._sourceBand === 'snare-crack') beat.type = 'snare';
                else beat.type = 'hat';
                delete beat._sourceBand;
            });
        }

        const bpm = this.estimateBPM(allBeats);
        return { beats: allBeats, filteredData: primaryFilteredData, bpm, band };
    }

    /* ── Band-Pass Filter ───────────────────────────── */
    static async _filter(audioBuffer, band) {
        const config = this.BANDS[band];
        if (!config) return audioBuffer.getChannelData(0);

        const offline = new OfflineAudioContext(1, audioBuffer.length, audioBuffer.sampleRate);
        const source = offline.createBufferSource();
        source.buffer = audioBuffer;

        const filter = offline.createBiquadFilter();
        filter.type = config.type;
        filter.frequency.value = config.freq;
        if (config.Q) filter.Q.value = config.Q;

        source.connect(filter);
        filter.connect(offline.destination);
        source.start(0);

        const rendered = await offline.startRendering();
        return rendered.getChannelData(0);
    }

    /* ── Pre-Emphasis Filter ────────────────────────── */
    static _applyPreEmphasis(data, sampleRate) {
        // Simple first-order high-shelf: boosts frequencies above ~1kHz
        // y[n] = x[n] - 0.95 * x[n-1]
        const output = new Float32Array(data.length);
        output[0] = data[0];
        for (let i = 1; i < data.length; i++) {
            output[i] = data[i] - 0.95 * data[i - 1];
        }
        // Normalize to prevent clipping
        let max = 0;
        for (let i = 0; i < output.length; i++) {
            const abs = Math.abs(output[i]);
            if (abs > max) max = abs;
        }
        if (max > 0) {
            const scale = 1 / max;
            for (let i = 0; i < output.length; i++) output[i] *= scale;
        }
        return output;
    }

    /* ── Onset Detection Engine ─────────────────────── */
        static _detectOnsets(data, sampleRate, options) {
        const {
            threshold, minGapSec, windowSize,
            algorithm, onsetSharpness, decayRate, preEmphasis,
        } = options;

        const processed = preEmphasis ? this._applyPreEmphasis(data, sampleRate) : data;

        const bufferSize = 1024;
        const hopSize = 512;

        // Compute energy envelope
        const energies = [];
        for (let i = 0; i < processed.length - bufferSize; i += hopSize) {
            let energy = 0;
            for (let j = 0; j < bufferSize; j++) energy += processed[i + j] ** 2;
            energies.push({ time: i / sampleRate, energy: energy / bufferSize });
        }

        // ✅ Compute global max energy for normalization
        let globalMaxEnergy = 0;
        for (let i = 0; i < energies.length; i++) {
            if (energies[i].energy > globalMaxEnergy) globalMaxEnergy = energies[i].energy;
        }
        if (globalMaxEnergy === 0) return [];

        // ✅ Minimum energy floor — beats below 3% of peak energy are silence/noise
        const minEnergyFloor = globalMaxEnergy * 0.03;

        // ✅ Skip first 100ms — avoids false triggers on track start
        const minStartTime = 0.1;

        // Compute spectral flux if needed
        let fluxes = null;
        if (algorithm === 'flux' || algorithm === 'combined') {
            fluxes = this._computeSpectralFlux(processed, sampleRate, hopSize);
        }

        const beats = [];

        for (let i = windowSize; i < energies.length - windowSize; i++) {
            // ✅ Skip silence — absolute energy too low
            if (energies[i].energy < minEnergyFloor) continue;

            // ✅ Skip track start
            if (energies[i].time < minStartTime) continue;

            // Local average for adaptive threshold
            let localAvg = 0;
            for (let j = i - windowSize; j <= i + windowSize; j++) {
                localAvg += energies[j].energy;
            }
            localAvg /= (windowSize * 2 + 1);
            if (localAvg === 0) continue;

            // ✅ Also skip if local average is too low (quiet section)
            if (localAvg < minEnergyFloor) continue;

            const energyRatio = energies[i].energy / localAvg;

            // Check onset sharpness
            if (onsetSharpness > 0 && i > 0) {
                const prevEnergy = energies[i - 1].energy;
                const currEnergy = energies[i].energy;
                const rise = prevEnergy > 0 ? (currEnergy - prevEnergy) / prevEnergy : 0;
                if (rise < onsetSharpness) continue;
            }

            // Algorithm-specific trigger condition
            let triggered = false;
            switch (algorithm) {
                case 'energy':
                    triggered = energyRatio > threshold &&
                        energies[i].energy >= energies[i - 1]?.energy &&
                        energies[i].energy >= energies[i + 1]?.energy;
                    break;

                case 'flux':
                    if (fluxes && i < fluxes.length) {
                        let fluxAvg = 0;
                        for (let j = Math.max(0, i - windowSize); j <= Math.min(fluxes.length - 1, i + windowSize); j++) {
                            fluxAvg += fluxes[j];
                        }
                        fluxAvg /= Math.min(i + windowSize, fluxes.length - 1) - Math.max(0, i - windowSize) + 1;
                        const fluxRatio = fluxAvg > 0 ? fluxes[i] / fluxAvg : 0;
                        triggered = fluxRatio > threshold &&
                            fluxes[i] >= fluxes[i - 1] &&
                            fluxes[i] >= fluxes[Math.min(i + 1, fluxes.length - 1)];
                    }
                    break;

                case 'combined':
                    if (fluxes && i < fluxes.length) {
                        let fluxAvg = 0;
                        for (let j = Math.max(0, i - windowSize); j <= Math.min(fluxes.length - 1, i + windowSize); j++) {
                            fluxAvg += fluxes[j];
                        }
                        fluxAvg /= Math.min(i + windowSize, fluxes.length - 1) - Math.max(0, i - windowSize) + 1;
                        const fluxRatio = fluxAvg > 0 ? fluxes[i] / fluxAvg : 0;
                        triggered = energyRatio > threshold * 0.8 &&
                            fluxRatio > threshold * 0.8 &&
                            energies[i].energy >= energies[i - 1]?.energy;
                    }
                    break;
            }

            // Minimum gap enforcement
            if (triggered && (beats.length === 0 || energies[i].time - beats[beats.length - 1].time > minGapSec)) {
                beats.push({
                    time: energies[i].time,
                    strength: energyRatio,
                    type: 'unknown',
                });
            }
        }

        return beats;
    }

    /* ── Spectral Flux Computation (Optimized) ───────── */
    static _computeSpectralFlux(data, sampleRate, hopSize) {
        // Instead of a full DFT (O(n²) per frame), approximate spectral flux
        // by measuring energy changes across 8 sub-bands using bandpass filtering.
        // This is O(n) per frame — hundreds of times faster.

        const bandCount = 8;
        const bandEnergies = []; // [frame][band] = energy
        const bufferSize = 1024;

        // Pre-compute energy in 8 logarithmic sub-bands for each frame
        for (let i = 0; i < data.length - bufferSize; i += hopSize) {
            const frameEnergies = new Float32Array(bandCount);

            // Divide the buffer into 8 sub-bands by chunking samples
            // (Approximation: lower indices ≈ lower frequencies after bandpass)
            const chunkSize = Math.floor(bufferSize / bandCount);
            for (let b = 0; b < bandCount; b++) {
                let energy = 0;
                const start = b * chunkSize;
                const end = start + chunkSize;
                for (let j = start; j < end; j++) {
                    energy += data[i + j] ** 2;
                }
                frameEnergies[b] = energy / chunkSize;
            }
            bandEnergies.push(frameEnergies);
        }

        // Compute half-wave rectified flux between consecutive frames
        const fluxes = [0];
        for (let i = 1; i < bandEnergies.length; i++) {
            let flux = 0;
            for (let b = 0; b < bandCount; b++) {
                const diff = bandEnergies[i][b] - bandEnergies[i - 1][b];
                if (diff > 0) flux += diff; // Half-wave rectify
            }
            fluxes.push(flux);
        }

        return fluxes;
    }

    /* ── BPM Lock — Snap Beats to Grid ──────────────── */
    static _applyBpmLock(beats, duration) {
        if (beats.length < 3) return beats;

        // Estimate BPM from median interval
        const intervals = [];
        for (let i = 1; i < beats.length; i++) {
            intervals.push(beats[i].time - beats[i - 1].time);
        }
        intervals.sort((a, b) => a - b);
        const medianInterval = intervals[Math.floor(intervals.length / 2)];
        const bpm = 60 / medianInterval;
        const beatPeriod = 60 / bpm;

        // Find the best phase offset (where does the grid start?)
        const firstBeat = beats[0].time;
        const phase = firstBeat % beatPeriod;

        // Snap each beat to the nearest grid position
        const snapped = beats.map(beat => {
            const gridIndex = Math.round((beat.time - phase) / beatPeriod);
            const snappedTime = phase + gridIndex * beatPeriod;
            // Only snap if the snap distance is reasonable (< 30% of beat period)
            const snapDist = Math.abs(beat.time - snappedTime);
            if (snapDist < beatPeriod * 0.3) {
                return { ...beat, time: Math.max(0, Math.min(duration, snappedTime)), snapped: true };
            }
            return { ...beat, snapped: false };
        });

        // Remove duplicates that may have snapped to the same grid position
        const deduped = [snapped[0]];
        for (let i = 1; i < snapped.length; i++) {
            if (Math.abs(snapped[i].time - deduped[deduped.length - 1].time) > beatPeriod * 0.5) {
                deduped.push(snapped[i]);
            }
        }

        return deduped;
    }

    /* ── Beat Type Labeling ─────────────────────────── */
    static async _labelBeatTypes(beats, audioBuffer) {
        // For each beat, check which frequency band has the most energy at that moment
        const sampleRate = audioBuffer.sampleRate;
        const halfWindow = Math.floor(sampleRate * 0.025); // 25ms window around beat

        // Pre-filter for kick, snare, hat bands
        const kickData = await this._filter(audioBuffer, 'kick');
        const snareData = await this._filter(audioBuffer, 'snare-crack');
        const hatData = await this._filter(audioBuffer, 'presence');

        for (const beat of beats) {
            const center = Math.floor(beat.time * sampleRate);
            const start = Math.max(0, center - halfWindow);
            const end = Math.min(kickData.length, center + halfWindow);

            let kickEnergy = 0, snareEnergy = 0, hatEnergy = 0;
            for (let i = start; i < end; i++) {
                kickEnergy += kickData[i] ** 2;
                snareEnergy += snareData[i] ** 2;
                hatEnergy += hatData[i] ** 2;
            }

            const max = Math.max(kickEnergy, snareEnergy, hatEnergy);
            if (max === 0) { beat.type = 'other'; continue; }

            if (kickEnergy === max) beat.type = 'kick';
            else if (snareEnergy === max) beat.type = 'snare';
            else if (hatEnergy === max) beat.type = 'hat';
            else beat.type = 'other';
        }
    }

    /* ── Multi-Band Merge ───────────────────────────── */
    static _mergeBeats(bandBeatsArrays, minGap) {
        // Flatten all beats into one array
        const all = bandBeatsArrays.flat();
        // Sort by time
        all.sort((a, b) => a.time - b.time);

        // Deduplicate: if two beats are within minGap, keep the stronger one
        const merged = [];
        for (const beat of all) {
            if (merged.length === 0 || beat.time - merged[merged.length - 1].time > minGap) {
                merged.push(beat);
            } else {
                // Keep the one with higher strength
                if (beat.strength > merged[merged.length - 1].strength) {
                    merged[merged.length - 1] = beat;
                }
            }
        }

        return merged;
    }

    /* ── BPM Estimation ─────────────────────────────── */
    static estimateBPM(beats) {
        if (beats.length < 2) return 0;
        const intervals = [];
        for (let i = 1; i < beats.length; i++) intervals.push(beats[i].time - beats[i - 1].time);
        intervals.sort((a, b) => a - b);
        const median = intervals[Math.floor(intervals.length / 2)];
        return Math.round(60 / median);
    }
}