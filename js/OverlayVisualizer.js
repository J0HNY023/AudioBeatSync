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
    beatSensitivity: 3.0,  // How violently spikes grow on music beats (0.5 = subtle, 5.0 = dramatic)
    waveSpeed: 0.05,       // Phase shift speed for subtle pulse animation
    lineColor: '#ff2a2a',  // Main color of the heartbeat wave
    lineGlow: '#ff0000',   // Neon glow aura color around the wave
    lineWidth: 3,          // Thickness of the ECG line

    // --- Heart Parameters ---
    heartBaseSize: 120,    // Initial pixel size of the center heart
    heartPulseScale: 40,   // Max extra size added on heavy bass drops
    heartColor: '#ff0066', // Main color of the neon heart outline
    heartGlowIntensity: 20,// Blur amount for heart glow

    // --- Audio FFT Parameters ---
    fftSize: 256,          // Resolution of audio data (64, 128, 256, 512)
    bassFrequencyCutoff: 20, // Bins to monitor for beat detection (lower = heavy bass focus)
    
    // --- UI Parameters ---
    hudHeight: 100,        // Height of the bottom HUD area
    barCount: 32,          // Number of frequency bars in HUD
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
        this._drawCrystallineHeart(ctx, w, h, currentPulse, bassEnergy);

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

<<<<<<< HEAD
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

        switch (this.mode) {
            case 'bars':     this._drawBars(ctx, freqData, w, h); break;
            case 'mirror':   this._drawMirrorBars(ctx, freqData, w, h); break;
            case 'circular': this._drawCircular(ctx, freqData, w, h); break;
            case 'radial':   this._drawRadialBurst(ctx, freqData, w, h); break;
            case 'wave':     this._drawOscilloscope(ctx, timeData, w, h); break;
            case 'particles':this._drawParticles(ctx, freqData, w, h); break;
            case 'dotSpectrum':    this._drawDotSpectrum(ctx, freqData, w, h); break;
            case 'glitchSpectrum': this._drawGlitchSpectrum(ctx, freqData, w, h); break;
            case 'audioTunnel':    this._drawAudioTunnel(ctx, freqData, w, h); break;
            case 'neonWave':       this._drawNeonWave(ctx, timeData, w, h); break;
            case 'constellation':  this._drawConstellation(ctx, freqData, w, h); break;
            case 'bassPulse':      this._drawBassPulse(ctx, freqData, w, h); break;
            case 'reactiveGrid':   this._drawReactiveGrid(ctx, freqData, w, h); break;
            case 'heatmap':        this._drawHeatmap(ctx, freqData, w, h); break;
            case 'arcWaveform':    this._drawArcWaveform(ctx, timeData || freqData, w, h); break;
            case 'heartbeat':      this._drawHeartbeatLine(ctx, freqData, w, h); break;
            case 'ecgCluster':     this._drawECGCluster(ctx, freqData, w, h); break;
            case 'beatingHeart':   this._drawBeatingHeart(ctx, freqData, w, h, beats, currentTime); break;
        }
    }

    _drawBars(ctx, data, w, h) {
        const count = Math.floor(data.length * 0.4);
        const barW = w / count;
        for (let i = 0; i < count; i++) {
            const v = data[i] / 255;
            const barH = v * h * 0.9;
            ctx.fillStyle = this._getColor(i, count, v);
            ctx.fillRect(i * barW, h - barH, barW - 1, barH);
        }
    }

    _drawMirrorBars(ctx, data, w, h) {
        const count = Math.floor(data.length * 0.4);
        const barW = w / count;
        const mid = h / 2;
        for (let i = 0; i < count; i++) {
            const v = data[i] / 255;
            const barH = v * mid * 0.9;
            ctx.fillStyle = this._getColor(i, count, v);
            ctx.fillRect(i * barW, mid - barH, barW - 1, barH * 2);
        }
    }

    _drawCircular(ctx, data, w, h) {
        const cx = w / 2, cy = h / 2, radius = Math.min(w, h) * 0.2;
        const bars = 128;
        for (let i = 0; i < bars; i++) {
            const v = data[i] / 255;
            const angle = (i / bars) * Math.PI * 2 - Math.PI / 2;
            const r2 = radius + v * radius * 1.8;
            ctx.strokeStyle = this._getColor(i, bars, v);
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
            ctx.lineTo(cx + Math.cos(angle) * r2, cy + Math.sin(angle) * r2);
            ctx.stroke();
        }
        const bass = data.slice(0, 8).reduce((a, b) => a + b, 0) / (8 * 255);
        ctx.beginPath();
        ctx.arc(cx, cy, radius * 0.4 + bass * 25, 0, Math.PI * 2);
        ctx.fillStyle = this._getColor(0, 1, bass);
        ctx.globalAlpha = 0.3 + bass * 0.4;
        ctx.fill();
        ctx.globalAlpha = 1;
    }

    _drawRadialBurst(ctx, data, w, h) {
        const cx = w / 2, cy = h / 2;
        const bars = 180;
        for (let i = 0; i < bars; i++) {
            const v = data[Math.floor(i * data.length * 0.3 / bars)] / 255;
            const angle = (i / bars) * Math.PI * 2;
            const len = v * Math.min(w, h) * 0.5;
            ctx.strokeStyle = this._getColor(i, bars, v);
            ctx.lineWidth = 2 + v * 3;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + Math.cos(angle) * len, cy + Math.sin(angle) * len);
            ctx.stroke();
        }
    }

    _drawOscilloscope(ctx, data, w, h) {
        if (!data) return;
        ctx.strokeStyle = this.primaryColor;
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let i = 0; i < data.length; i++) {
            const y = (data[i] / 128.0) * h / 2;
            i === 0 ? ctx.moveTo(0, y) : ctx.lineTo((i / data.length) * w, y);
        }
        ctx.stroke();
        // Glow
        ctx.strokeStyle = this.primaryColor + '4D'; // 30% alpha
        ctx.lineWidth = 8;
        ctx.beginPath();
        for (let i = 0; i < data.length; i++) {
            const y = (data[i] / 128.0) * h / 2;
            i === 0 ? ctx.moveTo(0, y) : ctx.lineTo((i / data.length) * w, y);
        }
        ctx.stroke();
    }

    _drawParticles(ctx, data, w, h) {
        const bass = data.slice(0, 16).reduce((a, b) => a + b, 0) / (16 * 255);
        if (bass > 0.55) {
            for (let i = 0; i < 4; i++) {
                this.particles.push({
                    x: w / 2 + (Math.random() - 0.5) * 120,
                    y: h / 2 + (Math.random() - 0.5) * 80,
                    vx: (Math.random() - 0.5) * bass * 14,
                    vy: (Math.random() - 0.5) * bass * 14,
                    life: 1, size: 2 + Math.random() * 5 * bass,
                    hue: Math.random() * 360,
                });
            }
        }
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.x += p.vx; p.y += p.vy; p.life -= 0.014; p.size *= 0.98;
            if (p.life <= 0) { this.particles.splice(i, 1); continue; }
            ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            if (this.colorMode === 'solid') {
                ctx.fillStyle = this.primaryColor;
                ctx.globalAlpha = p.life;
            } else {
                ctx.fillStyle = `hsla(${p.hue},${this.saturation}%,${this.lightness}%,${p.life})`;
            }
            ctx.fill();
            ctx.globalAlpha = 1;
        }
        if (this.particles.length > 600) this.particles.splice(0, this.particles.length - 600);
    }

    /* ── Dot Spectrum ──────────────────────────────── */
_drawDotSpectrum(ctx, data, w, h) {
    const count = Math.floor(data.length * 0.3);
    const spacing = w / count;
    for (let i = 0; i < count; i++) {
        const v = data[i] / 255;
        const dotSize = 1 + v * 6;
        const y = h - v * h * 0.85;
        ctx.beginPath();
        ctx.arc(i * spacing + spacing / 2, y, dotSize, 0, Math.PI * 2);
        ctx.fillStyle = this._getColor(i, count, v);
        ctx.fill();
    }
}

/* ── Glitch Spectrum ───────────────────────────── */
_drawGlitchSpectrum(ctx, data, w, h) {
    const count = Math.floor(data.length * 0.4);
    const barW = w / count;
    for (let i = 0; i < count; i++) {
        const v = data[i] / 255;
        const barH = v * h * 0.9;
        const glitchOffset = v > 0.7 ? (Math.random() - 0.5) * 20 * v : 0;

        // Red channel offset
        ctx.fillStyle = `rgba(255,0,0,${0.3 + v * 0.3})`;
        ctx.fillRect(i * barW + glitchOffset - 2, h - barH, barW - 1, barH);

        // Blue channel offset
        ctx.fillStyle = `rgba(0,100,255,${0.3 + v * 0.3})`;
        ctx.fillRect(i * barW + glitchOffset + 2, h - barH, barW - 1, barH);

        // Main bar
        ctx.fillStyle = this._getColor(i, count, v);
        ctx.fillRect(i * barW + glitchOffset, h - barH, barW - 1, barH);
    }

    // Random horizontal tear
    if (Math.random() < 0.1) {
        const tearY = Math.random() * h;
        const tearH = 2 + Math.random() * 6;
        ctx.fillStyle = `rgba(255,255,255,0.1)`;
        ctx.fillRect(0, tearY, w, tearH);
    }
}

/* ── Audio Tunnel ──────────────────────────────── */
_drawAudioTunnel(ctx, data, w, h) {
    const cx = w / 2, cy = h / 2;
    const maxR = Math.min(w, h) * 0.45;
    const rings = 12;
    const bass = data.slice(0, 8).reduce((a, b) => a + b, 0) / (8 * 255);

    for (let r = 0; r < rings; r++) {
        const baseRadius = (r / rings) * maxR + 20;
        const freqIdx = Math.floor((r / rings) * data.length * 0.3);
        const v = data[freqIdx] / 255;
        const radius = baseRadius + v * 30 + bass * 20;

        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.strokeStyle = this._getColor(r, rings, v);
        ctx.lineWidth = 1.5 + v * 3;
        ctx.globalAlpha = 0.3 + v * 0.5;
        ctx.stroke();
    }
    ctx.globalAlpha = 1;
}

/* ── Neon Wave ─────────────────────────────────── */
_drawNeonWave(ctx, data, w, h) {
    if (!data) return;
    const mid = h / 2;

    // Outer glow pass
    ctx.strokeStyle = this.primaryColor + '33';
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
        const y = mid + ((data[i] - 128) / 128) * mid * 0.8;
        i === 0 ? ctx.moveTo(0, y) : ctx.lineTo((i / data.length) * w, y);
    }
    ctx.stroke();

    // Mid glow
    ctx.strokeStyle = this.primaryColor + '88';
    ctx.lineWidth = 5;
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
        const y = mid + ((data[i] - 128) / 128) * mid * 0.8;
        i === 0 ? ctx.moveTo(0, y) : ctx.lineTo((i / data.length) * w, y);
    }
    ctx.stroke();

    // Core bright line
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
        const y = mid + ((data[i] - 128) / 128) * mid * 0.8;
        i === 0 ? ctx.moveTo(0, y) : ctx.lineTo((i / data.length) * w, y);
    }
    ctx.stroke();
}

/* ── Constellation ─────────────────────────────── */
_drawConstellation(ctx, data, w, h) {
    const count = 60;
    const points = [];
    for (let i = 0; i < count; i++) {
        const v = data[Math.floor((i / count) * data.length * 0.5)] / 255;
        const angle = (i / count) * Math.PI * 2 + performance.now() * 0.0003;
        const radius = 50 + v * Math.min(w, h) * 0.35;
        points.push({
            x: w / 2 + Math.cos(angle) * radius,
            y: h / 2 + Math.sin(angle) * radius,
            v, size: 1.5 + v * 4,
        });
    }

    // Draw connections
    ctx.lineWidth = 0.5;
    for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
            const dx = points[i].x - points[j].x;
            const dy = points[i].y - points[j].y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 100) {
                ctx.strokeStyle = this._getColor(i, count, points[i].v);
                ctx.globalAlpha = (1 - dist / 100) * 0.4;
                ctx.beginPath();
                ctx.moveTo(points[i].x, points[i].y);
                ctx.lineTo(points[j].x, points[j].y);
                ctx.stroke();
            }
        }
    }
    ctx.globalAlpha = 1;

    // Draw dots
    points.forEach((p, i) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = this._getColor(i, count, p.v);
        ctx.fill();
    });
}

    /* ── Bass Pulse ────────────────────────────────── */
    _drawBassPulse(ctx, data, w, h) {
        const bass = data.slice(0, 10).reduce((a, b) => a + b, 0) / (10 * 255);
        const cx = w / 2, cy = h / 2;
        const maxR = Math.min(w, h) * 0.4;

        // Pulsing circle
        const r = maxR * (0.3 + bass * 0.7);
        const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        gradient.addColorStop(0, this._getColor(0, 1, bass));
        gradient.addColorStop(0.7, this._getColor(0, 1, bass).replace(')', ',0.3)').replace('rgb', 'rgba'));
        gradient.addColorStop(1, 'transparent');

        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.globalAlpha = 0.3 + bass * 0.5;
        ctx.fill();
        ctx.globalAlpha = 1;

        // Ring
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.strokeStyle = this._getColor(0, 1, bass);
        ctx.lineWidth = 2 + bass * 4;
        ctx.stroke();
    }

    /* ── Reactive Grid ─────────────────────────────── */
    _drawReactiveGrid(ctx, data, w, h) {
        const bass = data.slice(0, 8).reduce((a, b) => a + b, 0) / (8 * 255);
        const cols = 16, rows = 10;
        const cellW = w / cols, cellH = h / rows;

        ctx.lineWidth = 0.8;
        // Horizontal lines
        for (let r = 0; r <= rows; r++) {
            const freqIdx = Math.floor((r / rows) * data.length * 0.3);
            const v = data[freqIdx] / 255;
            ctx.strokeStyle = this._getColor(r, rows, v);
            ctx.globalAlpha = 0.2 + v * 0.5;
            ctx.beginPath();
            for (let c = 0; c <= cols; c++) {
                const x = c * cellW;
                const warp = Math.sin(c * 0.5 + performance.now() * 0.002) * v * 15 * bass;
                const y = r * cellH + warp;
                c === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            }
            ctx.stroke();
        }
        // Vertical lines
        for (let c = 0; c <= cols; c++) {
            const freqIdx = Math.floor((c / cols) * data.length * 0.3);
            const v = data[freqIdx] / 255;
            ctx.strokeStyle = this._getColor(c, cols, v);
            ctx.globalAlpha = 0.2 + v * 0.5;
            ctx.beginPath();
            for (let r = 0; r <= rows; r++) {
                const y = r * cellH;
                const warp = Math.sin(r * 0.5 + performance.now() * 0.002) * v * 15 * bass;
                const x = c * cellW + warp;
                r === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            }
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
    }

    /* ── Frequency Heatmap ─────────────────────────── */
    _drawHeatmap(ctx, data, w, h) {
        const bands = 64;
        const bandW = w / bands;
        const scrollSpeed = 2;

        // Shift existing image left
        if (!this._heatBuffer) {
            this._heatBuffer = document.createElement('canvas');
            this._heatBuffer.width = w;
            this._heatBuffer.height = h;
        }
        const hctx = this._heatBuffer.getContext('2d');

        // Scroll left
        hctx.drawImage(this._heatBuffer, -scrollSpeed, 0);

        // Draw new column on right
        for (let i = 0; i < bands; i++) {
            const v = data[Math.floor((i / bands) * data.length * 0.5)] / 255;
            const barH = v * h;
            hctx.fillStyle = this._getColor(i, bands, v);
            hctx.fillRect(w - scrollSpeed, h - barH, scrollSpeed, barH);
        }

        ctx.drawImage(this._heatBuffer, 0, 0);
    }

    /* ── Arc Waveform (Minimalist Phonk Style) ─────── */
  _drawArcWaveform(ctx, data, w, h) {
    if (!data) return;

    const cx = w / 2;
    const cy = h * 0.85;
    const arcRadius = w * 0.45;
    const spikeHeight = h * 0.35;
    const points = 180;
    const startAngle = Math.PI + 0.3;
    const endAngle = 2 * Math.PI - 0.3;

    if (!this._arcSmooth) this._arcSmooth = new Float32Array(points + 1);
    const smooth = this._arcSmooth;

    const bassEnd = Math.floor(data.length * 0.15);

    let bassEnergy = 0;
    for (let i = 0; i < bassEnd; i++) bassEnergy += data[i];
    bassEnergy /= (bassEnd * 255);

    const beatThreshold = 0.45;
    const isBeat = bassEnergy > beatThreshold;

    ctx.beginPath();
    for (let i = 0; i <= points; i++) {
        const t = i / points;
        const angle = startAngle + t * (endAngle - startAngle);

        const freqIdx = Math.floor(t * bassEnd);
        const rawV = data[freqIdx] / 255;

        let targetV = isBeat ? rawV : 0;

        const rate = targetV > smooth[i] ? 0.4 : 0.03;
        smooth[i] += (targetV - smooth[i]) * rate;

        const v = smooth[i];
        const r = arcRadius - v * spikeHeight;

        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;

        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.2;
    ctx.stroke();
}

_drawHeartbeatLine(ctx, data, w, h) {
    if (!data) return;

    const midY = h / 2;
    const maxSpike = h * 0.4;
    const points = 400;

    // Focus on bass for beat detection
    const bassEnergy = (() => {
        const start = 0;
        const end = Math.floor(data.length * 0.1);
        let sum = 0;
        for (let i = start; i < end; i++) sum += data[i];
        return sum / ((end - start) * 255);
    })();

    // Track burst state
    if (!this._ekgBurst) this._ekgBurst = null;
    if (!this._ekgLastBeat) this._ekgLastBeat = 0;

    const now = performance.now() / 1000;
    const beatThreshold = 0.3;
    const minBeatInterval = 0.2;
    const ekgDuration = 0.3;

    // Trigger new heartbeat on strong bass hits
    if (bassEnergy > beatThreshold && (now - this._ekgLastBeat) > minBeatInterval) {
        const intensity = Math.min(1.0, 0.4 + (bassEnergy - beatThreshold) * 1.5);
        this._ekgBurst = {
            startTime: now,
            phase: 0,
            intensity: intensity,
            peakEnergy: bassEnergy,
        };
        this._ekgLastBeat = now;
    }

    // Update burst animation
    if (this._ekgBurst) {
        this._ekgBurst.phase += (1 / 60) / ekgDuration;
        
        // Allow intensity to grow if stronger hit comes during early phase
        if (this._ekgBurst.phase < 0.3 && bassEnergy > this._ekgBurst.peakEnergy) {
            this._ekgBurst.peakEnergy = bassEnergy;
            this._ekgBurst.intensity = Math.min(1.0, 0.4 + (bassEnergy - beatThreshold) * 1.5);
        }
        
        if (this._ekgBurst.phase >= 1.0) {
            this._ekgBurst = null;
        }
    }

    // Draw the EKG line with traveling burst
    ctx.beginPath();
    for (let i = 0; i <= points; i++) {
        const t = i / points;
        const x = t * w;
        let y = midY;

        if (this._ekgBurst) {
            const burst = this._ekgBurst;
            const burstPos = burst.phase; // Position travels from 0 to 1
            const burstWidth = 0.15;
            
            const distFromBurst = Math.abs(t - burstPos);
            if (distFromBurst < burstWidth / 2) {
                const localT = (t - (burstPos - burstWidth / 2)) / burstWidth;
                const ekgVal = sampleEKGPattern(localT);
                
                // Smooth fade in/out at burst edges
                let fade = 1;
                const edgeFade = distFromBurst / (burstWidth / 2);
                if (edgeFade > 0.7) {
                    fade = (1 - edgeFade) * 3.33;
                }
                
                y = midY - ekgVal * maxSpike * burst.intensity * fade;
            }
        }

        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }

    // Multi-layer stroke for glow effect
    ctx.strokeStyle = 'rgba(255,80,80,0.08)';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,80,80,0.3)';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,200,200,0.95)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Subtle grid lines for medical monitor feel
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    const gridSize = w / 8;
    for (let gx = 0; gx < w; gx += gridSize) {
        ctx.beginPath();
        ctx.moveTo(gx, midY - maxSpike * 0.8);
        ctx.lineTo(gx, midY + maxSpike * 0.6);
        ctx.stroke();
    }
    for (let gy = midY - maxSpike * 0.8; gy <= midY + maxSpike * 0.6; gy += gridSize * 0.6) {
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(w, gy);
        ctx.stroke();
    }
}

/**
 * ECG Cluster - Multi-peak waveform cluster with dense multi-vertex pulse.
 * Shows multiple overlapping EKG traces that react to different frequency bands.
 */
_drawECGCluster(ctx, data, w, h) {
    if (!data) return;

    const midY = h / 2;
    const maxSpike = h * this.ecgHeight;
    const points = this.ecgVertices;
    const numTraces = this.ecgTraces;
    const spacing = this.ecgSpacing;
    const freqSeparation = this.ecgFreqSeparation; // Controls space between frequency bands
    const spikeShape = this.ecgSpikeShape; // 0 = smooth ECG, 1 = sharp cone/triangle

    // Calculate energy for different frequency bands for isolation
    const bandEnergy = (startRatio, endRatio) => {
        const start = Math.floor(data.length * startRatio);
        const end = Math.floor(data.length * endRatio);
        let sum = 0;
        for (let i = start; i < end; i++) sum += data[i];
        return sum / ((end - start) * 255);
    };

    // Frequency isolation zones - adjusted by freqSeparation setting
    const sepOffset = freqSeparation * 0.15; // Higher separation = more gap between bands
    const bassEnergy = bandEnergy(0, 0.08);      // Q wave depth
    const lowMidEnergy = bandEnergy(0.08 + sepOffset, 0.20 - sepOffset); // R wave base
    const vocalEnergy = bandEnergy(0.20 + sepOffset, 0.35 - sepOffset);  // R wave height
    const highMidEnergy = bandEnergy(0.35 + sepOffset, 0.50 - sepOffset);// R' initiation
    const presenceEnergy = bandEnergy(0.50 + sepOffset, 0.65 - sepOffset);// R' sharpness
    const trebleEnergy = bandEnergy(0.65 + sepOffset, 0.85); // R' prime peak complexity

    // Fixed spike positions across the canvas (like spectrum bars)
    const numSpikes = Math.floor(1 / spacing);
    const spikePositions = [];
    for (let s = 0; s < numSpikes; s++) {
        spikePositions.push((s + 0.5) / numSpikes);
    }

    // Track activation state for each spike position per trace
    if (!this._ecgSpikes) this._ecgSpikes = [];
    if (this._ecgSpikes.length !== numTraces) {
        this._ecgSpikes = Array(numTraces).fill(null).map(() => []);
    }
    for (let t = 0; t < numTraces; t++) {
        if (this._ecgSpikes[t].length !== numSpikes) {
            this._ecgSpikes[t] = Array(numSpikes).fill(null);
        }
    }

    const now = performance.now() / 1000;
    const beatThreshold = 0.12;
    const minBeatInterval = 0.06;
    const ekgDuration = 0.2;

    // Each spike corresponds to a specific narrow frequency bin
    const freqBinsPerSpike = Math.floor(data.length * 0.7 / numSpikes);
    
    const baseColors = [
        { outer: 'rgba(255,80,80,0.08)', mid: 'rgba(255,80,80,0.3)', inner: 'rgba(255,200,200,0.95)' },
        { outer: 'rgba(80,200,255,0.08)', mid: 'rgba(80,200,255,0.3)', inner: 'rgba(200,240,255,0.95)' },
        { outer: 'rgba(80,255,150,0.08)', mid: 'rgba(80,255,150,0.3)', inner: 'rgba(200,255,220,0.95)' },
        { outer: 'rgba(255,180,80,0.08)', mid: 'rgba(255,180,80,0.3)', inner: 'rgba(255,240,200,0.95)' },
        { outer: 'rgba(200,80,255,0.08)', mid: 'rgba(200,80,255,0.3)', inner: 'rgba(240,200,255,0.95)' },
        { outer: 'rgba(255,80,180,0.08)', mid: 'rgba(255,80,180,0.3)', inner: 'rgba(255,200,230,0.95)' },
        { outer: 'rgba(80,255,200,0.08)', mid: 'rgba(80,255,200,0.3)', inner: 'rgba(200,255,240,0.95)' },
        { outer: 'rgba(255,200,80,0.08)', mid: 'rgba(255,200,80,0.3)', inner: 'rgba(255,240,180,0.95)' },
    ];
    const verticalOffsets = [];
    const traceSpacing = maxSpike * 0.25;
    const startY = midY - ((numTraces - 1) * traceSpacing) / 2;
    for (let t = 0; t < numTraces; t++) {
        verticalOffsets.push(startY + t * traceSpacing);
    }

    // Check each spike position for activation based on ISOLATED frequency energy
    for (let t = 0; t < numTraces; t++) {
        for (let s = 0; s < numSpikes; s++) {
            // Map each spike to a SPECIFIC frequency bin range
            const freqStart = Math.floor(data.length * (0.1 + (s / numSpikes) * 0.7));
            const freqEnd = Math.min(data.length, freqStart + freqBinsPerSpike);
            
            // Isolate energy in this specific frequency range
            let localEnergy = 0;
            let localBass = 0, localVocal = 0, localTreble = 0;
            let binCount = 0;
            
            for (let fi = freqStart; fi < freqEnd && fi < data.length; fi++) {
                const normVal = data[fi] / 255;
                localEnergy += normVal;
                
                // Categorize bins within this spike's range
                const binRatio = (fi - freqStart) / (freqEnd - freqStart);
                if (binRatio < 0.33) localBass += normVal;
                else if (binRatio < 0.66) localVocal += normVal;
                else localTreble += normVal;
                
                binCount++;
            }
            
            if (binCount > 0) {
                localEnergy /= binCount;
                localBass /= Math.ceil(binCount * 0.33);
                localVocal /= Math.ceil(binCount * 0.33);
                localTreble /= Math.floor(binCount * 0.34);
            }
            
            // Add trace variation
            const traceOffset = (t * 0.08) % 0.2;
            const energyVaried = localEnergy * (1.0 + traceOffset + Math.random() * 0.2);
            
            // Store isolated frequency components for waveform shaping
            if (energyVaried > beatThreshold && (!this._ecgSpikes[t][s] || (now - this._ecgSpikes[t][s].startTime) > minBeatInterval)) {
                const delayOffset = s * 0.005 * (1 - energyVaried);
                const activationTime = now - delayOffset;
                
                if (!this._ecgSpikes[t][s] || (activationTime - this._ecgSpikes[t][s].startTime) > minBeatInterval) {
                    this._ecgSpikes[t][s] = {
                        startTime: activationTime,
                        phase: 0,
                        intensity: Math.min(1.5, 0.4 + (energyVaried - beatThreshold) * 2.0),
                        rawEnergy: energyVaried,
                        // Store isolated frequency energies for pathological shape
                        bassComponent: Math.min(1.0, localBass),      // Controls Q depth
                        vocalComponent: Math.min(1.0, localVocal),   // Controls R height
                        trebleComponent: Math.min(1.0, localTreble), // Controls R' sharpness
                    };
                }
            }

            // Update burst animation
            if (this._ecgSpikes[t][s]) {
                this._ecgSpikes[t][s].phase += (1 / 60) / ekgDuration;
                if (this._ecgSpikes[t][s].phase >= 1.0) {
                    this._ecgSpikes[t][s] = null;
                }
            }
        }
    }

    // Draw each ECG trace at its fixed vertical position
    for (let traceIdx = 0; traceIdx < numTraces; traceIdx++) {
        const traceY = verticalOffsets[traceIdx];
        const color = baseColors[traceIdx % baseColors.length];

        ctx.beginPath();
        for (let i = 0; i <= points; i++) {
            const t = i / points;
            const x = t * w;
            let y = traceY;

            // Check contribution from each spike at this x position
            for (let s = 0; s < numSpikes; s++) {
                const spikeX = spikePositions[s];
                const spikeWidth = spacing * 0.85;

                if (this._ecgSpikes[traceIdx][s]) {
                    const distFromSpike = Math.abs(t - spikeX);
                    
                    if (distFromSpike < spikeWidth / 2) {
                        const localT = (t - (spikeX - spikeWidth / 2)) / spikeWidth;
                        const burstPhase = this._ecgSpikes[traceIdx][s].phase;
                        const spikeIntensity = this._ecgSpikes[traceIdx][s].intensity;
                        const rawEnergy = this._ecgSpikes[traceIdx][s].rawEnergy || 0;
                        const bassComp = this._ecgSpikes[traceIdx][s].bassComponent || 0;
                        const vocalComp = this._ecgSpikes[traceIdx][s].vocalComponent || 0;
                        const trebleComp = this._ecgSpikes[traceIdx][s].trebleComponent || 0;

                        // PATHOLOGICAL RSr' WAVEFORM with DEEP Q
                        // Each component driven by isolated frequency band
                        
                        // Amplitude scales with overall energy but modulated by frequency isolation
                        const amplitudeScale = 0.4 + rawEnergy * 2.0;
                        
                        // Vertex density increases dramatically with treble content
                        const vertexDensity = 20 + Math.floor(trebleComp * 100);
                        const sharpnessFactor = 0.4 + trebleComp * 2.2;
                        
                        // Apply spikeShape: 0 = smooth ECG curves, 1 = sharp cone/triangle
                        const shapeInterp = spikeShape; // 0 to 1

                        let ekgVal = 0;

                        // DEEP Q WAVE - Driven by BASS/low frequencies
                        // Pathological deep Q indicates bass-heavy content
                        if (localT >= 0.08 && localT < 0.18) {
                            const qT = (localT - 0.08) / 0.1;
                            // Deep negative deflection proportional to bass energy
                            const qDepth = 0.35 + bassComp * 0.6; // Can go very deep
                            
                            // Shape interpolation: sin curve -> triangle/cone
                            let baseQ = -Math.sin(qT * Math.PI) * qDepth * amplitudeScale;
                            if (shapeInterp > 0) {
                                const triangleQ = -(1 - Math.abs(qT - 0.5) * 2) * qDepth * amplitudeScale;
                                baseQ = baseQ * (1 - shapeInterp) + triangleQ * shapeInterp;
                            }
                            ekgVal = baseQ;
                        }
                        
                        // R WAVE - Primary upward spike driven by VOCALS/low-mid
                        // Massive R wave for vocal presence - shaped as cone/triangle when spikeShape is high
                        else if (localT >= 0.18 && localT < 0.32) {
                            const rT = (localT - 0.18) / 0.14;
                            // Asymmetric sharp rise, controlled fall
                            const rHeight = 0.8 + vocalComp * 1.2; // Scales with vocal energy
                            
                            // Base ECG shape (curved)
                            const riseSharp = rT < 0.25 ? Math.pow(rT / 0.25, 0.4) : 1;
                            const fallSharp = rT >= 0.25 ? Math.pow((1 - rT) / 0.75, 0.6) : 0;
                            const baseR = (riseSharp + fallSharp) * rHeight * amplitudeScale * sharpnessFactor;
                            
                            // Cone/triangle shape (linear rise and fall)
                            const coneR = (rT < 0.5 ? rT * 2 : (1 - rT) * 2) * rHeight * amplitudeScale * sharpnessFactor;
                            
                            ekgVal = baseR * (1 - shapeInterp) + coneR * shapeInterp;
                        }
                        
                        // NOTCH between R and R' - Small dip
                        else if (localT >= 0.32 && localT < 0.38) {
                            const notchT = (localT - 0.32) / 0.06;
                            ekgVal = (0.3 - notchT * 0.3) * amplitudeScale;
                        }
                        
                        // R' PRIME - Secondary sharp spike driven by TREBLE/HIGHS
                        // This is the pathological feature - prominent only with high-frequency content
                        // Becomes ultra-sharp cone when spikeShape is high
                        else if (localT >= 0.38 && localT < 0.52) {
                            const rpT = (localT - 0.38) / 0.14;
                            // R' only prominent if treble exists
                            const rPrimePresence = 0.2 + trebleComp * 0.9; // Minimal without treble, massive with it
                            
                            // Base ECG shape
                            const riseUltraSharp = rpT < 0.2 ? Math.pow(rpT / 0.2, 0.3) : 1;
                            const fallUltraSharp = rpT >= 0.2 ? Math.pow((1 - rpT) / 0.8, 0.5) : 0;
                            const baseRPrime = (riseUltraSharp + fallUltraSharp) * rPrimePresence * amplitudeScale * sharpnessFactor * 1.3;
                            
                            // Ultra-sharp cone/triangle for extreme treble visualization
                            const coneRPrime = (rpT < 0.3 ? rpT / 0.3 : (1 - rpT) / 0.7) * rPrimePresence * amplitudeScale * sharpnessFactor * 1.5;
                            
                            ekgVal = baseRPrime * (1 - shapeInterp) + coneRPrime * shapeInterp;
                        }
                        
                        // S WAVE - Downward deflection after R' complex
                        else if (localT >= 0.52 && localT < 0.65) {
                            const sT = (localT - 0.52) / 0.13;
                            const sDepth = 0.25 + (rawEnergy * 0.4);
                            
                            let baseS = -Math.sin(sT * Math.PI) * sDepth * amplitudeScale * 0.7;
                            if (shapeInterp > 0) {
                                const triangleS = -(1 - Math.abs(sT - 0.5) * 2) * sDepth * amplitudeScale * 0.7;
                                baseS = baseS * (1 - shapeInterp) + triangleS * shapeInterp;
                            }
                            ekgVal = baseS;
                        }
                        
                        // T WAVE - Small recovery bump
                        else if (localT >= 0.65 && localT < 0.82) {
                            const tT = (localT - 0.65) / 0.17;
                            ekgVal = Math.sin(tT * Math.PI) * 0.15 * amplitudeScale * 0.5;
                        }

                        // HYPER-REACTIVE RAZOR-SHARP ZIG-ZAG CLUSTER for high-frequencies
                        // Creates dense multi-peak patterns on cymbals, hi-hats, percussion
                        if (localT >= 0.15 && localT < 0.75 && trebleComp > 0.15) {
                            let clusterVal = 0;
                            
                            // Multiple overlapping high-frequency harmonics
                            for (let v = 0; v < 4; v++) {
                                const harmonicFreq = vertexDensity * (1 + v * 0.43);
                                const harmonicAmp = (1 / (v + 1)) * (0.08 * trebleComp * sharpnessFactor);
                                const phaseShift = v * 0.9 + rawEnergy;
                                clusterVal += Math.sin((localT - 0.15) * harmonicFreq * Math.PI + phaseShift) * harmonicAmp;
                            }
                            
                            // Ultra-sharp random jitter for extreme treble (cymbal shimmer)
                            if (trebleComp > 0.5) {
                                const jitterFreq = vertexDensity * 3.5;
                                const jitterAmp = (trebleComp - 0.5) * 0.05 * sharpnessFactor;
                                clusterVal += Math.sin((localT - 0.15) * jitterFreq * Math.PI + now * 50) * jitterAmp;
                                
                                // Add second layer of chaos
                                clusterVal += Math.cos((localT - 0.15) * jitterFreq * 1.7 * Math.PI - now * 30) * jitterAmp * 0.7;
                            }
                            
                            // Apply cluster with envelope focused on R-R' region
                            const clusterEnvelope = Math.sin((localT - 0.15) * Math.PI / 0.6);
                            ekgVal += clusterVal * Math.max(0, clusterEnvelope) * sharpnessFactor;
                        }

                        // Fade at edges smoothly
                        let fade = 1;
                        const edgeFade = distFromSpike / (spikeWidth / 2);
                        if (edgeFade > 0.65) {
                            fade = Math.pow((1 - edgeFade) / 0.35, 2);
                        }

                        // Apply burst phase
                        if (burstPhase >= 0 && burstPhase <= 1) {
                            const attackDecay = burstPhase < 0.12 
                                ? burstPhase / 0.12
                                : 1 - Math.pow((burstPhase - 0.12) / 0.88, 1.6);
                            y = traceY - ekgVal * maxSpike * spikeIntensity * fade * attackDecay;
                        }
                    }
                }
            }

            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }

        // Multi-layer stroke for glow effect
        ctx.strokeStyle = color.outer;
        ctx.lineWidth = 8;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();

        ctx.strokeStyle = color.mid;
        ctx.lineWidth = 3;
        ctx.stroke();

        ctx.strokeStyle = color.inner;
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }

    // Subtle grid lines for medical monitor feel
>>>>>>> 17c011b1a0b60d923f0154be202fb988173a6a52
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 5; i++) {
        const divX = (i / 5) * w;
        ctx.beginPath();
        ctx.moveTo(gx, midY - maxSpike * 0.6);
        ctx.lineTo(gx, midY + maxSpike * 0.6);
        ctx.stroke();
    }
}

_drawBeatingHeart(ctx, data, w, h, beats = [], currentTime = 0) {
    if (!data) return;

    const cx = w / 2;
    const cy = h / 2;
    const baseSize = Math.min(w, h) * 0.28;

    const bands = [
        { name: 'sub-bass',  start: 0,    end: 0.02 },
        { name: 'bass',      start: 0.02, end: 0.08 },
        { name: 'low-mid',   start: 0.08, end: 0.15 },
        { name: 'mid',       start: 0.15, end: 0.35 },
        { name: 'high-mid',  start: 0.35, end: 0.55 },
        { name: 'presence',  start: 0.55, end: 0.75 },
        { name: 'brilliance',start: 0.75, end: 1.00 },
    ];
    const bandCount = bands.length;
    const beatThreshold = 0.35;

    const bandEnergies = bands.map(band => {
        const s = Math.floor(band.start * data.length);
        const e = Math.max(s + 2, Math.floor(band.end * data.length));
        let sum = 0;
        for (let i = s; i < e; i++) sum += data[i];
        return sum / ((e - s) * 255);
    });

    // Heart pulse state
    if (this._heartScale === undefined) this._heartScale = 1.0;
    if (this._heartTarget === undefined) this._heartTarget = 1.0;
    if (this._heartGlow === undefined) this._heartGlow = 0;
    if (this._lastBeatIndex === undefined) this._lastBeatIndex = -1;

    // ✅ Heart pulses on beat markers when available
    if (beats.length > 0 && currentTime > 0) {
        let currentBeatIdx = -1;
        for (let i = beats.length - 1; i >= 0; i--) {
            if (currentTime >= beats[i].time - 0.02) { currentBeatIdx = i; break; }
        }
        if (currentBeatIdx > this._lastBeatIndex && currentBeatIdx >= 0) {
            const beat = beats[currentBeatIdx];
            const strength = Math.min(1.0, (beat.strength || 0.5) * 1.5);
            this._heartTarget = 1.0 + 0.10 + strength * 0.20;
            this._heartGlow = 0.4 + strength * 0.6;
            this._lastBeatIndex = currentBeatIdx;
        }
        if (currentTime < 0.1 && this._lastBeatIndex > 0) this._lastBeatIndex = -1;
    } else {
        // Fallback: raw bass energy when no beats detected yet
        const bassEnd = Math.max(4, Math.floor(data.length * 0.08));
        let bassEnergy = 0;
        for (let i = 0; i < bassEnd; i++) bassEnergy += data[i];
        bassEnergy /= (bassEnd * 255);
        if (this._heartLastBeat === undefined) this._heartLastBeat = 0;
        const now = performance.now() / 1000;
        if (bassEnergy > beatThreshold && (now - this._heartLastBeat) > 0.12) {
            const strength = Math.min(1.0, (bassEnergy - beatThreshold) / (0.8 - beatThreshold));
            this._heartTarget = 1.0 + 0.12 + strength * 0.18;
            this._heartGlow = 0.5 + strength * 0.5;
            this._heartLastBeat = now;
        }
    }

    this._heartScale += (this._heartTarget - this._heartScale) * 0.25;
    this._heartTarget += (1.0 - this._heartTarget) * 0.08;
    this._heartGlow *= 0.92;

    // Per-band smoothed spectrum spikes
    const spikesPerBand = 12;
    if (!this._bandSpikes) {
        this._bandSpikes = [];
        for (let b = 0; b < bandCount; b++) {
            this._bandSpikes.push(new Float32Array(spikesPerBand));
        }
    }

    for (let b = 0; b < bandCount; b++) {
        const band = bands[b];
        const s = Math.floor(band.start * data.length);
        const e = Math.max(s + 2, Math.floor(band.end * data.length));
        const bandLen = e - s;

        for (let sp = 0; sp < spikesPerBand; sp++) {
            const freqIdx = s + Math.floor((sp / spikesPerBand) * bandLen);
            const rawV = data[freqIdx] / 255;
            const rate = rawV > this._bandSpikes[b][sp] ? 0.45 : 0.08;
            this._bandSpikes[b][sp] += (rawV - this._bandSpikes[b][sp]) * rate;
        }
    }

    // ✅ EKG pattern with random dip variation
    const makeEKGPattern = () => {
        const dipDepth = -(0.15 + Math.random() * 0.30);
        const dipWidth = 0.04 + Math.random() * 0.04;
        const returnSpeed = 0.04 + Math.random() * 0.06;
        return [
            { t: 0.00, v: 0 }, { t: 0.35, v: 0 },
            { t: 0.40, v: -0.08 }, { t: 0.45, v: 1.0 },
            { t: 0.45 + dipWidth, v: dipDepth },
            { t: 0.45 + dipWidth + returnSpeed, v: 0 },
            { t: 1.00, v: 0 },
        ];
    };

    // ✅ sampleEKG takes pattern + t
    const sampleEKG = (pattern, t) => {
        t = Math.max(0, Math.min(1, t));
        for (let i = 0; i < pattern.length - 1; i++) {
            const a = pattern[i], b = pattern[i + 1];
            if (t >= a.t && t <= b.t) {
                const localT = (t - a.t) / (b.t - a.t);
                const smooth = localT * localT * (3 - 2 * localT);
                return a.v + (b.v - a.v) * smooth;
            }
        }
        return 0;
    };

    if (!this._ekgBandBursts) this._ekgBandBursts = bands.map(() => null);
    if (!this._ekgBandLastBeat) this._ekgBandLastBeat = new Float32Array(bandCount);

    const now = performance.now() / 1000;
    const ekgDuration = 0.35;

    for (let b = 0; b < bandCount; b++) {
        const energy = bandEnergies[b];
        const zoneCenter = (b + 0.5) / bandCount;
        if (energy > beatThreshold && (now - this._ekgBandLastBeat[b]) > 0.12) {
            const volIntensity = Math.min(1.0, (energy - beatThreshold) / (0.8 - beatThreshold));
            this._ekgBandBursts[b] = {
                startTime: now, centerX: zoneCenter,
                intensity: 0.3 + volIntensity * 0.7, phase: 0,
                peakVol: energy, pattern: makeEKGPattern(),
            };
            this._ekgBandLastBeat[b] = now;
        }
        const burst = this._ekgBandBursts[b];
        if (burst) {
            burst.phase += (1 / 60) / ekgDuration;
            if (burst.phase < 0.45 && energy > burst.peakVol) {
                burst.peakVol = energy;
                burst.intensity = Math.min(1.0, 0.3 + ((energy - beatThreshold) / (0.8 - beatThreshold)) * 0.7);
            }
            if (burst.phase >= 1.0) this._ekgBandBursts[b] = null;
        }
    }

    // Draw heart outline — primary color
    const drawHeart = (scale, alpha) => {
        const s = baseSize * scale;
        ctx.beginPath();
        const steps = 200;
        for (let i = 0; i <= steps; i++) {
            const t = (i / steps) * Math.PI * 2;
            const hx = 16 * Math.pow(Math.sin(t), 3);
            const hy = -(13 * Math.cos(t) - 5 * Math.cos(2*t) - 2 * Math.cos(3*t) - Math.cos(4*t));
            const x = cx + hx * (s / 17);
            const y = cy + hy * (s / 17) - s * 0.05;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.closePath();

        ctx.strokeStyle = this._color(0.06 * alpha, 0);
        ctx.lineWidth = 8;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();

        ctx.strokeStyle = this._color(0.2 * alpha, 0);
        ctx.lineWidth = 3;
        ctx.stroke();

        ctx.strokeStyle = this._color(0.85 * alpha, 0);
        ctx.lineWidth = 1.5;
        ctx.stroke();
    };

    drawHeart(this._heartScale, 1.0);

    if (this._heartGlow > 0.05) {
        drawHeart(this._heartScale * 1.02, this._heartGlow);
    }

    if (this._heartGlow > 0.05) {
        const glowR = baseSize * this._heartScale * 0.8;
        const gradient = ctx.createRadialGradient(cx, cy - baseSize * 0.05, 0, cx, cy - baseSize * 0.05, glowR);
        gradient.addColorStop(0, this._color(this._heartGlow * 0.12, 0));
        gradient.addColorStop(0.5, this._color(this._heartGlow * 0.06, 0.5));
        gradient.addColorStop(1, 'transparent');
        ctx.fillStyle = gradient;
        ctx.fillRect(cx - glowR, cy - glowR, glowR * 2, glowR * 2);
    }

    // EKG line with grass spikes — secondary color
    const ekgY = cy;
    const ekgMaxSpike = baseSize * 0.5;
    const burstWidth = 0.11;
    const ekgPoints = 800;
    const spikeMaxHeight = ekgMaxSpike * 0.4;

    ctx.beginPath();
    for (let i = 0; i <= ekgPoints; i++) {
        const t = i / ekgPoints;
        const x = t * w;
        let y = ekgY;

        const bandIdx = Math.min(bandCount - 1, Math.floor(t * bandCount));
        const zoneStart = bandIdx / bandCount;
        const zoneWidth = 1.0 / bandCount;
        const zoneT = (t - zoneStart) / zoneWidth;

        const spikeAreaRatio = 0.85;
        const spikeZoneStart = (1 - spikeAreaRatio) / 2;
        const spikeZoneEnd = spikeZoneStart + spikeAreaRatio;

        if (zoneT >= spikeZoneStart && zoneT <= spikeZoneEnd) {
            const spikeT = (zoneT - spikeZoneStart) / spikeAreaRatio;

            const rawIdx = spikeT * spikesPerBand;
            const idx = Math.floor(rawIdx);
            const frac = rawIdx - idx;

            const clampedIdx = Math.min(spikesPerBand - 1, Math.max(0, idx));
            const v = this._bandSpikes[bandIdx][clampedIdx] || 0;

            // Direction based on frequency — low freq up, high freq down
            const freqPosition = (bandIdx + clampedIdx / spikesPerBand) / bandCount;
            const dir = freqPosition < 0.5 ? 1 : -1;

            const triangle = frac < 0.5 ? frac * 2 : (1 - frac) * 2;

            y = ekgY - v * spikeMaxHeight * triangle * dir;
        }

        // EKG burst on top
        const burst = this._ekgBandBursts[bandIdx];
        if (burst) {
            const distFromCenter = Math.abs(t - burst.centerX);
            if (distFromCenter < burstWidth / 2) {
                const burstT = (t - (burst.centerX - burstWidth / 2)) / burstWidth;
                const ekgVal = sampleEKG(burst.pattern, burstT);
                let fadeOut = 1;
                if (burst.phase > 0.65) {
                    const fadeT = (burst.phase - 0.65) / 0.35;
                    fadeOut = 1 - fadeT * fadeT * (3 - 2 * fadeT);
                }
                let fadeIn = 1;
                if (burst.phase < 0.10) {
                    const fadeT = burst.phase / 0.10;
                    fadeIn = fadeT * fadeT * (3 - 2 * fadeT);
                }
                y -= ekgVal * ekgMaxSpike * burst.intensity * fadeOut * fadeIn;
            }
        }

        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }

    ctx.strokeStyle = this._color(0.06, 1);
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    ctx.strokeStyle = this._color(0.25, 1);
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.strokeStyle = this._color(0.8, 1);
    ctx.lineWidth = 0.8;
    ctx.stroke();
}

/** Get the primary color as {r, g, b} */
_getColorRGB(hex) {
    hex = hex || this.primaryColor || '#ffffff';
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return { r, g, b };
}

/**
 * Get color string with alpha.
 * @param {number} alpha - Opacity 0-1
 * @param {number} t - Position 0-1 for gradient (0 = primary, 1 = secondary)
 */
_color(alpha, t = 0) {
    if (this.colorMode === 'rainbow' || this.colorMode === 'beat') {
        const hue = ((performance.now() / 20) + t * 120) % 360;
        return `hsla(${hue}, ${this.saturation}%, ${this.lightness}%, ${alpha})`;
    }

    if (this.colorMode === 'gradient') {
        // Interpolate between primary and secondary based on t
        const c1 = this._getColorRGB(this.primaryColor);
        const c2 = this._getColorRGB(this.secondaryColor);
        const r = Math.round(c1.r + (c2.r - c1.r) * t);
        const g = Math.round(c1.g + (c2.g - c1.g) * t);
        const b = Math.round(c1.b + (c2.b - c1.b) * t);
        return `rgba(${r},${g},${b},${alpha})`;
    }

    // Solid mode
    const { r, g, b } = this._getColorRGB(this.primaryColor);
    return `rgba(${r},${g},${b},${alpha})`;
}

=======
>>>>>>> 19717f61a1c6a5717e9bb45bc5cd69e5480cd4a4
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
