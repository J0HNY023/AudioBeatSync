/**
 * Real-time FFT visualizer with multiple modes.
 * Reads frequency/time-domain data each frame — no knowledge of beats or waveform.
 */
export class VisualizerRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.width = 0;
        this.height = 0;
        this.mode = 'bars';
        this.particles = [];
    }

    resize(displayWidth, displayHeight) {
        const dpr = window.devicePixelRatio || 1;
        // Maintain aspect ratio (e.g., 16:9 or square based on container)
        const targetAspect = displayWidth / displayHeight;
        const canvasAspect = 16 / 9; // Default widescreen aspect
        
        let finalWidth = displayWidth;
        let finalHeight = displayHeight;
        
        // If you want to maintain a specific aspect ratio, adjust here
        // For now, we'll keep it filling the container but ensure proper scaling
        this.canvas.width = Math.round(finalWidth * dpr);
        this.canvas.height = Math.round(finalHeight * dpr);
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.width = finalWidth;
        this.height = finalHeight;
    }

    setMode(mode) {
        this.mode = mode;
        this.particles = [];
    }

    render(freqData, timeData, beatFlashAlpha = 0) {
        const { ctx, width: w, height: h } = this;
        if (!freqData) return;

        // Fade trail
        // ✅ Transparent fade trail instead of opaque black
        // This lets the media background show through
        ctx.fillStyle = 'rgba(13,13,13,0.3)';
        ctx.fillRect(0, 0, w, h);

        switch (this.mode) {
            case 'bars':      this._drawBars(ctx, freqData, w, h); break;
            case 'circular':  this._drawCircular(ctx, freqData, w, h); break;
            case 'wave':      this._drawOscilloscope(ctx, timeData, w, h); break;
            case 'particles': this._drawParticles(ctx, freqData, w, h); break;
        }

        // Beat flash overlay
        if (beatFlashAlpha > 0) {
            ctx.fillStyle = `rgba(0,255,136,${beatFlashAlpha})`;
            ctx.fillRect(0, 0, w, h);
        }
    }

    _drawBars(ctx, data, w, h) {
        const barW = (w / data.length) * 2.5;
        const count = Math.floor(data.length * 0.4);
        for (let i = 0; i < count; i++) {
            const v = data[i] / 255;
            const barH = v * h * 0.9;
            const hue = 180 + v * 120;
            ctx.fillStyle = `hsla(${hue},100%,55%,${0.6 + v * 0.4})`;
            ctx.fillRect(i * barW, h - barH, barW - 1, barH);
            ctx.fillStyle = `hsla(${hue},100%,55%,${0.15 + v * 0.1})`;
            ctx.fillRect(i * barW, 0, barW - 1, barH * 0.3);
        }
    }

    _drawCircular(ctx, data, w, h) {
        const cx = w / 2, cy = h / 2, radius = Math.min(w, h) * 0.25;
        const bars = 128;
        for (let i = 0; i < bars; i++) {
            const v = data[i] / 255;
            const angle = (i / bars) * Math.PI * 2 - Math.PI / 2;
            const r2 = radius + v * radius * 1.5;
            ctx.strokeStyle = `hsla(${180 + (i / bars) * 180},100%,55%,${0.5 + v * 0.5})`;
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
            ctx.lineTo(cx + Math.cos(angle) * r2, cy + Math.sin(angle) * r2);
            ctx.stroke();
        }
        const bass = data.slice(0, 8).reduce((a, b) => a + b, 0) / (8 * 255);
        ctx.beginPath();
        ctx.arc(cx, cy, radius * 0.3 + bass * 20, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0,212,255,${0.1 + bass * 0.3})`;
        ctx.fill();
    }

    _drawOscilloscope(ctx, data, w, h) {
        if (!data) return;
        ctx.strokeStyle = '#00d4ff'; ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < data.length; i++) {
            const y = (data[i] / 128.0) * h / 2;
            i === 0 ? ctx.moveTo(0, y) : ctx.lineTo((i / data.length) * w, y);
        }
        ctx.stroke();
        ctx.strokeStyle = 'rgba(0,212,255,0.2)'; ctx.lineWidth = 6;
        ctx.beginPath();
        for (let i = 0; i < data.length; i++) {
            const y = (data[i] / 128.0) * h / 2;
            i === 0 ? ctx.moveTo(0, y) : ctx.lineTo((i / data.length) * w, y);
        }
        ctx.stroke();
    }

    _drawParticles(ctx, data, w, h) {
        const bass = data.slice(0, 16).reduce((a, b) => a + b, 0) / (16 * 255);
        if (bass > 0.6) {
            for (let i = 0; i < 3; i++) {
                this.particles.push({
                    x: w / 2 + (Math.random() - 0.5) * 100,
                    y: h / 2 + (Math.random() - 0.5) * 60,
                    vx: (Math.random() - 0.5) * bass * 12,
                    vy: (Math.random() - 0.5) * bass * 12,
                    life: 1, size: 2 + Math.random() * 4 * bass,
                    hue: 160 + Math.random() * 80,
                });
            }
        }
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.x += p.vx; p.y += p.vy; p.life -= 0.015; p.size *= 0.98;
            if (p.life <= 0) { this.particles.splice(i, 1); continue; }
            ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fillStyle = `hsla(${p.hue},100%,60%,${p.life})`; ctx.fill();
        }
        if (this.particles.length > 500) this.particles.splice(0, this.particles.length - 500);
    }
}