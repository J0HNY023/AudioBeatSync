/**
 * Waveform renderer with zoom and pan support.
 * Zoom: mouse wheel or programmatic
 * Pan: click-drag when zoomed in
 */
export class WaveformRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.width = 0;
        this.height = 0;

        // Zoom state
        this.zoomLevel = 1.0;       // 1.0 = full view, 2.0 = 2x zoom, etc.
        this.maxZoom = 50.0;
        this.minZoom = 1.0;
        this.panOffset = 0.0;       // 0.0 to 1.0 — position of left edge in normalized time
        this.isPanning = false;
        this._panStartX = 0;
        this._panStartOffset = 0;

        this._bindZoomEvents();
    }

    _bindZoomEvents() {
        // Mouse wheel zoom
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const rect = this.canvas.getBoundingClientRect();
            const mouseX = (e.clientX - rect.left) / rect.width;

            // Calculate the time position under the mouse before zoom
            const timeBefore = this.panOffset + mouseX / this.zoomLevel;

            // Adjust zoom
            const delta = e.deltaY > 0 ? 0.85 : 1.18;
            const newZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoomLevel * delta));

            // Adjust pan so the point under the mouse stays fixed
            const newPan = timeBefore - mouseX / newZoom;
            this.zoomLevel = newZoom;
            this.panOffset = Math.max(0, Math.min(1 - 1 / this.zoomLevel, newPan));

            this._onZoomChange?.();
        }, { passive: false });

        // Pan with middle-click or shift+drag
        this.canvas.addEventListener('mousedown', (e) => {
            if (this.zoomLevel <= 1.0) return;
            if (e.button === 1 || e.shiftKey) { // Middle click or shift+left click
                e.preventDefault();
                this.isPanning = true;
                this._panStartX = e.clientX;
                this._panStartOffset = this.panOffset;
                this.canvas.style.cursor = 'grabbing';
            }
        });

        window.addEventListener('mousemove', (e) => {
            if (!this.isPanning) return;
            const rect = this.canvas.getBoundingClientRect();
            const dx = (e.clientX - this._panStartX) / rect.width;
            this.panOffset = Math.max(0, Math.min(
                1 - 1 / this.zoomLevel,
                this._panStartOffset - dx / this.zoomLevel
            ));
            this._onZoomChange?.();
        });

        window.addEventListener('mouseup', () => {
            if (this.isPanning) {
                this.isPanning = false;
                this.canvas.style.cursor = '';
            }
        });
    }

    /** Get the visible time range [start, end] as fractions 0-1 */
    getVisibleRange() {
        const start = this.panOffset;
        const end = Math.min(1, this.panOffset + 1 / this.zoomLevel);
        return { start, end };
    }

    /** Set zoom programmatically (e.g. from UI slider) */
    setZoom(level, centerFraction = 0.5) {
        const newZoom = Math.max(this.minZoom, Math.min(this.maxZoom, level));
        const timeAtCenter = this.panOffset + centerFraction / this.zoomLevel;
        this.zoomLevel = newZoom;
        this.panOffset = Math.max(0, Math.min(1 - 1 / this.zoomLevel, timeAtCenter - 0.5 / newZoom));
        this._onZoomChange?.();
    }

    resetZoom() {
        this.zoomLevel = 1.0;
        this.panOffset = 0.0;
        this._onZoomChange?.();
    }

    /** Scroll to show a specific time fraction in the center */
    scrollTo(fraction) {
        if (this.zoomLevel <= 1.0) return;
        this.panOffset = Math.max(0, Math.min(
            1 - 1 / this.zoomLevel,
            fraction - 0.5 / this.zoomLevel
        ));
        this._onZoomChange?.();
    }

    resize(displayWidth, displayHeight) {
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = Math.round(displayWidth * dpr);
        this.canvas.height = Math.round(displayHeight * dpr);
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.width = displayWidth;
        this.height = displayHeight;
    }

    draw(audioData, beats = [], duration) {
        const { ctx, width: w, height: h, zoomLevel, panOffset } = this;
        if (!audioData || !duration) return;

        const step = Math.max(1, Math.ceil(audioData.length / (w * zoomLevel)));

        // Visible sample range
        const startSample = Math.floor(panOffset * audioData.length);
        const endSample = Math.min(audioData.length, Math.floor((panOffset + 1 / zoomLevel) * audioData.length));
        const visibleSamples = endSample - startSample;

        // Clear
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, w, h);

        // Center line
        ctx.strokeStyle = '#222';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();

        // Waveform — only draw visible portion
        ctx.strokeStyle = 'rgba(0,212,255,0.85)';
        ctx.lineWidth = zoomLevel > 5 ? 1.5 : 1;
        ctx.beginPath();

        for (let i = 0; i < w; i++) {
            let mn = 1, mx = -1;
            const sampleStart = startSample + Math.floor((i / w) * visibleSamples);
            const sampleEnd = startSample + Math.floor(((i + 1) / w) * visibleSamples);
            for (let j = sampleStart; j < sampleEnd; j++) {
                const v = audioData[j] || 0;
                if (v < mn) mn = v;
                if (v > mx) mx = v;
            }
            ctx.lineTo(i, ((1 + mn) / 2) * h);
            ctx.lineTo(i, ((1 + mx) / 2) * h);
        }
        ctx.stroke();

        // Beat markers — only draw visible ones
        const visStart = panOffset * duration;
        const visEnd = (panOffset + 1 / zoomLevel) * duration;

        beats.forEach(beat => {
            if (beat.time < visStart || beat.time > visEnd) return;
            const normalizedTime = (beat.time - visStart) / (visEnd - visStart);
            const x = normalizedTime * w;

            ctx.strokeStyle = 'rgba(0,255,136,0.9)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();

            ctx.fillStyle = '#00ff88';
            ctx.beginPath();
            ctx.moveTo(x, 2);
            ctx.lineTo(x + 4, 8);
            ctx.lineTo(x, 14);
            ctx.lineTo(x - 4, 8);
            ctx.closePath();
            ctx.fill();
        });

        // Zoom indicator
        if (zoomLevel > 1.0) {
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.fillRect(w - 90, 4, 86, 22);
            ctx.fillStyle = '#00d4ff';
            ctx.font = '11px monospace';
            ctx.textAlign = 'right';
            ctx.fillText(`${zoomLevel.toFixed(1)}x zoom`, w - 8, 18);
            ctx.textAlign = 'left';
        }
    }

        /**
     * Draw multiple audio layers as overlaid waveforms with different colors.
     * @param {Array} layers - [{data: Float32Array, color: string, name: string, isCore: boolean}]
     * @param {number} duration - total duration in seconds
     * @param {Array} beats - beat markers
     */
    drawLayers(layers, duration, beats = []) {
        const { ctx, width: w, height: h, zoomLevel, panOffset } = this;
        if (!layers.length || !duration) return;

        const startFrac = panOffset;
        const endFrac = Math.min(1, panOffset + 1 / zoomLevel);

        // Clear
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, w, h);

        // Center line
        ctx.strokeStyle = '#222';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();

        // Draw each layer
        const layerColors = [
            'rgba(0,212,255,0.8)',   // Cyan (core)
            'rgba(255,51,102,0.6)',  // Pink
            'rgba(0,255,136,0.6)',   // Green
            'rgba(255,204,0,0.6)',   // Yellow
            'rgba(180,100,255,0.6)', // Purple
            'rgba(255,140,0,0.6)',   // Orange
        ];

        // Draw non-core layers first (behind), core layer last (on top)
        const sorted = [...layers].sort((a, b) => (a.isCore ? 1 : 0) - (b.isCore ? 1 : 0));

        sorted.forEach((layer, idx) => {
            if (!layer.data) return;

            const color = layer.isCore ? 'rgba(0,212,255,0.9)' : layerColors[idx % layerColors.length];
            const step = Math.max(1, Math.ceil(layer.data.length / (w * zoomLevel)));

            const startSample = Math.floor(startFrac * layer.data.length);
            const endSample = Math.min(layer.data.length, Math.floor(endFrac * layer.data.length));
            const visibleSamples = endSample - startSample;

            ctx.strokeStyle = color;
            ctx.lineWidth = layer.isCore ? 1.5 : 1;
            ctx.globalAlpha = layer.isCore ? 1.0 : 0.7;
            ctx.beginPath();

            for (let i = 0; i < w; i++) {
                let mn = 1, mx = -1;
                const sStart = startSample + Math.floor((i / w) * visibleSamples);
                const sEnd = startSample + Math.floor(((i + 1) / w) * visibleSamples);
                for (let j = sStart; j < sEnd; j += step) {
                    const v = layer.data[j] || 0;
                    if (v < mn) mn = v;
                    if (v > mx) mx = v;
                }
                ctx.lineTo(i, ((1 + mn) / 2) * h);
                ctx.lineTo(i, ((1 + mx) / 2) * h);
            }
            ctx.stroke();
            ctx.globalAlpha = 1.0;
        });

        // Beat markers — only draw visible ones
        const visStart = startFrac * duration;
        const visEnd = endFrac * duration;

        beats.forEach(beat => {
            if (beat.time < visStart || beat.time > visEnd) return;
            const normalizedTime = (beat.time - visStart) / (visEnd - visStart);
            const x = normalizedTime * w;

            ctx.strokeStyle = 'rgba(0,255,136,0.9)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();

            ctx.fillStyle = '#00ff88';
            ctx.beginPath();
            ctx.moveTo(x, 2);
            ctx.lineTo(x + 4, 8);
            ctx.lineTo(x, 14);
            ctx.lineTo(x - 4, 8);
            ctx.closePath();
            ctx.fill();
        });

        // Zoom indicator
        if (zoomLevel > 1.0) {
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.fillRect(w - 90, 4, 86, 22);
            ctx.fillStyle = '#00d4ff';
            ctx.font = '11px monospace';
            ctx.textAlign = 'right';
            ctx.fillText(`${zoomLevel.toFixed(1)}x zoom`, w - 8, 18);
            ctx.textAlign = 'left';
        }

        // Layer legend (when multiple layers)
        if (layers.length > 1) {
            const legendY = h - 16;
            ctx.font = '10px sans-serif';
            let legendX = 8;
            sorted.forEach((layer, idx) => {
                const color = layer.isCore ? '#00d4ff' : layerColors[idx % layerColors.length];
                ctx.fillStyle = color;
                ctx.fillRect(legendX, legendY, 8, 8);
                ctx.fillStyle = '#aaa';
                ctx.textAlign = 'left';
                const label = (layer.name || `Track ${idx + 1}`).substring(0, 12);
                ctx.fillText(label + (layer.isCore ? ' ★' : ''), legendX + 12, legendY + 8);
                legendX += ctx.measureText(label + ' ★').width + 24;
            });
        }
    }

    // Callback hook — App.js sets this to trigger redraw on zoom/pan
    _onZoomChange = null;
}