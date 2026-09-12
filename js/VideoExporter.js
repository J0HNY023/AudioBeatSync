/**
 * Records the reactor panel to a downloadable video file.
 * Handles: media + transforms, all CSS filters, canvas effects (fx-overlay),
 * chromatic aberration, glitch overlay, spectrum overlay with blend modes.
 */
export class VideoExporter {
    constructor() {
        this.mediaRecorder = null;
        this.chunks = [];
        this.isRecording = false;
        this.startTime = 0;
        this.duration = 0;
        this.onProgress = null;
        this.onComplete = null;
        this.onError = null;
        this._rafId = null;
        this._fxCanvas = null;
        this._fxCtx = null;
    }

    async start(containerEl, options = {}) {
        const {
            durationSec = 30,
            fps = 30,
            width = 1280,
            height = 720,
            audioStream = null,
        } = options;

        this.chunks = [];
        this.duration = durationSec;
        this.isRecording = true;
        this.startTime = performance.now();

        try {
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');

            const stream = canvas.captureStream(fps);

            if (audioStream) {
                audioStream.getAudioTracks().forEach(track => stream.addTrack(track));
            }

            const mimeType = this._getSupportedMimeType();
            this.mediaRecorder = new MediaRecorder(stream, {
                mimeType,
                videoBitsPerSecond: 5_000_000,
            });

            this.mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) this.chunks.push(e.data);
            };

            this.mediaRecorder.onstop = () => {
                this.isRecording = false;
                cancelAnimationFrame(this._rafId);
                const blob = new Blob(this.chunks, { type: mimeType });
                this.onComplete?.(blob, mimeType);
            };

            this.mediaRecorder.onerror = (e) => {
                this.isRecording = false;
                this.onError?.(`Recording error: ${e.error}`);
            };

            this.mediaRecorder.start(100);
            this._captureLoop(ctx, canvas, containerEl, width, height, durationSec, fps);

            return true;
        } catch (err) {
            this.isRecording = false;
            this.onError?.(`Failed to start recording: ${err.message}`);
            return false;
        }
    }

    _getSupportedMimeType() {
        const types = [
            'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
            'video/mp4;codecs=avc1',
            'video/mp4',
            'video/webm;codecs=vp9,opus',
            'video/webm;codecs=vp9',
            'video/webm',
        ];
        for (const type of types) {
            if (MediaRecorder.isTypeSupported(type)) {
                console.log(`%c🎬 Using codec: ${type}`, 'color:#00d4ff');
                return type;
            }
        }
        return 'video/webm';
    }

        /* ── Main Capture Loop ─────────────────────────── */
    _captureLoop(ctx, canvas, containerEl, w, h, durationSec, fps) {
        if (!this.isRecording) return;

        const elapsed = (performance.now() - this.startTime) / 1000;
        const percent = Math.min(100, (elapsed / durationSec) * 100);
        this.onProgress?.(percent, elapsed);

        if (elapsed >= durationSec) {
            this.stop();
            return;
        }

        // Clear frame
        ctx.fillStyle = '#0d0d0d';
        ctx.fillRect(0, 0, w, h);

        // Query DOM elements
        const mediaEl = containerEl.querySelector('.reactor-media');
        const overlayCanvas = containerEl.querySelector('#overlayCanvas');
        const fxCanvas = containerEl.querySelector('.fx-overlay');
        const caCanvas = containerEl.querySelector('.ca-overlay');

        // ✅ FIX: Check canvas has valid dimensions before drawing
        const fxValid = fxCanvas && fxCanvas.style.display !== 'none' && fxCanvas.width > 0 && fxCanvas.height > 0;
        const caValid = caCanvas && caCanvas.style.display !== 'none' && caCanvas.width > 0 && caCanvas.height > 0;

        if (fxValid) {
            ctx.save();
            ctx.drawImage(fxCanvas, 0, 0, w, h);
            ctx.restore();
        } else if (caValid) {
            ctx.save();
            ctx.drawImage(caCanvas, 0, 0, w, h);
            ctx.restore();
        } else if (mediaEl && mediaEl.style.visibility !== 'hidden') {
            ctx.save();
            this._applyElementTransform(ctx, mediaEl, w, h);
            const filters = this._parseFilters(mediaEl);
            const opacity = parseFloat(mediaEl.style.opacity) || 1;
            const hasEffects = filters.brightness !== 1.0 || filters.invert > 0 ||
                            opacity < 1 || filters.hueRotate !== 0 || filters.contrast !== 1.0;
            if (hasEffects) {
                this._drawWithFilters(ctx, mediaEl, w, h, filters, opacity);
            } else {
                this._drawMediaDirect(ctx, mediaEl, w, h);
            }
            ctx.restore();
        }

        // Glitch overlay — also guard against zero-size
        const glitchCanvas = containerEl.querySelector('.glitch-overlay');
        if (glitchCanvas && glitchCanvas.style.display !== 'none' && !fxValid &&
            glitchCanvas.width > 0 && glitchCanvas.height > 0) {
            ctx.save();
            ctx.globalAlpha = 0.85;
            ctx.drawImage(glitchCanvas, 0, 0, w, h);
            ctx.restore();
        }

        // Spectrum overlay — guard against zero-size
        if (overlayCanvas && overlayCanvas.style.display !== 'none' &&
            overlayCanvas.width > 0 && overlayCanvas.height > 0) {
            ctx.save();
            const opacity = parseFloat(overlayCanvas.style.opacity) || 1;
            ctx.globalAlpha = opacity;
            ctx.globalCompositeOperation = this._cssBlendToCanvas(overlayCanvas.style.mixBlendMode || 'screen');
            this._applyOverlayTransform(ctx, overlayCanvas, w, h);
            ctx.drawImage(overlayCanvas, -w / 2, -h / 2, w, h);
            ctx.restore();
        }

        // Panel glow border
        const boxShadow = containerEl.style.boxShadow;
        if (boxShadow && boxShadow !== 'none') {
            const glowMatch = boxShadow.match(/rgba?\(([^)]+)\)/);
            if (glowMatch) {
                const parts = glowMatch[1].split(',').map(s => parseFloat(s.trim()));
                const [r, g, b, a] = parts;
                ctx.save();
                ctx.shadowColor = `rgba(${r},${g},${b},${a || 1})`;
                ctx.shadowBlur = 30;
                ctx.strokeStyle = `rgba(${r},${g},${b},${(a || 1) * 0.5})`;
                ctx.lineWidth = 4;
                ctx.strokeRect(2, 2, w - 4, h - 4);
                ctx.restore();
            }
        }

        // Schedule next frame
        const frameInterval = 1000 / fps;
        setTimeout(() => {
            this._rafId = requestAnimationFrame(() =>
                this._captureLoop(ctx, canvas, containerEl, w, h, durationSec, fps)
            );
        }, frameInterval);
    }

    /* ── Transform Parsing ─────────────────────────── */
    _applyElementTransform(ctx, el, canvasW, canvasH) {
        const style = getComputedStyle(el);
        const transform = style.transform;

        ctx.translate(canvasW / 2, canvasH / 2);

        if (transform && transform !== 'none') {
            const match = transform.match(/matrix.*\((.+)\)/);
            if (match) {
                const values = match[1].split(',').map(parseFloat);
                if (values.length >= 6) {
                    ctx.transform(values[0], values[1], values[2], values[3], values[4], values[5]);
                }
            }
        }
    }

    _applyOverlayTransform(ctx, canvas, w, h) {
        const style = getComputedStyle(canvas);
        const transform = style.transform;
        ctx.translate(w / 2, h / 2);

        if (transform && transform !== 'none') {
            const match = transform.match(/matrix.*\((.+)\)/);
            if (match) {
                const values = match[1].split(',').map(parseFloat);
                if (values.length >= 6) {
                    ctx.transform(values[0], values[1], values[2], values[3], values[4], values[5]);
                }
            }
        }
    }

    /* ── Filter Parsing ────────────────────────────── */
    // ✅ FIX 3: Now returns hueRotate and contrast
    _parseFilters(el) {
        const filter = el.style.filter || '';
        const result = { brightness: 1.0, invert: 0, hueRotate: 0, contrast: 1.0 };

        const brightMatch = filter.match(/brightness\(([\d.]+)\)/);
        if (brightMatch) result.brightness = parseFloat(brightMatch[1]);

        const invertMatch = filter.match(/invert\((\d+)%\)/);
        if (invertMatch) result.invert = parseInt(invertMatch[1]) / 100;

        const hueMatch = filter.match(/hue-rotate\(([\d.]+)deg\)/);
        if (hueMatch) result.hueRotate = parseFloat(hueMatch[1]);

        const contrastMatch = filter.match(/contrast\(([\d.]+)\)/);
        if (contrastMatch) result.contrast = parseFloat(contrastMatch[1]);

        return result;
    }

    /* ── Media Drawing ─────────────────────────────── */
    _drawMediaDirect(ctx, mediaEl, w, h) {
        if (mediaEl.tagName === 'VIDEO') {
            try { ctx.drawImage(mediaEl, -w / 2, -h / 2, w, h); } catch (_) {}
        } else {
            const imgW = mediaEl.naturalWidth || w;
            const imgH = mediaEl.naturalHeight || h;
            const scale = Math.min(w * 0.9 / imgW, h * 0.9 / imgH);
            const dw = imgW * scale;
            const dh = imgH * scale;
            try { ctx.drawImage(mediaEl, -dw / 2, -dh / 2, dw, dh); } catch (_) {}
        }
    }

    _drawWithFilters(ctx, mediaEl, w, h, filters, opacity) {
        if (!this._fxCanvas) {
            this._fxCanvas = document.createElement('canvas');
            this._fxCtx = this._fxCanvas.getContext('2d', { willReadFrequently: true });
        }

        const oc = this._fxCanvas;
        const octx = this._fxCtx;
        oc.width = w;
        oc.height = h;
        octx.clearRect(0, 0, w, h);

        // Draw base media
        if (mediaEl.tagName === 'VIDEO') {
            try { octx.drawImage(mediaEl, 0, 0, w, h); } catch (_) { return; }
        } else {
            const imgW = mediaEl.naturalWidth || w;
            const imgH = mediaEl.naturalHeight || h;
            const scale = Math.min(w * 0.9 / imgW, h * 0.9 / imgH);
            const dw = imgW * scale, dh = imgH * scale;
            try { octx.drawImage(mediaEl, (w - dw) / 2, (h - dh) / 2, dw, dh); } catch (_) { return; }
        }

        // Apply invert
        if (filters.invert > 0) {
            const imgData = octx.getImageData(0, 0, w, h);
            const d = imgData.data;
            const amt = filters.invert;
            for (let i = 0; i < d.length; i += 4) {
                d[i]     = d[i]     + (255 - 2 * d[i])     * amt;
                d[i + 1] = d[i + 1] + (255 - 2 * d[i + 1]) * amt;
                d[i + 2] = d[i + 2] + (255 - 2 * d[i + 2]) * amt;
            }
            octx.putImageData(imgData, 0, 0);
        }

        // Apply hue-rotate via rotation matrix
        if (filters.hueRotate !== 0) {
            const imgData = octx.getImageData(0, 0, w, h);
            const d = imgData.data;
            const angle = filters.hueRotate * Math.PI / 180;
            const cos = Math.cos(angle), sin = Math.sin(angle);
            for (let i = 0; i < d.length; i += 4) {
                const r = d[i], g = d[i + 1], b = d[i + 2];
                d[i]     = Math.min(255, Math.max(0, r * (0.213 + cos * 0.787 - sin * 0.213) + g * (0.715 - cos * 0.715 - sin * 0.715) + b * (0.072 - cos * 0.072 + sin * 0.928)));
                d[i + 1] = Math.min(255, Math.max(0, r * (0.213 - cos * 0.213 + sin * 0.143) + g * (0.715 + cos * 0.285 + sin * 0.140) + b * (0.072 - cos * 0.072 - sin * 0.283)));
                d[i + 2] = Math.min(255, Math.max(0, r * (0.213 - cos * 0.213 - sin * 0.787) + g * (0.715 - cos * 0.715 + sin * 0.715) + b * (0.072 + cos * 0.928 + sin * 0.072)));
            }
            octx.putImageData(imgData, 0, 0);
        }

        // Apply contrast
        if (filters.contrast !== 1.0) {
            const imgData = octx.getImageData(0, 0, w, h);
            const d = imgData.data;
            const factor = (259 * (filters.contrast * 255 + 255)) / (255 * (259 - filters.contrast * 255));
            for (let i = 0; i < d.length; i += 4) {
                d[i]     = Math.min(255, Math.max(0, factor * (d[i] - 128) + 128));
                d[i + 1] = Math.min(255, Math.max(0, factor * (d[i + 1] - 128) + 128));
                d[i + 2] = Math.min(255, Math.max(0, factor * (d[i + 2] - 128) + 128));
            }
            octx.putImageData(imgData, 0, 0);
        }

        // Apply brightness
        if (filters.brightness > 1.0) {
            const alpha = Math.min(0.85, (filters.brightness - 1.0) * 0.7);
            octx.globalCompositeOperation = 'lighter';
            octx.fillStyle = `rgba(255,255,255,${alpha})`;
            octx.fillRect(0, 0, w, h);
            octx.globalCompositeOperation = 'source-over';
        }

        // Draw to export canvas with opacity
        ctx.globalAlpha = opacity;
        ctx.drawImage(oc, -w / 2, -h / 2, w, h);
        ctx.globalAlpha = 1.0;
    }

    /* ── Blend Mode Mapping ────────────────────────── */
    _cssBlendToCanvas(cssBlend) {
        const map = {
            'normal': 'source-over',
            'screen': 'screen',
            'multiply': 'multiply',
            'overlay': 'overlay',
            'lighten': 'lighten',
            'color-dodge': 'color-dodge',
            'hard-light': 'hard-light',
            'add': 'lighter',
        };
        return map[cssBlend] || 'screen';
    }

    /* ── Stop / Cancel ─────────────────────────────── */
    stop() {
        if (this.mediaRecorder && this.isRecording) {
            this.isRecording = false;
            this.mediaRecorder.stop();
        }
    }

    cancel() {
        this.isRecording = false;
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
        }
        cancelAnimationFrame(this._rafId);
        this.chunks = [];
    }

    static downloadBlob(blob, filename = 'beat-visualizer.webm') {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
}