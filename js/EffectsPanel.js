/**
 * Paginated per-effect settings panel.
 * Categories: motion, color, distortion, geometric, all
 */
export class EffectsPanel {
    constructor(containerEl, reactor) {
        this.container = containerEl;
        this.reactor = reactor;
        this.currentPage = 'motion';

        this.effectMeta = {
            jitter:       { label: 'Jitter',         icon: '〰️', category: 'motion' },
            scale:        { label: 'Scale Pulse',    icon: '🔍', category: 'motion' },
            shake:        { label: 'Shake',          icon: '📳', category: 'motion' },
            rotate:       { label: 'Rotate',         icon: '🔄', category: 'motion' },
            zoomBurst:    { label: 'Zoom Burst',     icon: '💫', category: 'motion' },
            trailEcho:    { label: 'Trail / Echo',   icon: '👻', category: 'motion' },
            flash:        { label: 'Flash',          icon: '⚡', category: 'color' },
            invert:       { label: 'Invert Pulse',   icon: '🔃', category: 'color' },
            hueRotate:    { label: 'Hue Rotate',     icon: '🎨', category: 'color' },
            strobe:       { label: 'Strobe',         icon: '💥', category: 'color' },
            thermal:      { label: 'Thermal Map',    icon: '🌡️', category: 'color' },
            posterize:    { label: 'Posterize',      icon: '🎭', category: 'color' },
            glitch:       { label: 'Glitch',         icon: '📺', category: 'distortion' },
            rgbSplit:     { label: 'RGB Split',      icon: '🌈', category: 'distortion' },
            pixelate:     { label: 'Pixelate',       icon: '🟩', category: 'distortion' },
            waveWarp:     { label: 'Wave Warp',      icon: '🌊', category: 'distortion' },
            scanlineCRT:  { label: 'Scanline CRT',   icon: '📟', category: 'distortion' },
            kaleidoscope: { label: 'Kaleidoscope',   icon: '🔮', category: 'geometric' },
            mirrorKaleido:{ label: 'Mirror Kaleido', icon: '🪞', category: 'geometric' },
            vignette:     { label: 'Vignette Pulse', icon: '🔘', category: 'geometric' },
            mosaicShatter:{ label: 'Mosaic Shatter', icon: '💎', category: 'geometric' },
        };

        this.presets = {
            'Clean':       { jitter:{intensity:0.6}, scale:{intensity:0.8}, flash:{enabled:true,intensity:0.5} },
            'EDM Drop':    { shake:{enabled:true,intensity:1.8,speed:1.5}, glitch:{enabled:true,intensity:2.0,speed:2.0}, rgbSplit:{enabled:true,intensity:1.5}, flash:{enabled:true,intensity:1.2}, scale:{intensity:1.5} },
            'Cyberpunk':   { glitch:{enabled:true,intensity:1.8,speed:2.5}, rgbSplit:{enabled:true,intensity:1.4}, strobe:{enabled:true,intensity:1.0,speed:2.0}, scanlineCRT:{enabled:true,intensity:0.8} },
            'Psychedelic': { invert:{enabled:true,intensity:1.5,speed:0.8}, rotate:{enabled:true,intensity:1.8}, rgbSplit:{enabled:true,intensity:1.2}, hueRotate:{enabled:true,intensity:1.5}, kaleidoscope:{enabled:true,intensity:1.2} },
            'Dreamy':      { trailEcho:{enabled:true,intensity:1.5,speed:0.5}, waveWarp:{enabled:true,intensity:0.8}, scale:{intensity:0.6}, hueRotate:{enabled:true,intensity:0.5} },
            'Horror':      { invert:{enabled:true,intensity:2.0,threshold:0.1}, strobe:{enabled:true,intensity:1.5,speed:0.5}, shake:{enabled:true,intensity:2.2}, vignette:{enabled:true,intensity:1.8} },
            'Retro VHS':   { rgbSplit:{enabled:true,intensity:1.0,speed:0.7}, glitch:{enabled:true,intensity:0.8,speed:0.6}, scanlineCRT:{enabled:true,intensity:1.0}, jitter:{intensity:1.2} },
            'All Off':     {},
        };

        this._build();
    }

    _getFilteredEffects() {
        if (this.currentPage === 'all') return Object.entries(this.effectMeta);
        return Object.entries(this.effectMeta).filter(([, meta]) => meta.category === this.currentPage);
    }

    _build() {
        this.container.innerHTML = '';

        const filtered = this._getFilteredEffects();

        filtered.forEach(([key, meta]) => {
            const cfg = this.reactor.getConfig(key);
            if (!cfg) return;

            const card = document.createElement('div');
            card.className = `effect-card${cfg.enabled ? ' active' : ''}`;
            card.dataset.effect = key;

            card.innerHTML = `
                <div class="effect-card-header">
                    <span class="effect-card-name">${meta.icon} ${meta.label}</span>
                    <div class="effect-toggle${cfg.enabled ? ' on' : ''}" data-effect="${key}"></div>
                </div>
                <div class="effect-param">
                    <label>Intensity</label>
                    <input type="range" min="0.1" max="3.0" step="0.1" value="${cfg.intensity}" data-effect="${key}" data-param="intensity">
                    <span class="param-val">${cfg.intensity.toFixed(1)}</span>
                </div>
                <div class="effect-param">
                    <label>Speed</label>
                    <input type="range" min="0.2" max="3.0" step="0.1" value="${cfg.speed}" data-effect="${key}" data-param="speed">
                    <span class="param-val">${cfg.speed.toFixed(1)}</span>
                </div>
                <div class="effect-param">
                    <label>Threshold</label>
                    <input type="range" min="0" max="0.95" step="0.05" value="${cfg.threshold}" data-effect="${key}" data-param="threshold">
                    <span class="param-val">${cfg.threshold.toFixed(2)}</span>
                </div>
            `;
            this.container.appendChild(card);
        });

        // Preset buttons
        const presetRow = document.createElement('div');
        presetRow.className = 'effects-presets';
        Object.keys(this.presets).forEach(name => {
            const btn = document.createElement('button');
            btn.className = 'preset-btn';
            btn.textContent = name;
            btn.addEventListener('click', () => this._applyPreset(name));
            presetRow.appendChild(btn);
        });
        this.container.appendChild(presetRow);

        this._bindEvents();
    }

    _bindEvents() {
        // Toggle switches
        this.container.querySelectorAll('.effect-toggle').forEach(toggle => {
            toggle.addEventListener('click', () => {
                const effect = toggle.dataset.effect;
                const isOn = toggle.classList.toggle('on');
                toggle.closest('.effect-card').classList.toggle('active', isOn);
                this.reactor.setEffectParam(effect, 'enabled', isOn);
                this._onSettingsChange?.();
            });
        });

        // Sliders
        this.container.querySelectorAll('.effect-param input[type="range"]').forEach(slider => {
            slider.addEventListener('input', () => {
                const effect = slider.dataset.effect;
                const param = slider.dataset.param;
                const val = parseFloat(slider.value);
                const valSpan = slider.nextElementSibling;
                valSpan.textContent = param === 'threshold' ? val.toFixed(2) : val.toFixed(1);
                this.reactor.setEffectParam(effect, param, val);
                this._onSettingsChange?.();
            });
        });
    }

    /** Switch pagination page */
    setPage(page) {
        this.currentPage = page;
        this._build();
    }

    _applyPreset(name) {
        const preset = this.presets[name];
        if (!preset) return;

        // Disable all first
        Object.keys(this.effectMeta).forEach(key => {
            this.reactor.setEffectParam(key, 'enabled', false);
        });

        // Apply preset
        Object.entries(preset).forEach(([key, params]) => {
            Object.entries(params).forEach(([param, val]) => {
                this.reactor.setEffectParam(key, param, val);
            });
        });

        this._refreshUI();
        this._onSettingsChange?.();
    }

    _refreshUI() {
        // Rebuild effect cards (this clears #effectsGrid innerHTML)
        this._build();

        // Sync master intensity slider (lives outside #effectsGrid)
        const masterSlider = document.getElementById('masterIntensity');
        if (masterSlider) {
            masterSlider.value = this.reactor.masterIntensity;
            const valEl = document.getElementById('masterIntensityVal');
            if (valEl) valEl.textContent = this.reactor.masterIntensity.toFixed(1) + 'x';
        }
    }

    restoreFromSession(sessionData) {
        if (!sessionData) return;
        this.reactor.deserialize(sessionData);
        this._refreshUI();
    }

    _onSettingsChange = null;
}