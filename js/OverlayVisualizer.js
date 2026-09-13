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
        this.mode = 'beatingHeart';
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

        // ECG Cluster settings
        this.ecgHeight = 0.35;       // 0.1 - 0.5 (percentage of canvas height)
        this.ecgSpacing = 0.25;      // 0.1 - 0.5 (spacing between spikes as fraction of width)
        this.ecgVertices = 500;      // 200 - 1000 (detail level)
        this.ecgTraces = 4;          // 1 - 8 (number of overlapping traces)
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

    // ECG Cluster setters
    setECGHeight(v) { this.ecgHeight = Math.max(0.1, Math.min(0.5, v)); }
    setECGSpacing(v) { this.ecgSpacing = Math.max(0.1, Math.min(0.5, v)); }
    setECGVertices(v) { this.ecgVertices = Math.max(200, Math.min(1000, Math.round(v))); }
    setECGTraces(v) { this.ecgTraces = Math.max(1, Math.min(8, Math.round(v))); }

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
                const ekgVal = sampleEKG(localT);
                
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