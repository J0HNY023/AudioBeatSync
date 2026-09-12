/**
 * Renders a real-time FFT visualizer onto a canvas that overlays the media panel.
 * Supports transform controls: position, scale, rotation, opacity, blend mode.
 */
export class OverlayVisualizer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.width = 0;
        this.height = 0;
        this.mode = 'grassHeart';
        this.particles = [];

        // Transform state
        this.opacity = 0.7;
        this.blendMode = 'screen';
        this.scaleX = 1.0;
        this.scaleY = 1.0;
        this.offsetX = 0;   // percentage -50 to 50
        this.offsetY = 0;
        this.rotation = 0;  // degrees
        this.enabled = true;

                // ✅ Color settings
        this.colorMode = 'rainbow';    // 'rainbow' | 'solid' | 'gradient' | 'beat'
        this.primaryColor = '#00d4ff'; // Solid/gradient start
        this.secondaryColor = '#ff3366'; // Gradient end
        this.saturation = 100;         // 0-100
        this.lightness = 55;           // 20-80

        this.vizSyncBand = 'bass';
    }

    resize(displayWidth, displayHeight) {
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = Math.round(displayWidth * dpr);
        this.canvas.height = Math.round(displayHeight * dpr);
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.width = displayWidth;
        this.height = displayHeight;
    }
        // Add setter:
    setVizSyncBand(band) { this.vizSyncBand = band; }

    setMode(mode) { this.mode = mode; this.particles = []; }
    setOpacity(v) { this.opacity = Math.max(0, Math.min(1, v)); }
    setBlendMode(m) { this.blendMode = m; }
    setScale(x, y) { this.scaleX = x; this.scaleY = y; }
    setOffset(x, y) { this.offsetX = x; this.offsetY = y; }
    setRotation(deg) { this.rotation = deg; }
    setEnabled(v) { this.enabled = v; this.canvas.style.display = v ? 'block' : 'none'; }

        // ✅ Color setters
    setColorMode(m) { this.colorMode = m; }
    setPrimaryColor(c) { this.primaryColor = c; }
    setSecondaryColor(c) { this.secondaryColor = c; }
    setSaturation(v) { this.saturation = Math.max(0, Math.min(100, v)); }
    setLightness(v) { this.lightness = Math.max(20, Math.min(80, v)); }

    /**
     * Get color for a bar/element based on current color mode.
     * @param {number} index - bar index
     * @param {number} total - total bars
     * @param {number} value - 0-1 amplitude
     * @returns {string} CSS color string
     */

    /**
     * Get the frequency data slice for the current viz sync band.
     * Returns { data: Uint8Array subset, energy: 0-1 normalized average }
     */
    _getSyncData(fullData) {
        if (!fullData) return { slice: null, energy: 0 };

        const len = fullData.length;
        let start = 0, end = len;

        switch (this.vizSyncBand) {
            case 'sub-bass':  start = 0;             end = Math.floor(len * 0.02); break;  // ~20-60Hz
            case 'bass':      start = 0;             end = Math.floor(len * 0.08); break;  // ~60-250Hz
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
    _getColor(index, total, value) {
        const s = this.saturation;
        const l = this.lightness;

        switch (this.colorMode) {
            case 'solid':
                return this.primaryColor;

            case 'gradient': {
                // Interpolate between primary and secondary
                const t = index / total;
                return this._lerpColor(this.primaryColor, this.secondaryColor, t);
            }

            case 'beat': {
                // Brightness scales with amplitude
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

    /** Linear interpolate between two hex colors */
    _lerpColor(a, b, t) {
        const ar = parseInt(a.slice(1, 3), 16), ag = parseInt(a.slice(3, 5), 16), ab = parseInt(a.slice(5, 7), 16);
        const br = parseInt(b.slice(1, 3), 16), bg = parseInt(b.slice(3, 5), 16), bb = parseInt(b.slice(5, 7), 16);
        const r = Math.round(ar + (br - ar) * t);
        const g = Math.round(ag + (bg - ag) * t);
        const bl = Math.round(ab + (bb - ab) * t);
        return `rgb(${r},${g},${bl})`;
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
            case 'grassHeart':     this._drawGrassHeart(ctx, freqData, w, h, beats, currentTime); break;
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
},

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

    // Trigger on strong bass hit
    if (bassEnergy > beatThreshold && (now - this._ekgLastBeat) > minBeatInterval) {
        this._ekgBurst = {
            startTime: now,
            phase: 0,
            intensity: Math.min(1.0, 0.5 + (bassEnergy - beatThreshold) * 1.5),
        };
        this._ekgLastBeat = now;
    }

    // Update burst animation
    if (this._ekgBurst) {
        this._ekgBurst.phase += (1 / 60) / ekgDuration;
        if (this._ekgBurst.phase >= 1.0) {
            this._ekgBurst = null;
        }
    }

    // Draw the EKG line with sharp QRS complex (spike up, spike down)
    ctx.beginPath();
    for (let i = 0; i <= points; i++) {
        const t = i / points;
        const x = t * w;
        let y = midY;

        if (this._ekgBurst) {
            const burstPos = this._ekgBurst.phase;
            const burstWidth = 0.12;
            
            const distFromBurst = Math.abs(t - burstPos);
            if (distFromBurst < burstWidth / 2) {
                const localT = (t - (burstPos - burstWidth / 2)) / burstWidth;
                
                // Sharp QRS Complex: Quick dip, SHARP SPIKE UP, SHARP SPIKE DOWN
                let ekgVal = 0;
                
                // Q dip (small down)
                if (localT >= 0.2 && localT < 0.3) {
                    ekgVal = -0.15 * ((localT - 0.2) / 0.1);
                }
                // R spike (SHARP UP - main peak)
                else if (localT >= 0.3 && localT < 0.5) {
                    const spikeT = (localT - 0.3) / 0.2;
                    // Sharp triangular spike
                    ekgVal = spikeT < 0.5 
                        ? spikeT * 2 * 1.0 
                        : (1 - spikeT) * 2 * 1.0;
                }
                // S spike (SHARP DOWN - main trough)
                else if (localT >= 0.5 && localT < 0.7) {
                    const spikeT = (localT - 0.5) / 0.2;
                    // Sharp triangular spike downward
                    ekgVal = spikeT < 0.5 
                        ? spikeT * 2 * -0.8 
                        : (1 - spikeT) * 2 * -0.8;
                }
                
                // Fade at edges
                let fade = 1;
                const edgeFade = distFromBurst / (burstWidth / 2);
                if (edgeFade > 0.7) {
                    fade = (1 - edgeFade) * 3.33;
                }
                
                y = midY - ekgVal * maxSpike * this._ekgBurst.intensity * fade;
            }
        }

        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }

    // Multi-layer stroke for glow effect - RED color
    ctx.strokeStyle = 'rgba(255,50,50,0.08)';
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,50,50,0.3)';
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,220,220,0.95)';
    ctx.lineWidth = 2;
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
},

/**\n * Grass Heart Visualizer - A beating heart surrounded by reactive grass\n * The heart pulses with the bass, and grass blades react to frequency bands\n */\n_drawGrassHeart(ctx, data, w, h, beats = [], currentTime = 0) {\n    if (!data) return;\n\n    const cx = w / 2;\n    const cy = h / 2 + h * 0.1; // Position heart slightly lower for grass\n    const baseSize = Math.min(w, h) * 0.22;\n\n    // Calculate bass energy for heart pulse\n    const bassEnd = Math.max(4, Math.floor(data.length * 0.08));\n    let bassEnergy = 0;\n    for (let i = 0; i < bassEnd; i++) bassEnergy += data[i];\n    bassEnergy /= (bassEnd * 255);\n\n    const beatThreshold = 0.35;\n\n    // Heart pulse state\n    if (this._grassHeartScale === undefined) this._grassHeartScale = 1.0;\n    if (this._grassHeartTarget === undefined) this._grassHeartTarget = 1.0;\n    if (this._grassHeartGlow === undefined) this._grassHeartGlow = 0;\n\n    // Handle beat detection\n    if (beats.length > 0 && currentTime > 0) {\n        if (this._grassLastBeatIdx === undefined) this._grassLastBeatIdx = -1;\n        let currentBeatIdx = -1;\n        for (let i = beats.length - 1; i >= 0; i--) {\n            if (currentTime >= beats[i].time - 0.02) { currentBeatIdx = i; break; }\n        }\n        if (currentBeatIdx > this._grassLastBeatIdx && currentBeatIdx >= 0) {\n            const beat = beats[currentBeatIdx];\n            const strength = Math.min(1.0, (beat.strength || 0.5) * 1.5);\n            this._grassHeartTarget = 1.0 + 0.08 + strength * 0.15;\n            this._grassHeartGlow = 0.5 + strength * 0.5;\n            this._grassLastBeatIdx = currentBeatIdx;\n        }\n        if (currentTime < 0.1 && this._grassLastBeatIdx > 0) this._grassLastBeatIdx = -1;\n    } else {\n        // Fallback: raw bass energy\n        if (this._grassHeartLastBeat === undefined) this._grassHeartLastBeat = 0;\n        const now = performance.now() / 1000;\n        if (bassEnergy > beatThreshold && (now - this._grassHeartLastBeat) > 0.15) {\n            const strength = Math.min(1.0, (bassEnergy - beatThreshold) / (0.8 - beatThreshold));\n            this._grassHeartTarget = 1.0 + 0.10 + strength * 0.12;\n            this._grassHeartGlow = 0.4 + strength * 0.4;\n            this._grassHeartLastBeat = now;\n        }\n    }\n\n    // Smooth heart animation\n    this._grassHeartScale += (this._grassHeartTarget - this._grassHeartScale) * 0.2;\n    this._grassHeartTarget += (1.0 - this._grassHeartTarget) * 0.06;\n    this._grassHeartGlow *= 0.90;\n\n    // Initialize grass if needed\n    const grassBladeCount = 80;\n    if (!this._grassBlades || this._grassBlades.length !== grassBladeCount) {\n        this._grassBlades = [];\n        for (let i = 0; i < grassBladeCount; i++) {\n            this._grassBlades.push({\n                x: (i / grassBladeCount) * w,\n                height: 20 + Math.random() * 30,\n                swayOffset: Math.random() * Math.PI * 2,\n                swaySpeed: 0.5 + Math.random() * 1.5,\n                thickness: 1.5 + Math.random() * 2,\n                curve: (Math.random() - 0.5) * 0.3,\n            });\n        }\n    }\n\n    // Get frequency data for grass reaction\n    const freqForGrass = [];\n    const grassBands = 24;\n    for (let i = 0; i < grassBands; i++) {\n        const idx = Math.floor((i / grassBands) * data.length * 0.5);\n        freqForGrass.push(data[idx] / 255);\n    }\n\n    // Draw grass blades\n    const groundY = cy + baseSize * 0.9;\n    const time = performance.now() * 0.001;\n\n    for (let i = 0; i < this._grassBlades.length; i++) {\n        const blade = this._grassBlades[i];\n        const freqIdx = Math.floor((i / this._grassBlades.length) * freqForGrass.length);\n        const freqValue = freqForGrass[freqIdx] || 0;\n\n        // Grass reacts to audio - taller and more swaying with higher frequencies\n        const audioHeightMult = 1 + freqValue * 1.5;\n        const currentHeight = blade.height * audioHeightMult;\n        const swayAmount = 0.15 + freqValue * 0.3;\n        const sway = Math.sin(time * blade.swaySpeed + blade.swayOffset) * swayAmount;\n\n        const x = blade.x;\n        const baseX = x + (x - w/2) * 0.02; // Slight perspective\n\n        ctx.beginPath();\n        ctx.moveTo(baseX, groundY);\n\n        // Quadratic curve for natural grass bend\n        const controlX = baseX + sway * currentHeight + blade.curve * currentHeight;\n        const controlY = groundY - currentHeight * 0.5;\n        const tipX = baseX + sway * currentHeight;\n        const tipY = groundY - currentHeight;\n\n        ctx.quadraticCurveTo(controlX, controlY, tipX, tipY);\n\n        // Color based on position and audio\n        const hue = 100 + freqValue * 40; // Green to yellow-green\n        const sat = 60 + freqValue * 30;\n        const light = 35 + freqValue * 25;\n        ctx.strokeStyle = `hsla(${hue}, ${sat}%, ${light}%, ${0.7 + freqValue * 0.3})`;\n        ctx.lineWidth = blade.thickness * (1 + freqValue * 0.5);\n        ctx.lineCap = 'round';\n        ctx.stroke();\n\n        // Add secondary thinner blade for depth\n        ctx.beginPath();\n        ctx.moveTo(baseX + 2, groundY);\n        ctx.quadraticCurveTo(\n            controlX + 1, controlY,\n            tipX + sway * 5, tipY - 5\n        );\n        ctx.strokeStyle = `hsla(${hue}, ${sat}%, ${light - 10}%, ${0.4 + freqValue * 0.2})`;\n        ctx.lineWidth = blade.thickness * 0.5;\n        ctx.stroke();\n    }\n\n    // Draw heart with glow layers\n    const drawHeartShape = (scale, alpha, filled = false) => {\n        const s = baseSize * scale;\n        ctx.beginPath();\n        const steps = 200;\n        for (let i = 0; i <= steps; i++) {\n            const t = (i / steps) * Math.PI * 2;\n            const hx = 16 * Math.pow(Math.sin(t), 3);\n            const hy = -(13 * Math.cos(t) - 5 * Math.cos(2*t) - 2 * Math.cos(3*t) - Math.cos(4*t));\n            const x = cx + hx * (s / 17);\n            const y = cy + hy * (s / 17) - s * 0.05;\n            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);\n        }\n        ctx.closePath();\n\n        if (filled) {\n            ctx.fillStyle = this._color(alpha, 0);\n            ctx.fill();\n        } else {\n            ctx.strokeStyle = this._color(alpha, 0);\n            ctx.lineWidth = 6;\n            ctx.lineCap = 'round';\n            ctx.lineJoin = 'round';\n            ctx.stroke();\n\n            ctx.strokeStyle = this._color(alpha * 0.5, 0);\n            ctx.lineWidth = 2;\n            ctx.stroke();\n\n            ctx.strokeStyle = this._color(alpha * 0.9, 0);\n            ctx.lineWidth = 1;\n            ctx.stroke();\n        }\n    };\n\n    // Heart glow behind\n    if (this._grassHeartGlow > 0.05) {\n        const glowR = baseSize * this._grassHeartScale * 0.9;\n        const gradient = ctx.createRadialGradient(\n            cx, cy - baseSize * 0.05, 0,\n            cx, cy - baseSize * 0.05, glowR\n        );\n        gradient.addColorStop(0, this._color(this._grassHeartGlow * 0.15, 0));\n        gradient.addColorStop(0.4, this._color(this._grassHeartGlow * 0.08, 0.5));\n        gradient.addColorStop(1, 'transparent');\n        ctx.fillStyle = gradient;\n        ctx.fillRect(cx - glowR, cy - glowR - baseSize * 0.5, glowR * 2, glowR * 2);\n    }\n\n    // Draw main heart\n    drawHeartShape(this._grassHeartScale, 1.0, false);\n\n    // Subtle inner fill\n    drawHeartShape(this._grassHeartScale * 0.98, 0.15, true);\n\n    // Beat pulse glow\n    if (this._grassHeartGlow > 0.1) {\n        drawHeartShape(this._grassHeartScale * 1.03, this._grassHeartGlow * 0.5, false);\n    }\n\n    // Add sparkling particles around heart on strong beats\n    if (this._grassHeartGlow > 0.4) {\n        if (!this._heartParticles) this._heartParticles = [];\n        \n        // Spawn particles on beat\n        if (this._grassHeartGlow > 0.6 && Math.random() < 0.3) {\n            const angle = Math.random() * Math.PI * 2;\n            const dist = baseSize * 0.6 * this._grassHeartScale;\n            this._heartParticles.push({\n                x: cx + Math.cos(angle) * dist,\n                y: cy + Math.sin(angle) * dist - baseSize * 0.3,\n                vx: (Math.random() - 0.5) * 2,\n                vy: -Math.random() * 3 - 1,\n                life: 1,\n                size: 1 + Math.random() * 2,\n                hue: Math.random() * 60 + 340, // Pink to red sparkles\n            });\n        }\n\n        // Update and draw particles\n        for (let i = this._heartParticles.length - 1; i >= 0; i--) {\n            const p = this._heartParticles[i];\n            p.x += p.vx;\n            p.y += p.vy;\n            p.vy += 0.08; // gravity\n            p.life -= 0.02;\n            p.size *= 0.97;\n\n            if (p.life <= 0 || p.size < 0.3) {\n                this._heartParticles.splice(i, 1);\n                continue;\n            }\n\n            ctx.beginPath();\n            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);\n            ctx.fillStyle = `hsla(${p.hue}, 80%, 60%, ${p.life})`;\n            ctx.fill();\n        }\n\n        // Limit particles\n        if (this._heartParticles.length > 50) {\n            this._heartParticles.splice(0, this._heartParticles.length - 50);\n        }\n    }\n\n    // Add subtle ground shadow under heart\n    const shadowGradient = ctx.createRadialGradient(\n        cx, groundY - 5, 0,\n        cx, groundY - 5, baseSize * 0.6\n    );\n    shadowGradient.addColorStop(0, 'rgba(0, 0, 0, 0.15)');\n    shadowGradient.addColorStop(1, 'transparent');\n    ctx.fillStyle = shadowGradient;\n    ctx.beginPath();\n    ctx.ellipse(cx, groundY - 5, baseSize * 0.6, baseSize * 0.15, 0, 0, Math.PI * 2);\n    ctx.fill();\n},

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

    serialize() {
        return {
            enabled: this.enabled, mode: this.mode, blendMode: this.blendMode,
            opacity: this.opacity, scaleX: this.scaleX, scaleY: this.scaleY,
            offsetX: this.offsetX, offsetY: this.offsetY, rotation: this.rotation,
            colorMode: this.colorMode, primaryColor: this.primaryColor,
            secondaryColor: this.secondaryColor, saturation: this.saturation,
            lightness: this.lightness,
            vizSyncBand: this.vizSyncBand,
        };
    }

    deserialize(o) {
        if (!o) return;
        this.enabled = o.enabled ?? true;
        this.mode = o.mode || 'bars';
        this.blendMode = o.blendMode || 'screen';
        this.opacity = o.opacity ?? 0.7;
        this.scaleX = o.scaleX ?? 1; this.scaleY = o.scaleY ?? 1;
        this.offsetX = o.offsetX ?? 0; this.offsetY = o.offsetY ?? 0;
        this.rotation = o.rotation ?? 0;
        this.colorMode = o.colorMode || 'rainbow';
        this.primaryColor = o.primaryColor || '#00d4ff';
        this.secondaryColor = o.secondaryColor || '#ff3366';
        this.saturation = o.saturation ?? 100;
        this.lightness = o.lightness ?? 55;
        if (o.vizSyncBand) this.vizSyncBand = o.vizSyncBand;
    }

}