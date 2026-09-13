/**
 * SYNTHWAVE ECG HEART VISUALIZER
 * 
 * Visual Architecture:
 * 1. Background: Pitch-black (#050505) with dark synthwave atmospheric glow.
 * 2. Centerpiece: Central 3D/crystalline vector heart (glowing pink/magenta #ff0066).
 * 3. Foreground Wave: Horizontal glowing red/white ECG line with static spike positions but dynamic heights.
 * 4. Equalizer UI: Modern HUD overlay at bottom with dark vertical bars and track info.
 */

// ==========================================
// CONFIGURABLE PARAMETERS
// ==========================================
const CONFIG = {
    // --- ECG Line Parameters ---
    spikeHeight: 120,      // Base height of the ECG peaks (Increase for taller spikes)
    beatSensitivity: 1.0,  // How violently spikes grow on music beats (0.5 = subtle, 5.0 = dramatic)
    waveSpeed: 0.05,       // Phase shift speed for subtle pulse animation
    lineColor: '#ff2a2a',  // Main color of the heartbeat wave
    lineGlow: '#ff0000',   // Neon glow aura color around the wave
    lineWidth: 2,          // Thickness of the ECG line

    // --- Heart Parameters ---
    heartBaseSize: 30,    // Initial pixel size of the center heart
    heartPulseScale: 60,   // Max extra size added on heavy bass drops
    heartColor: '#ff0066', // Main color of the neon heart outline
    heartGlowIntensity: 10,// Blur amount for heart glow

    // --- Audio FFT Parameters ---
    fftSize: 64,          // Resolution of audio data (64, 128, 256, 512)
    bassFrequencyCutoff: 5, // Bins to monitor for beat detection (lower = heavy bass focus)
    
    // --- UI Parameters ---
    hudHeight: 100,        // Height of the bottom HUD area
    barCount: 0,          // Number of frequency bars in HUD
    barColor: '#00ffff',   // Color of HUD bars
    textColor: '#ffffff'   // Color of HUD text
};

export class OverlayVisualizer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.width = 0;
        this.height = 0;
        
        // Transform state
        this.opacity = 0.7;
        this.blendMode = 'screen';
        this.scaleX = 1.0;
        this.scaleY = 1.0;
        this.offsetX = 0;
        this.offsetY = 0;
        this.rotation = 0;
        this.enabled = true;

        // Color settings
        this.colorMode = 'rainbow';
        this.primaryColor = '#00d4ff';
        this.secondaryColor = '#ff3366';
        this.saturation = 100;
        this.lightness = 55;

        this.vizSyncBand = 'bass';
        
        // Beat pulse state
        this.beatPulse = 0;
        this.lastBeatTime = 0;
        this.phase = 0; // For ECG wave animation
    }

    resize(displayWidth, displayHeight) {
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = Math.round(displayWidth * dpr);
        this.canvas.height = Math.round(displayHeight * dpr);
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.width = displayWidth;
        this.height = displayHeight;
    }

    setVizSyncBand(band) { this.vizSyncBand = band; }
    setMode(mode) { /* kept for compatibility */ }
    setOpacity(v) { this.opacity = Math.max(0, Math.min(1, v)); }
    setBlendMode(m) { this.blendMode = m; }
    setScale(x, y) { this.scaleX = x; this.scaleY = y; }
    setOffset(x, y) { this.offsetX = x; this.offsetY = y; }
    setRotation(deg) { this.rotation = deg; }
    setEnabled(v) { this.enabled = v; this.canvas.style.display = v ? 'block' : 'none'; }
    setColorMode(m) { this.colorMode = m; }
    setPrimaryColor(c) { this.primaryColor = c; }
    setSecondaryColor(c) { this.secondaryColor = c; }
    setSaturation(v) { this.saturation = Math.max(0, Math.min(100, v)); }
    setLightness(v) { this.lightness = Math.max(20, Math.min(80, v)); }

    /**
     * Get the frequency data slice for the current viz sync band.
     */
    _getSyncData(fullData) {
        if (!fullData) return { slice: null, energy: 0 };

        const len = fullData.length;
        let start = 0, end = len;

        switch (this.vizSyncBand) {
            case 'sub-bass':  start = 0;             end = Math.floor(len * 0.02); break;
            case 'bass':      start = 0;             end = Math.floor(len * 0.08); break;
            case 'low-mid':   start = Math.floor(len * 0.08); end = Math.floor(len * 0.15); break;
            case 'mid':       start = Math.floor(len * 0.15); end = Math.floor(len * 0.35); break;
            case 'high-mid':  start = Math.floor(len * 0.35); end = Math.floor(len * 0.55); break;
            case 'presence':  start = Math.floor(len * 0.55); end = Math.floor(len * 0.75); break;
            case 'full':      start = 0;             end = len; break;
        }

        end = Math.max(start + 2, end);
        const slice = fullData.slice(start, end);

        let sum = 0;
        for (let i = 0; i < slice.length; i++) sum += slice[i];
        const energy = sum / (slice.length * 255);

        return { slice, energy };
    }

    applyTransform() {
        this.canvas.style.opacity = this.opacity;
        this.canvas.style.mixBlendMode = this.blendMode;
        this.canvas.style.transform =
            `translate(${this.offsetX}%, ${this.offsetY}%) scale(${this.scaleX}, ${this.scaleY}) rotate(${this.rotation}deg)`;
    }

    render(freqData, timeData, beats = [], currentTime = 0) {
        if (!this.enabled || !freqData) return;
        
        const { ctx, width: w, height: h } = this;
        ctx.clearRect(0, 0, w, h);

        // 1. Background: Pitch black with synthwave atmospheric glow
        ctx.fillStyle = '#050505';
        ctx.fillRect(0, 0, w, h);
        
        // Subtle radial gradient for atmosphere
        const grad = ctx.createRadialGradient(w/2, h/2, 100, w/2, h/2, w);
        grad.addColorStop(0, 'rgba(20, 0, 20, 0.2)');
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);

        // Calculate Audio Metrics
        let bassEnergy = 0;
        let midEnergy = 0;
        const bassRange = Math.floor(freqData.length * 0.1);
        for (let i = 0; i < bassRange; i++) {
            bassEnergy += freqData[i];
        }
        bassEnergy = (bassEnergy / bassRange) / 255;
        
        const midStart = Math.floor(freqData.length * 0.1);
        const midEnd = Math.floor(freqData.length * 0.5);
        for (let i = midStart; i < midEnd; i++) {
            midEnergy += freqData[i];
        }
        midEnergy = (midEnergy / (midEnd - midStart)) / 255;

        // Beat Detection Logic
        const now = Date.now();
        const isBeat = bassEnergy > 0.6 && (now - this.lastBeatTime) > 100;
        if (isBeat) {
            this.lastBeatTime = now;
            this.beatPulse = 1.0;
        }
        this.beatPulse *= 0.92;

        const currentPulse = 1 + (this.beatPulse * (CONFIG.heartPulseScale / CONFIG.heartBaseSize));
        const ecgIntensity = 1 + (bassEnergy * CONFIG.beatSensitivity);

        // 2. Draw ECG Waveform (static positions, dynamic spike heights based on spectrum)
        this._drawECGWave(ctx, w, h, ecgIntensity, bassEnergy, freqData);

        // 3. Draw Central Crystalline Heart (with transparency so ECG shows through)
        //this._drawCrystallineHeart(ctx, w, h, currentPulse, bassEnergy);

        // 4. Draw HUD Equalizer & Info
        this._drawHUD(ctx, w, h, bassEnergy, midEnergy, currentTime);
    }

    /**
     * Draws the ECG line with spikes at fixed positions that react to frequency data
     * Spikes are positioned like spectrum bars but shaped as ECG QRS complexes
     */
    _drawECGWave(ctx, w, h, intensity, audioLevel, freqData) {
        const centerY = h / 2;
        const numSpikes = 7; // Number of QRS complexes across screen
        const segmentWidth = w / (numSpikes + 1);
        
        ctx.save();
        ctx.shadowBlur = 15;
        ctx.shadowColor = CONFIG.lineGlow;
        ctx.strokeStyle = CONFIG.lineColor;
        ctx.lineWidth = CONFIG.lineWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        ctx.beginPath();
        ctx.moveTo(0, centerY);

        for (let i = 1; i <= numSpikes; i++) {
            const x = i * segmentWidth;
            
            // Map screen position to frequency bin (like spectrum bars)
            const binIndex = Math.floor((i / numSpikes) * (freqData.length * 0.6));
            const audioValue = freqData[binIndex] || 0;
            const normalizedValue = audioValue / 255;
            
            // Determine spike height based on position and audio
            // Center spikes (3, 4) are the "main" beats and react more strongly
            const isMainBeat = (i === 3 || i === 4);
            let multiplier;
            
            if (isMainBeat) {
                multiplier = CONFIG.beatSensitivity * normalizedValue * (1 + this.beatPulse);
            } else {
                multiplier = 0.4 * normalizedValue;
            }

            // Calculate spike Y position with subtle phase animation
            const baseSpikeY = centerY - (CONFIG.spikeHeight * multiplier * Math.sin(this.phase * 2 + i));
            
            // Draw QRS complex shape
            const pX = x - (segmentWidth * 0.3);  // P wave position
            const pY = centerY - (10 * normalizedValue);
            
            const qX = x - (segmentWidth * 0.1);  // Q dip
            const qY = centerY + (15 * multiplier);
            
            const rY = baseSpikeY;  // R peak (the main spike)
            
            const sX = x + (segmentWidth * 0.1);  // S dip
            const sY = centerY + (20 * multiplier);
            
            const tX = x + (segmentWidth * 0.3);  // T wave
            const tY = centerY - (15 * normalizedValue);

            if (i === 1) {
                ctx.lineTo(pX, pY);
            }
            
            ctx.lineTo(qX, qY);
            ctx.lineTo(x, rY);
            ctx.lineTo(sX, sY);
            ctx.lineTo(tX, tY);
        }
        
        ctx.lineTo(w, centerY);
        ctx.stroke();
        
        // Add white highlight core for neon tube effect
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.8;
        ctx.stroke();
        
        ctx.restore();
        
        // Increment phase for subtle movement
        this.phase += CONFIG.waveSpeed;
    }

    _drawCrystallineHeart(ctx, w, h, scale, audioLevel) {
        const cx = w / 2;
        const cy = h / 2;
        const baseSize = CONFIG.heartBaseSize * scale;

        ctx.save();
        ctx.translate(cx, cy);
        
        // Glow
        ctx.shadowBlur = CONFIG.heartGlowIntensity * (1 + audioLevel);
        ctx.shadowColor = CONFIG.heartColor;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.strokeStyle = CONFIG.heartColor;
        ctx.lineWidth = 3;

        // Define Heart Shape Path (parametric equation)
        ctx.beginPath();
        for (let i = 0; i <= Math.PI * 2; i += 0.05) {
            const x = 16 * Math.pow(Math.sin(i), 3);
            const y = -(13 * Math.cos(i) - 5 * Math.cos(2*i) - 2 * Math.cos(3*i) - Math.cos(4*i));
            
            const px = x * (baseSize / 16);
            const py = y * (baseSize / 16);
            
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Crystalline facets (internal lines)
        ctx.shadowBlur = 0;
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(255, 0, 100, 0.4)';
        
        // Vertical facet
        ctx.beginPath();
        ctx.moveTo(0, -baseSize * 0.8);
        ctx.lineTo(0, baseSize * 0.6);
        ctx.stroke();

        // Horizontal facet
        ctx.beginPath();
        ctx.moveTo(-baseSize * 0.8, 0);
        ctx.lineTo(baseSize * 0.8, 0);
        ctx.stroke();
        
        // Diagonal facets
        ctx.beginPath();
        ctx.moveTo(-baseSize * 0.5, -baseSize * 0.5);
        ctx.lineTo(baseSize * 0.5, baseSize * 0.5);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(baseSize * 0.5, -baseSize * 0.5);
        ctx.lineTo(-baseSize * 0.5, baseSize * 0.5);
        ctx.stroke();

        ctx.restore();
    }

    _drawHUD(ctx, w, h, bass, mids, currentTime) {
        const barCount = CONFIG.barCount;
        const maxBarHeight = h * 0.15;
        
        ctx.save();
        ctx.font = '14px "Courier New", monospace';
        ctx.fillStyle = CONFIG.textColor;
        ctx.textBaseline = 'bottom';
        
        // Track Info
        ctx.shadowBlur = 10;
        ctx.shadowColor = CONFIG.textColor;
        ctx.fillText('AUDIO TRACK: SYNTHETIC PULSE', 20, h - 10);
        
        // Timestamp Counter
        const mins = Math.floor(currentTime / 60).toString().padStart(2, '0');
        const secs = Math.floor(currentTime % 60).toString().padStart(2, '0');
        ctx.fillText(`[${mins}:${secs}]`, w - 80, h - 10);

        // Equalizer Bars
        ctx.shadowBlur = 5;
        ctx.shadowColor = CONFIG.barColor;
        ctx.fillStyle = CONFIG.barColor;
        
        const startX = w * 0.4;
        const availableWidth = w * 0.55;
        const dynamicBarWidth = availableWidth / barCount;

        for (let i = 0; i < barCount; i++) {
            const value = (Math.sin(i * 0.5 + currentTime * 3) * 0.5 + 0.5) * 255 * (bass + 0.3);
            const percent = Math.min(1, value / 255);
            const barHeight = percent * maxBarHeight;
            
            const x = startX + (i * dynamicBarWidth);
            const y = h - 40;
            
            ctx.fillRect(x, y - barHeight, dynamicBarWidth - 1, barHeight);
        }
        
        ctx.restore();
    }

    _getColor(index, total, value) {
        const s = this.saturation;
        const l = this.lightness;

        switch (this.colorMode) {
            case 'solid':
                return this.primaryColor;

            case 'gradient': {
                const t = index / total;
                return this._lerpColor(this.primaryColor, this.secondaryColor, t);
            }

            case 'beat': {
                const beatL = Math.min(80, l + value * 30);
                const hue = 180 + value * 60;
                return `hsla(${hue},${s}%,${beatL}%,${0.6 + value * 0.4})`;
            }

            case 'rainbow':
            default: {
                const hue = (index / total) * 360;
                return `hsla(${hue},${s}%,${l}%,${0.6 + value * 0.4})`;
            }
        }
    }

    _lerpColor(a, b, t) {
        const ar = parseInt(a.slice(1, 3), 16), ag = parseInt(a.slice(3, 5), 16), ab = parseInt(a.slice(5, 7), 16);
        const br = parseInt(b.slice(1, 3), 16), bg = parseInt(b.slice(3, 5), 16), bb = parseInt(b.slice(5, 7), 16);
        const r = Math.round(ar + (br - ar) * t);
        const g = Math.round(ag + (bg - ag) * t);
        const bl = Math.round(ab + (bb - ab) * t);
        return `rgb(${r},${g},${bl})`;
    }

    serialize() {
        return {
            enabled: this.enabled,
            opacity: this.opacity,
            blendMode: this.blendMode,
            scaleX: this.scaleX,
            scaleY: this.scaleY,
            offsetX: this.offsetX,
            offsetY: this.offsetY,
            rotation: this.rotation,
            colorMode: this.colorMode,
            primaryColor: this.primaryColor,
            secondaryColor: this.secondaryColor,
            saturation: this.saturation,
            lightness: this.lightness,
            vizSyncBand: this.vizSyncBand,
        };
    }

    deserialize(o) {
        if (!o) return;
        this.enabled = o.enabled ?? true;
        this.blendMode = o.blendMode || 'screen';
        this.opacity = o.opacity ?? 0.7;
        this.scaleX = o.scaleX ?? 1;
        this.scaleY = o.scaleY ?? 1;
        this.offsetX = o.offsetX ?? 0;
        this.offsetY = o.offsetY ?? 0;
        this.rotation = o.rotation ?? 0;
        this.colorMode = o.colorMode || 'rainbow';
        this.primaryColor = o.primaryColor || '#00d4ff';
        this.secondaryColor = o.secondaryColor || '#ff3366';
        this.saturation = o.saturation ?? 100;
        this.lightness = o.lightness ?? 55;
        if (o.vizSyncBand) this.vizSyncBand = o.vizSyncBand;
    }
}
