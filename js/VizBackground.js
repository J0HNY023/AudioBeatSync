/**
 * Draws the reactive media (image/video) as a blurred/dimmed background
 * behind the live spectrum visualizer.
 */
export class VizBackground {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.width = 0;
        this.height = 0;
        this._mediaEl = null;
        this._blurAmount = 8;
    }

    resize(displayWidth, displayHeight) {
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = Math.round(displayWidth * dpr);
        this.canvas.height = Math.round(displayHeight * dpr);
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.width = displayWidth;
        this.height = displayHeight;
    }

    /** Set the media element to use as background source */
    setMedia(mediaEl) {
        this._mediaEl = mediaEl;
    }

    /** Draw the media as background each frame */
    draw() {
        const { ctx, width: w, height: h, _mediaEl } = this;
        if (!w || !h) return;

        // Clear
        ctx.clearRect(0, 0, w, h);

        if (!_mediaEl) {
            // No media — dark background
            ctx.fillStyle = '#0d0d0d';
            ctx.fillRect(0, 0, w, h);
            return;
        }

        // Apply blur via CSS filter on the context
        ctx.filter = `blur(${this._blurAmount}px) brightness(0.6)`;

        try {
            if (_mediaEl.tagName === 'VIDEO') {
                // Cover-fit the video into the panel
                const vw = _mediaEl.videoWidth || w;
                const vh = _mediaEl.videoHeight || h;
                const scale = Math.max(w / vw, h / vh);
                const dw = vw * scale;
                const dh = vh * scale;
                ctx.drawImage(_mediaEl, (w - dw) / 2, (h - dh) / 2, dw, dh);
            } else if (_mediaEl.naturalWidth) {
                // Cover-fit the image
                const iw = _mediaEl.naturalWidth;
                const ih = _mediaEl.naturalHeight;
                const scale = Math.max(w / iw, h / ih);
                const dw = iw * scale;
                const dh = ih * scale;
                ctx.drawImage(_mediaEl, (w - dw) / 2, (h - dh) / 2, dw, dh);
            }
        } catch (_) {}

        // Reset filter
        ctx.filter = 'none';

        // Dark vignette overlay for depth
        const gradient = ctx.createRadialGradient(w / 2, h / 2, w * 0.2, w / 2, h / 2, w * 0.7);
        gradient.addColorStop(0, 'rgba(0,0,0,0)');
        gradient.addColorStop(1, 'rgba(0,0,0,0.5)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, w, h);
    }
}