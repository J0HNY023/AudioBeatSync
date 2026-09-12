/**
 * Beat-reactive media animator — 21 effects with per-effect config.
 */
export class MediaReactor {
    constructor(containerEl) {
        this.container = containerEl;
        this.mediaEl = null;
        this.mediaType = null;
        this.loaded = false;
        this._frameCount = 0;
        this._audioEngine = null;
        this._glitchSlices = [];
        this._glitchTimer = 0;
        this._caCanvas = null;
        this._caCtx = null;
        this._caActive = false;
        this._fxCanvas = null;
        this._fxCtx = null;
        this._trailCanvas = null;
        this._trailCtx = null;
        this._mosaicShards = [];
        this._mosaicTimer = 0;
        this._hueAngle = 0;

        this.effectConfig = {
            jitter:       { enabled: true,  intensity: 1.0, speed: 1.0, threshold: 0.05 },
            scale:        { enabled: true,  intensity: 1.0, speed: 1.0, threshold: 0.0 },
            shake:        { enabled: false, intensity: 1.0, speed: 1.0, threshold: 0.1 },
            rotate:       { enabled: false, intensity: 1.0, speed: 1.0, threshold: 0.1 },
            flash:        { enabled: false, intensity: 1.0, speed: 1.0, threshold: 0.05 },
            invert:       { enabled: false, intensity: 1.0, speed: 1.0, threshold: 0.15 },
            glitch:       { enabled: false, intensity: 1.0, speed: 1.0, threshold: 0.2 },
            rgbSplit:     { enabled: false, intensity: 1.0, speed: 1.0, threshold: 0.1 },
            strobe:       { enabled: false, intensity: 1.0, speed: 1.0, threshold: 0.3 },
            hueRotate:    { enabled: false, intensity: 1.0, speed: 1.0, threshold: 0.1 },
            vignette:     { enabled: false, intensity: 1.0, speed: 1.0, threshold: 0.1 },
            pixelate:     { enabled: false, intensity: 1.0, speed: 1.0, threshold: 0.15 },
            waveWarp:     { enabled: false, intensity: 1.0, speed: 1.0, threshold: 0.1 },
            zoomBurst:    { enabled: false, intensity: 1.0, speed: 1.0, threshold: 0.15 },
            kaleidoscope: { enabled: false, intensity: 1.0, speed: 1.0, threshold: 0.1 },
            scanlineCRT:  { enabled: false, intensity: 1.0, speed: 1.0, threshold: 0.05 },
            trailEcho:    { enabled: false, intensity: 1.0, speed: 1.0, threshold: 0.05 },
            thermal:      { enabled: false, intensity: 1.0, speed: 1.0, threshold: 0.1 },
            posterize:    { enabled: false, intensity: 1.0, speed: 1.0, threshold: 0.15 },
            mirrorKaleido:{ enabled: false, intensity: 1.0, speed: 1.0, threshold: 0.1 },
            mosaicShatter:{ enabled: false, intensity: 1.0, speed: 1.0, threshold: 0.2 },
        };

        this.masterIntensity = 1.0;

                // Mirror settings
        this.mirrorH = false;   // Horizontal flip (left-right)
        this.mirrorV = false;   // Vertical flip (top-bottom)
        this.mirrorQuad = false; // Quad mirror (4-way kaleidoscope)
        this.mirrorGap = 0;     // Gap in pixels between mirrored copies
        this.mirrorOpacity = 0.85; // Opacity of mirrored copies

                // Video loop
        this.videoLoop = true;

        // Media base transform (user-controlled, separate from effect transforms)
        this.mediaScaleX = 1.0;
        this.mediaScaleY = 1.0;
        this.mediaRotate = 0;      // degrees
        this.mediaOffsetX = 0;     // percentage -50 to 50
        this.mediaOffsetY = 0;
        this.mediaFlipH = false;
        this.mediaFlipV = false;
    }

    linkAudioEngine(engine) { this._audioEngine = engine; }
    getConfig(name) { return this.effectConfig[name] || null; }

    setEffectParam(name, param, value) {
        if (!this.effectConfig[name]) return;
        const cfg = this.effectConfig[name];
        switch (param) {
            case 'enabled':   cfg.enabled = !!value; break;
            case 'intensity': cfg.intensity = Math.max(0.1, Math.min(3.0, value)); break;
            case 'speed':     cfg.speed = Math.max(0.2, Math.min(3.0, value)); break;
            case 'threshold': cfg.threshold = Math.max(0.0, Math.min(0.95, value)); break;
        }
        if (name === 'glitch' && !cfg.enabled && this._glitchCanvas) this._glitchCanvas.style.display = 'none';
        if (name === 'rgbSplit' && !cfg.enabled && this._caCanvas) { this._caCanvas.style.display = 'none'; this._caActive = false; }
        if (name === 'trailEcho' && !cfg.enabled && this._fxCanvas) {
            // Clear the fx canvas when trail is disabled so stale trails don't persist
            if (this._fxCtx) this._fxCtx.clearRect(0, 0, this._fxCanvas.width, this._fxCanvas.height);
        }
    }

    setEffectConfig(name, config) {
        if (!this.effectConfig[name]) return;
        Object.entries(config).forEach(([k, v]) => this.setEffectParam(name, k, v));
    }

    setMasterIntensity(v) { 
        this.masterIntensity = Math.max(0.1, Math.min(3.0, v)); 
    }

    setMirrorH(v) { this.mirrorH = !!v; }
    setMirrorV(v) { this.mirrorV = !!v; }
    setMirrorQuad(v) { this.mirrorQuad = !!v; }
    setMirrorGap(v) { this.mirrorGap = Math.max(0, Math.min(50, v)); }
    setMirrorOpacity(v) { this.mirrorOpacity = Math.max(0.1, Math.min(1.0, v)); }

        setVideoLoop(v) {
        this.videoLoop = !!v;
        if (this.mediaEl && this.mediaType === 'video') {
            this.mediaEl.loop = this.videoLoop;
        }
    }

    setMediaScaleX(v) { this.mediaScaleX = Math.max(0.1, Math.min(5.0, v)); }
    setMediaScaleY(v) { this.mediaScaleY = Math.max(0.1, Math.min(5.0, v)); }
    setMediaRotate(v) { this.mediaRotate = Math.max(-360, Math.min(360, v)); }
    setMediaOffsetX(v) { this.mediaOffsetX = Math.max(-50, Math.min(50, v)); }
    setMediaOffsetY(v) { this.mediaOffsetY = Math.max(-50, Math.min(50, v)); }
    setMediaFlipH(v) { this.mediaFlipH = !!v; }
    setMediaFlipV(v) { this.mediaFlipV = !!v; }

    /**
     * Build the base CSS transform string from user media transform settings.
     * This is prepended before effect transforms in update().
     */
    _getBaseTransform() {
        const flipX = this.mediaFlipH ? -1 : 1;
        const flipY = this.mediaFlipV ? -1 : 1;
        const sx = this.mediaScaleX * flipX;
        const sy = this.mediaScaleY * flipY;
        const tx = this.mediaOffsetX;
        const ty = this.mediaOffsetY;
        const rot = this.mediaRotate;
        return `translate(${tx}%, ${ty}%) scale(${sx.toFixed(3)}, ${sy.toFixed(3)}) rotate(${rot}deg)`;
    }

    setEffect(name, enabled) { this.setEffectParam(name, 'enabled', enabled); }
    setIntensity(v) { this.setMasterIntensity(v); }

    async loadMedia(file) {
        const isVideo = file.type.startsWith('video/');
        const isImage = file.type.startsWith('image/');
        if (!isVideo && !isImage) throw new Error('Unsupported file type.');

        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                if (this.mediaEl) {
                    if (this.mediaType === 'video') this.mediaEl.pause();
                    this.mediaEl.remove();
                }
                this.container.querySelectorAll('.glitch-overlay,.ca-overlay,.trail-overlay,.fx-overlay').forEach(el => el.remove());

                if (isVideo) {
                    this.mediaEl = document.createElement('video');
                    this.mediaEl.src = e.target.result;
                    this.mediaEl.className = 'reactor-media';
                    this.mediaEl.playsInline = true;
                    this.mediaEl.muted = true;
                    this.mediaEl.preload = 'auto';
                    this.mediaEl.loop = this.videoLoop;  // ✅ Apply loop setting
                    this.mediaType = 'video';
                } else {
                    this.mediaEl = document.createElement('img');
                    this.mediaEl.src = e.target.result;
                    this.mediaEl.className = 'reactor-media';
                    this.mediaType = 'image';
                }

                this.mediaEl.style.transition = 'none';
                this.mediaEl.style.transformOrigin = 'center center';
                this.container.appendChild(this.mediaEl);

                this._createOverlayCanvas('glitch-overlay', 3);
                this._createOverlayCanvas('ca-overlay', 4);
                this._createOverlayCanvas('trail-overlay', 2);
                this._createOverlayCanvas('fx-overlay', 5);

                this._glitchCanvas = this.container.querySelector('.glitch-overlay');
                this._caCanvas = this.container.querySelector('.ca-overlay');
                this._caCtx = this._caCanvas.getContext('2d', { willReadFrequently: true });
                this._trailCanvas = this.container.querySelector('.trail-overlay');
                this._trailCtx = this._trailCanvas.getContext('2d', { willReadFrequently: true });
                this._fxCanvas = this.container.querySelector('.fx-overlay');
                this._fxCtx = this._fxCanvas.getContext('2d', { willReadFrequently: true });

                this._caActive = false;
                this.loaded = true;
                resolve();
            };
            reader.onerror = () => reject(new Error('File read failed'));
            reader.readAsDataURL(file);
        });
    }

    _createOverlayCanvas(className, zIndex) {
        const c = document.createElement('canvas');
        c.className = className;
        c.style.cssText = `position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:${zIndex};display:none;`;
        this.container.appendChild(c);
        return c;
    }

    syncPlayback(isPlaying, currentTime) {
        if (this.mediaType !== 'video' || !this.mediaEl) return;
        if (isPlaying) {
            if (this.mediaEl.paused) {
                if (currentTime !== undefined && isFinite(currentTime))
                    this.mediaEl.currentTime = Math.min(currentTime, this.mediaEl.duration || currentTime);
                this.mediaEl.play().catch(() => {});
            }
        } else {
            if (!this.mediaEl.paused) this.mediaEl.pause();
        }
    }

    seekVideo(time) {
        if (this.mediaType === 'video' && this.mediaEl && isFinite(time))
            this.mediaEl.currentTime = Math.min(time, this.mediaEl.duration || time);
    }

    /* ── Main Update Loop ──────────────────────────── */
    update(currentTime, beats) {
        if (!this.loaded || !this.mediaEl) return;
        this._frameCount++;

        let rawProximity = 0, beatStrength = 0;
        if (beats.length > 0) {
            const nearest = beats.reduce((best, b) => Math.abs(b.time - currentTime) < Math.abs(best.time - currentTime) ? b : best);
            const dist = Math.abs(nearest.time - currentTime);
            if (dist < 0.15) {
                rawProximity = 1 - (dist / 0.15);
                rawProximity = rawProximity * rawProximity * (3 - 2 * rawProximity);
                beatStrength = Math.min(1, nearest.strength / 2.5);
            }
        }

        let tx = 0, ty = 0, scale = 1, rot = 0;
        const filters = [];
        const mi = this.masterIntensity;
        const canvasEffects = [];

        const effP = (cfg) => {
            if (!cfg.enabled) return 0;
            const adj = Math.pow(rawProximity, 1 / cfg.speed);
            if (adj < cfg.threshold) return 0;
            return ((adj - cfg.threshold) / (1 - cfg.threshold)) * cfg.intensity * mi;  // ← mi must multiply
        };

        // ── Motion effects ──
        const pJitter = effP(this.effectConfig.jitter);
        if (pJitter > 0.01) { const j = pJitter * 8; tx += (Math.random()-.5)*2*j; ty += (Math.random()-.5)*2*j; }

        const pShake = effP(this.effectConfig.shake);
        if (pShake > 0.01) { const m = pShake * 20; tx += (Math.random()-.5)*2*m; ty += (Math.random()-.5)*2*m; }

        const pScale = effP(this.effectConfig.scale);
        if (this.effectConfig.scale.enabled) {
            const s = beatStrength * this.effectConfig.scale.intensity * mi;
            scale = 1 + (pScale * 0.2 * (0.4 + s * 0.6));
        }

        const pRotate = effP(this.effectConfig.rotate);
        if (pRotate > 0.01) rot = (Math.random()-.5)*2*pRotate*10;

        const pZoom = effP(this.effectConfig.zoomBurst);
        if (this.effectConfig.zoomBurst.enabled && pZoom > 0.01) scale += pZoom * 0.4;

        // ── Color filter effects ──
        const pFlash = effP(this.effectConfig.flash);
        if (this.effectConfig.flash.enabled) filters.push(`brightness(${(1+pFlash*0.7).toFixed(3)})`);

        const pInvert = effP(this.effectConfig.invert);
        if (this.effectConfig.invert.enabled) filters.push(`invert(${Math.round(pInvert*100)}%)`);

        const pHue = effP(this.effectConfig.hueRotate);
        if (this.effectConfig.hueRotate.enabled) {
            this._hueAngle += pHue * 3 * this.effectConfig.hueRotate.speed;
            filters.push(`hue-rotate(${this._hueAngle.toFixed(1)}deg)`);
        }

        const pPoster = effP(this.effectConfig.posterize);
        if (this.effectConfig.posterize.enabled && pPoster > 0.01) {
            filters.push(`contrast(${(1+pPoster*1.5).toFixed(2)}) saturate(${(1+pPoster*2).toFixed(2)})`);
        }

        const pStrobe = effP(this.effectConfig.strobe);
        if (this.effectConfig.strobe.enabled && pStrobe > 0.3) {
            this.mediaEl.style.opacity = Math.random() > (0.4 * this.effectConfig.strobe.speed) ? '1' : '0.08';
        } else {
            this.mediaEl.style.opacity = '1';
        }



        // ── Canvas-based effects ──
        const pRgb = effP(this.effectConfig.rgbSplit);
        if (this.effectConfig.rgbSplit.enabled && pRgb > 0.02) canvasEffects.push({ type: 'rgbSplit', p: pRgb });

        const pGlitch = effP(this.effectConfig.glitch);
        if (this.effectConfig.glitch.enabled && pGlitch > 0.05) canvasEffects.push({ type: 'glitch', p: pGlitch });

        const pWave = effP(this.effectConfig.waveWarp);
        if (this.effectConfig.waveWarp.enabled && pWave > 0.02) canvasEffects.push({ type: 'waveWarp', p: pWave });

        const pKaleido = effP(this.effectConfig.kaleidoscope);
        if (this.effectConfig.kaleidoscope.enabled && pKaleido > 0.02) canvasEffects.push({ type: 'kaleidoscope', p: pKaleido });

        const pMirror = effP(this.effectConfig.mirrorKaleido);
        if (this.effectConfig.mirrorKaleido.enabled && pMirror > 0.02) canvasEffects.push({ type: 'mirrorKaleido', p: pMirror });

        const pPixel = effP(this.effectConfig.pixelate);
        if (this.effectConfig.pixelate.enabled && pPixel > 0.02) canvasEffects.push({ type: 'pixelate', p: pPixel });

        const pThermal = effP(this.effectConfig.thermal);
        if (this.effectConfig.thermal.enabled && pThermal > 0.02) canvasEffects.push({ type: 'thermal', p: pThermal });

        const pScanline = effP(this.effectConfig.scanlineCRT);
        if (this.effectConfig.scanlineCRT.enabled) canvasEffects.push({ type: 'scanlineCRT', p: Math.max(pScanline, 0.3) });

        const pTrail = effP(this.effectConfig.trailEcho);
        if (this.effectConfig.trailEcho.enabled) canvasEffects.push({ type: 'trailEcho', p: Math.max(pTrail, 0.1) });

        const pVignette = effP(this.effectConfig.vignette);
        if (this.effectConfig.vignette.enabled) canvasEffects.push({ type: 'vignette', p: Math.max(pVignette, 0.2) });

        const pMosaic = effP(this.effectConfig.mosaicShatter);
        if (this.effectConfig.mosaicShatter.enabled && pMosaic > 0.05) canvasEffects.push({ type: 'mosaicShatter', p: pMosaic });

        // ── Apply CSS transforms + filters ──
        // Combine user base transform + effect transforms
        const baseTransform = this._getBaseTransform();
        this.mediaEl.style.transform = `${baseTransform} translate3d(${tx.toFixed(2)}px,${ty.toFixed(2)}px,0) scale(${scale.toFixed(4)}) rotate(${rot.toFixed(2)}deg)`;
        this.mediaEl.style.filter = filters.length > 0 ? filters.join(' ') : 'none';

        // ── Render canvas effects ──
        const hasCanvasFx = canvasEffects.length > 0;
        if (hasCanvasFx) {
            this._renderCanvasEffects(canvasEffects, beatStrength, currentTime);
            this.mediaEl.style.visibility = 'hidden';
        } else {
            this.mediaEl.style.visibility = 'visible';
            this._hideAllOverlays();
        }

                // ── Mirror Effect ──
        const hasMirror = this.mirrorH || this.mirrorV || this.mirrorQuad;
        if (hasMirror) {
            this._renderMirror();
        }

        // Panel glow
        const maxP = Math.max(pJitter,pShake,pScale,pRotate,pFlash,pInvert,pHue,pZoom,pStrobe,pRgb,pGlitch,pWave,pKaleido,pMirror,pPixel,pThermal,pScanline,pTrail,pVignette,pMosaic,pPoster);
        this.container.style.boxShadow = maxP > 0.5 ? `0 0 ${maxP*30}px rgba(0,255,136,${maxP*0.6})` : 'none';
    }

    _hideAllOverlays() {
        [this._glitchCanvas, this._caCanvas, this._trailCanvas, this._fxCanvas].forEach(c => { if (c) c.style.display = 'none'; });
        this._caActive = false;
    }

        /**
     * Renders mirror/flip effect by compositing flipped copies of the fxCanvas.
     * Works on top of whatever is already rendered (CSS effects + canvas effects).
     */
    _renderMirror() {
        // We need a source to mirror — use fxCanvas if active, otherwise draw media to a temp canvas
        const rect = this.container.getBoundingClientRect();
        const w = Math.round(rect.width), h = Math.round(rect.height);
        if (w === 0 || h === 0) return;

        // Ensure we have a mirror canvas
        if (!this._mirrorCanvas) {
            this._mirrorCanvas = document.createElement('canvas');
            this._mirrorCtx = this._mirrorCanvas.getContext('2d', { willReadFrequently: true });
        }
        const mc = this._mirrorCanvas, mctx = this._mirrorCtx;
        mc.width = w; mc.height = h;

        // Get source — either fxCanvas or render media fresh
        const fxCanvas = this._fxCanvas;
        const fxVisible = fxCanvas && fxCanvas.style.display !== 'none' && fxCanvas.width > 0 && fxCanvas.height > 0;

        // Draw source to mirror canvas
        mctx.clearRect(0, 0, w, h);
        if (fxVisible) {
            mctx.drawImage(fxCanvas, 0, 0, w, h);
        } else if (this.mediaEl) {
            mctx.save();
            mctx.translate(w / 2, h / 2);
            const style = getComputedStyle(this.mediaEl);
            const transform = style.transform;
            if (transform && transform !== 'none') {
                const match = transform.match(/matrix.*\((.+)\)/);
                if (match) {
                    const v = match[1].split(',').map(parseFloat);
                    if (v.length >= 6) mctx.transform(v[0], v[1], v[2], v[3], v[4], v[5]);
                }
            }
            const opacity = parseFloat(this.mediaEl.style.opacity) || 1;
            mctx.globalAlpha = opacity;
            try {
                if (this.mediaEl.tagName === 'VIDEO') {
                    mctx.drawImage(this.mediaEl, -w / 2, -h / 2, w, h);
                } else {
                    const iw = this.mediaEl.naturalWidth || w, ih = this.mediaEl.naturalHeight || h;
                    const s = Math.min(w * 0.9 / iw, h * 0.9 / ih);
                    mctx.drawImage(this.mediaEl, -iw * s / 2, -ih * s / 2, iw * s, ih * s);
                }
            } catch (_) {}
            mctx.globalAlpha = 1;
            mctx.restore();
        }

        // Now composite mirrored copies onto the fxCanvas
        const target = fxVisible ? this._fxCtx : mctx;
        const targetCanvas = fxVisible ? this._fxCanvas : mc;

        // If no fxCanvas active, we need to show the mirror canvas
        if (!fxVisible) {
            // Copy mirror canvas to fxCanvas and show it
            if (!this._fxCanvas) return;
            this._fxCanvas.width = w;
            this._fxCanvas.height = h;
            this._fxCtx.clearRect(0, 0, w, h);
            this._fxCtx.drawImage(mc, 0, 0);
            this._fxCanvas.style.display = 'block';
            this.mediaEl.style.visibility = 'hidden';
        }

        const gap = this.mirrorGap;
        const mo = this.mirrorOpacity;

        if (this.mirrorQuad) {
            // Quad mirror: 4 copies (original + H-flip + V-flip + both)
            // Top-right: horizontal flip
            this._drawMirroredCopy(target, targetCanvas, w, h, -1, 1, w + gap, 0, mo);
            // Bottom-left: vertical flip
            this._drawMirroredCopy(target, targetCanvas, w, h, 1, -1, 0, h + gap, mo);
            // Bottom-right: both flips
            this._drawMirroredCopy(target, targetCanvas, w, h, -1, -1, w + gap, h + gap, mo);

            // Resize container to fit quad layout
            this.container.style.overflow = 'visible';
        } else {
            if (this.mirrorH) {
                this._drawMirroredCopy(target, targetCanvas, w, h, -1, 1, w + gap, 0, mo);
            }
            if (this.mirrorV) {
                this._drawMirroredCopy(target, targetCanvas, w, h, 1, -1, 0, h + gap, mo);
            }
        }
    }

    _drawMirroredCopy(ctx, sourceCanvas, w, h, scaleX, scaleY, offsetX, offsetY, opacity) {
        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.translate(offsetX + (scaleX < 0 ? w : 0), offsetY + (scaleY < 0 ? h : 0));
        ctx.scale(scaleX, scaleY);
        ctx.drawImage(sourceCanvas, 0, 0, w, h);
        ctx.restore();
    }

    /* ── Canvas Effect Renderer ────────────────────── */
    _renderCanvasEffects(effects, beatStrength, currentTime) {
        const rect = this.container.getBoundingClientRect();
        const w = Math.round(rect.width), h = Math.round(rect.height);
        if (w === 0 || h === 0) return;

        const fc = this._fxCanvas, fctx = this._fxCtx;

        // ✅ FIX: Only resize canvas when dimensions actually change.
        // Setting .width/.height clears the canvas — which destroys trail history.
        const needResize = fc.width !== w || fc.height !== h;
        if (needResize) {
            fc.width = w;
            fc.height = h;
        }

        fc.style.display = 'block';

        const trailFx = effects.find(e => e.type === 'trailEcho');

        if (trailFx && !needResize) {
            // ✅ TRAIL MODE: Gentle fade — trails persist 15-35 frames
            // intensity 0.3 → fade 0.03/frame → ~33 frames of visible trail
            // intensity 1.0 → fade 0.06/frame → ~16 frames of visible trail
            // intensity 3.0 → fade 0.12/frame → ~8 frames of visible trail
            const fadePerFrame = 0.02 + (trailFx.p * 0.035);
            fctx.fillStyle = `rgba(13,13,13,${fadePerFrame})`;
            fctx.fillRect(0, 0, w, h);

            // Draw media with current CSS transform baked in
            fctx.save();
            this._drawMediaWithTransform(fctx, w, h);
            fctx.restore();
        } else {
            // Normal mode or first frame after resize: clear and draw fresh
            fctx.clearRect(0, 0, w, h);
            fctx.save();
            this._drawMediaWithTransform(fctx, w, h);
            fctx.restore();
        }

        // Apply remaining canvas effects (skip trailEcho — already handled above)
        for (const fx of effects) {
            if (fx.type === 'trailEcho') continue;
            switch (fx.type) {
                case 'rgbSplit':      this._fxRgbSplit(fctx, w, h, fx.p); break;
                case 'waveWarp':      this._fxWaveWarp(fctx, w, h, fx.p, currentTime); break;
                case 'pixelate':      this._fxPixelate(fctx, w, h, fx.p); break;
                case 'thermal':       this._fxThermal(fctx, w, h, fx.p); break;
                case 'posterize':     this._fxPosterize(fctx, w, h, fx.p); break;
                case 'kaleidoscope':  this._fxKaleidoscope(fctx, w, h, fx.p, currentTime); break;
                case 'mirrorKaleido': this._fxMirrorKaleido(fctx, w, h, fx.p, currentTime); break;
                case 'mosaicShatter': this._fxMosaicShatter(fctx, w, h, fx.p); break;
                case 'vignette':      this._fxVignette(fctx, w, h, fx.p); break;
                case 'scanlineCRT':   this._fxScanlineCRT(fctx, w, h, fx.p, currentTime); break;
                case 'glitch':        this._fxGlitch(fctx, w, h, fx.p); break;
            }
        }
    }

    /**
     * Draw media with current CSS transform matrix applied to canvas context.
     * Bakes jitter/shake/rotate/scale into the canvas for trail echo capture.
     */
    _drawMediaWithTransform(ctx, w, h) {
        if (!this.mediaEl) return;

        const style = getComputedStyle(this.mediaEl);
        const transform = style.transform;

        ctx.save();
        ctx.translate(w / 2, h / 2);

        if (transform && transform !== 'none') {
            const match = transform.match(/matrix.*\((.+)\)/);
            if (match) {
                const v = match[1].split(',').map(parseFloat);
                if (v.length >= 6) {
                    ctx.transform(v[0], v[1], v[2], v[3], v[4], v[5]);
                }
            }
        }

        const opacity = parseFloat(this.mediaEl.style.opacity) || 1;
        ctx.globalAlpha = opacity;

        try {
            if (this.mediaEl.tagName === 'VIDEO') {
                ctx.drawImage(this.mediaEl, -w / 2, -h / 2, w, h);
            } else {
                const iw = this.mediaEl.naturalWidth || w;
                const ih = this.mediaEl.naturalHeight || h;
                const s = Math.min(w * 0.9 / iw, h * 0.9 / ih);
                const dw = iw * s, dh = ih * s;
                ctx.drawImage(this.mediaEl, -dw / 2, -dh / 2, dw, dh);
            }
        } catch (_) {}

        ctx.globalAlpha = 1.0;
        ctx.restore();
    }

    _drawMediaWithTransform(ctx, w, h) {
        if (!this.mediaEl) return;

        const style = getComputedStyle(this.mediaEl);
        const transform = style.transform;

        ctx.save();
        ctx.translate(w / 2, h / 2);

        if (transform && transform !== 'none') {
            const match = transform.match(/matrix.*\((.+)\)/);
            if (match) {
                const v = match[1].split(',').map(parseFloat);
                if (v.length >= 6) {
                    ctx.transform(v[0], v[1], v[2], v[3], v[4], v[5]);
                }
            }
        }

        const opacity = parseFloat(this.mediaEl.style.opacity) || 1;
        ctx.globalAlpha = opacity;

        try {
            if (this.mediaEl.tagName === 'VIDEO') {
                ctx.drawImage(this.mediaEl, -w / 2, -h / 2, w, h);
            } else {
                const iw = this.mediaEl.naturalWidth || w;
                const ih = this.mediaEl.naturalHeight || h;
                const s = Math.min(w * 0.9 / iw, h * 0.9 / ih);
                const dw = iw * s, dh = ih * s;
                ctx.drawImage(this.mediaEl, -dw / 2, -dh / 2, dw, dh);
            }
        } catch (_) {}

        ctx.globalAlpha = 1.0;
        ctx.restore();
    }

    /* ── Individual Canvas Effects ─────────────────── */

    _fxRgbSplit(ctx, w, h, p) {
        const imgData = ctx.getImageData(0, 0, w, h);
        const src = imgData.data;
        const out = ctx.createImageData(w, h);
        const dst = out.data;
        const shift = Math.round(p * 18);
        const angle = Math.PI * 0.25;
        const sx = Math.round(Math.cos(angle) * shift);
        const sy = Math.round(Math.sin(angle) * shift);
        if (Math.abs(sx) < 1 && Math.abs(sy) < 1) return;

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = (y * w + x) * 4;
                const rx = Math.min(w - 1, Math.max(0, x + sx)), ry = Math.min(h - 1, Math.max(0, y + sy));
                const bx = Math.min(w - 1, Math.max(0, x - sx)), by = Math.min(h - 1, Math.max(0, y - sy));
                dst[i]     = src[(ry * w + rx) * 4];
                dst[i + 1] = src[i + 1];
                dst[i + 2] = src[(by * w + bx) * 4 + 2];
                dst[i + 3] = 255;
            }
        }
        ctx.putImageData(out, 0, 0);
    }

    _fxWaveWarp(ctx, w, h, p, time) {
        const imgData = ctx.getImageData(0, 0, w, h);
        const src = new Uint8ClampedArray(imgData.data);
        const dst = imgData.data;
        const amp = p * 25;
        const freq = 0.02 + p * 0.03;
        const phase = time * 3 * this.effectConfig.waveWarp.speed;

        for (let y = 0; y < h; y++) {
            const offsetX = Math.round(Math.sin(y * freq + phase) * amp);
            for (let x = 0; x < w; x++) {
                const srcX = Math.min(w - 1, Math.max(0, x + offsetX));
                const di = (y * w + x) * 4, si = (y * w + srcX) * 4;
                dst[di] = src[si]; dst[di + 1] = src[si + 1]; dst[di + 2] = src[si + 2]; dst[di + 3] = 255;
            }
        }
        const tmp = new Uint8ClampedArray(dst);
        for (let x = 0; x < w; x++) {
            const offsetY = Math.round(Math.sin(x * freq + phase * 0.7) * amp * 0.5);
            for (let y = 0; y < h; y++) {
                const srcY = Math.min(h - 1, Math.max(0, y + offsetY));
                const di = (y * w + x) * 4, si = (srcY * w + x) * 4;
                dst[di] = tmp[si]; dst[di + 1] = tmp[si + 1]; dst[di + 2] = tmp[si + 2];
            }
        }
        ctx.putImageData(imgData, 0, 0);
    }

    _fxPixelate(ctx, w, h, p) {
        const size = Math.max(2, Math.round(p * 30));
        const temp = document.createElement('canvas');
        temp.width = Math.ceil(w / size); temp.height = Math.ceil(h / size);
        const tctx = temp.getContext('2d');
        tctx.imageSmoothingEnabled = false;
        tctx.drawImage(ctx.canvas, 0, 0, temp.width, temp.height);
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(temp, 0, 0, w, h);
        ctx.imageSmoothingEnabled = true;
    }

    _fxThermal(ctx, w, h, p) {
        const imgData = ctx.getImageData(0, 0, w, h);
        const d = imgData.data;
        const mix = Math.min(1, p);
        for (let i = 0; i < d.length; i += 4) {
            const lum = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
            let r, g, b;
            if (lum < 0.25)       { const t = lum / 0.25;        r = t * 128; g = 0; b = t * 255; }
            else if (lum < 0.5)   { const t = (lum - 0.25) / 0.25; r = 128 + t * 127; g = 0; b = 255 - t * 255; }
            else if (lum < 0.75)  { const t = (lum - 0.5) / 0.25;  r = 255; g = t * 255; b = 0; }
            else                   { const t = (lum - 0.75) / 0.25; r = 255; g = 255; b = t * 255; }
            d[i]     = d[i] * (1 - mix) + r * mix;
            d[i + 1] = d[i + 1] * (1 - mix) + g * mix;
            d[i + 2] = d[i + 2] * (1 - mix) + b * mix;
        }
        ctx.putImageData(imgData, 0, 0);
    }

    _fxPosterize(ctx, w, h, p) {
        const levels = Math.max(2, Math.round(8 - p * 6));
        const step = 255 / (levels - 1);
        const imgData = ctx.getImageData(0, 0, w, h);
        const d = imgData.data;
        for (let i = 0; i < d.length; i += 4) {
            d[i]     = Math.round(d[i] / step) * step;
            d[i + 1] = Math.round(d[i + 1] / step) * step;
            d[i + 2] = Math.round(d[i + 2] / step) * step;
        }
        ctx.putImageData(imgData, 0, 0);
    }

    _fxKaleidoscope(ctx, w, h, p, time) {
        const segments = Math.max(3, Math.round(4 + p * 8));
        const cx = w / 2, cy = h / 2;
        const radius = Math.min(w, h) * 0.5;
        const angleStep = (Math.PI * 2) / segments;
        const rotation = time * 0.5 * this.effectConfig.kaleidoscope.speed;

        const temp = document.createElement('canvas');
        temp.width = w; temp.height = h;
        temp.getContext('2d').drawImage(ctx.canvas, 0, 0);

        ctx.clearRect(0, 0, w, h);
        for (let i = 0; i < segments; i++) {
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(angleStep * i + rotation);
            if (i % 2 === 1) ctx.scale(-1, 1);
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.arc(0, 0, radius, 0, angleStep);
            ctx.closePath();
            ctx.clip();
            ctx.drawImage(temp, -cx, -cy);
            ctx.restore();
        }
    }

    _fxMirrorKaleido(ctx, w, h, p, time) {
        const folds = Math.max(2, Math.round(2 + p * 4));
        const temp = document.createElement('canvas');
        temp.width = w; temp.height = h;
        temp.getContext('2d').drawImage(ctx.canvas, 0, 0);

        ctx.clearRect(0, 0, w, h);
        const sw = w / folds, sh = h / folds;
        for (let fy = 0; fy < folds; fy++) {
            for (let fx = 0; fx < folds; fx++) {
                ctx.save();
                ctx.translate(fx * sw + sw / 2, fy * sh + sh / 2);
                ctx.scale(fx % 2 === 0 ? 1 : -1, fy % 2 === 0 ? 1 : -1);
                ctx.drawImage(temp, fx * sw, fy * sh, sw, sh, -sw / 2, -sh / 2, sw, sh);
                ctx.restore();
            }
        }
    }

    _fxMosaicShatter(ctx, w, h, p) {
        this._mosaicTimer++;
        if (this._mosaicTimer % 4 === 0 || this._mosaicShards.length === 0) {
            const count = Math.floor(8 + p * 20);
            this._mosaicShards = [];
            for (let i = 0; i < count; i++) {
                this._mosaicShards.push({
                    x: Math.random() * w, y: Math.random() * h,
                    size: 20 + Math.random() * 60,
                    vx: (Math.random() - 0.5) * p * 30,
                    vy: (Math.random() - 0.5) * p * 30,
                    rot: (Math.random() - 0.5) * p * 0.5,
                    angle: Math.random() * Math.PI * 2,
                });
            }
        }

        const temp = document.createElement('canvas');
        temp.width = w; temp.height = h;
        temp.getContext('2d').drawImage(ctx.canvas, 0, 0);

        ctx.clearRect(0, 0, w, h);
        for (const s of this._mosaicShards) {
            s.x += s.vx; s.y += s.vy; s.angle += s.rot;
            ctx.save();
            ctx.translate(s.x, s.y);
            ctx.rotate(s.angle);
            ctx.beginPath();
            ctx.moveTo(-s.size / 2, -s.size / 3);
            ctx.lineTo(s.size / 2, -s.size / 4);
            ctx.lineTo(s.size / 3, s.size / 2);
            ctx.lineTo(-s.size / 4, s.size / 3);
            ctx.closePath();
            ctx.clip();
            ctx.drawImage(temp, -w / 2, -h / 2, w, h);
            ctx.restore();
        }
    }

    _fxVignette(ctx, w, h, p) {
        const cx = w / 2, cy = h / 2;
        const radius = Math.min(w, h) * (0.7 - p * 0.35);
        const gradient = ctx.createRadialGradient(cx, cy, radius * 0.3, cx, cy, radius);
        gradient.addColorStop(0, 'rgba(0,0,0,0)');
        gradient.addColorStop(1, `rgba(0,0,0,${Math.min(0.9, p * 1.2)})`);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, w, h);
    }

    _fxScanlineCRT(ctx, w, h, p, time) {
        ctx.fillStyle = `rgba(0,0,0,${p * 0.25})`;
        const offset = (time * 60 * this.effectConfig.scanlineCRT.speed) % 4;
        for (let y = offset; y < h; y += 3) ctx.fillRect(0, y, w, 1);

        if (Math.random() < p * 0.05) {
            ctx.fillStyle = `rgba(255,255,255,${Math.random() * p * 0.08})`;
            ctx.fillRect(0, 0, w, h);
        }

        if (p > 0.5) {
            const tearY = Math.random() * h;
            const tearH = Math.min(2 + Math.random() * 8, h - tearY);
            const tearShift = (Math.random() - 0.5) * p * 30;
            try {
                const slice = ctx.getImageData(0, Math.floor(tearY), w, Math.floor(tearH));
                ctx.putImageData(slice, tearShift, Math.floor(tearY));
            } catch (_) {}
        }

        ctx.shadowColor = `rgba(0,255,100,${p * 0.15})`;
        ctx.shadowBlur = p * 10;
    }

    _fxGlitch(ctx, w, h, p) {
        this._glitchTimer++;
        const regenRate = Math.max(1, Math.round(4 / this.effectConfig.glitch.speed));
        if (this._glitchTimer % regenRate === 0 || this._glitchSlices.length === 0) {
            const count = Math.floor(3 + p * 8 * this.effectConfig.glitch.intensity);
            this._glitchSlices = [];
            for (let i = 0; i < count; i++) {
                this._glitchSlices.push({
                    y: Math.random() * h,
                    height: 2 + Math.random() * (h * 0.08),
                    offset: (Math.random() - 0.5) * 2 * p * 40 * this.effectConfig.glitch.intensity,
                    tint: Math.random() > 0.6 ? (Math.random() > 0.5 ? 'red' : 'cyan') : null,
                });
            }
        }

        const temp = document.createElement('canvas');
        temp.width = w; temp.height = h;
        temp.getContext('2d').drawImage(ctx.canvas, 0, 0);

        for (const s of this._glitchSlices) {
            const sy = Math.max(0, Math.min(Math.floor(s.y), h - 1));
            const sh = Math.min(Math.floor(s.height), h - sy);
            if (sh <= 0) continue;
            try {
                ctx.drawImage(temp, 0, sy, w, sh, s.offset, sy, w, sh);
                if (s.tint) {
                    ctx.globalCompositeOperation = 'multiply';
                    ctx.fillStyle = s.tint === 'red' ? `rgba(255,0,0,${p * 0.4})` : `rgba(0,255,255,${p * 0.4})`;
                    ctx.fillRect(s.offset, sy, w, sh);
                    ctx.globalCompositeOperation = 'source-over';
                }
            } catch (_) {}
        }
    }

    reset() {
        if (this.mediaEl) {
            if (this.mediaType === 'video') this.mediaEl.pause();
            this.mediaEl.style.transform = 'translate3d(0,0,0) scale(1) rotate(0deg)';
            this.mediaEl.style.filter = 'none';
            this.mediaEl.style.opacity = '1';
            this.mediaEl.style.visibility = 'visible';
        }
        this._hideAllOverlays();
        if (this._fxCanvas && this._fxCtx) {
            this._fxCtx.clearRect(0, 0, this._fxCanvas.width, this._fxCanvas.height);
        }
        if (this.container) this.container.style.boxShadow = 'none';
        this._glitchSlices = [];
        this._mosaicShards = [];
        this._hueAngle = 0;

        this.mirrorH = false;
        this.mirrorV = false;
        this.mirrorQuad = false;
        this.mirrorGap = 0;
        this.mirrorOpacity = 0.85;
        if (this._mirrorCanvas) {
            this._mirrorCtx.clearRect(0, 0, this._mirrorCanvas.width, this._mirrorCanvas.height);
        }
        this.mediaScaleX = 1.0;
        this.mediaScaleY = 1.0;
        this.mediaRotate = 0;
        this.mediaOffsetX = 0;
        this.mediaOffsetY = 0;
        this.mediaFlipH = false;
        this.mediaFlipV = false;

    }

    getMediaType() { return this.mediaType; }

    serialize() {
        return {
            masterIntensity: this.masterIntensity,
            effects: JSON.parse(JSON.stringify(this.effectConfig)),
            mirrorH: this.mirrorH,
            mirrorV: this.mirrorV,
            mirrorQuad: this.mirrorQuad,
            mirrorGap: this.mirrorGap,
            mirrorOpacity: this.mirrorOpacity,
            videoLoop: this.videoLoop,
            mediaScaleX: this.mediaScaleX,
            mediaScaleY: this.mediaScaleY,
            mediaRotate: this.mediaRotate,
            mediaOffsetX: this.mediaOffsetX,
            mediaOffsetY: this.mediaOffsetY,
            mediaFlipH: this.mediaFlipH,
            mediaFlipV: this.mediaFlipV,
        };
    }

    deserialize(data) {


        if (data.videoLoop !== undefined) this.videoLoop = data.videoLoop;
        if (data.mediaScaleX !== undefined) this.mediaScaleX = data.mediaScaleX;
        if (data.mediaScaleY !== undefined) this.mediaScaleY = data.mediaScaleY;
        if (data.mediaRotate !== undefined) this.mediaRotate = data.mediaRotate;
        if (data.mediaOffsetX !== undefined) this.mediaOffsetX = data.mediaOffsetX;
        if (data.mediaOffsetY !== undefined) this.mediaOffsetY = data.mediaOffsetY;
        if (data.mediaFlipH !== undefined) this.mediaFlipH = data.mediaFlipH;
        if (data.mediaFlipV !== undefined) this.mediaFlipV = data.mediaFlipV;
        if (!data) return;
        if (data.masterIntensity) this.masterIntensity = data.masterIntensity;
        if (data.effects) {
            Object.entries(data.effects).forEach(([name, cfg]) => {
                if (this.effectConfig[name]) Object.assign(this.effectConfig[name], cfg);
            });
        }
        if (data.mirrorH !== undefined) this.mirrorH = data.mirrorH;
        if (data.mirrorV !== undefined) this.mirrorV = data.mirrorV;
        if (data.mirrorQuad !== undefined) this.mirrorQuad = data.mirrorQuad;
        if (data.mirrorGap !== undefined) this.mirrorGap = data.mirrorGap;
        if (data.mirrorOpacity !== undefined) this.mirrorOpacity = data.mirrorOpacity;
    }
}