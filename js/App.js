import { AudioEngine } from './AudioEngine.js';
import { BeatDetector } from './BeatDetector.js';
import { WaveformRenderer } from './WaveformRenderer.js';
import { VisualizerRenderer } from './VisualizerRenderer.js';
import { MediaReactor } from './MediaReactor.js';
import { SessionStore } from './SessionStore.js';
import { OverlayVisualizer } from './OverlayVisualizer.js';
import { VideoExporter } from './VideoExporter.js';
import { EffectsPanel } from './EffectsPanel.js';
import { AudioPanner } from './AudioPanner.js';
import { PanelManager } from './PanelManager.js';
import { KeyframeEngine } from './KeyframeEngine.js';
import { VizBackground } from './VizBackground.js';
import { AudioMixer } from './AudioMixer.js';
import { UndoManager } from './UndoManager.js';

class App {
    constructor() {
        this.engine = new AudioEngine();       // ✅ Keep original engine for single-file
        this.mixer = new AudioMixer();         // Mixer for multi-track
        this.useMixer = false;                 // ✅ Flag: which system is active

        this.undoManager = new UndoManager(50);
        
        // Safe DOM element access with null guards
        const waveformCanvas = document.getElementById('waveformCanvas');
        if (!waveformCanvas) {
            console.error('[App] waveformCanvas not found');
            return;
        }
        this.waveform = new WaveformRenderer(waveformCanvas);
        this.waveform._onZoomChange = () => {
            this._redrawWaveform();
            // Sync zoom slider UI
            const slider = document.getElementById('zoomSlider');
            const label = document.getElementById('zoomLabel');
            if (slider) slider.value = this.waveform.zoomLevel;
            if (label) label.textContent = this.waveform.zoomLevel.toFixed(1) + 'x';
        };        
        this.visualizer = new VisualizerRenderer(document.getElementById('vizCanvas'));
        this.reactor = new MediaReactor(document.getElementById('reactorContainer'));
        this.effectsPanel = new EffectsPanel(document.getElementById('effectsGrid'), this.reactor);
        this.effectsPanel._onSettingsChange = () => this._triggerSave();
        this.overlayViz = new OverlayVisualizer(document.getElementById('overlayCanvas'));
        this.exporter = new VideoExporter();
        this.panner = new AudioPanner(this.engine);
        this.panelManager = new PanelManager();
        this.keyframes = new KeyframeEngine();
        this.vizBg = new VizBackground(document.getElementById('vizBgCanvas'));

        this._activeKfTrack = null;
        this.reactor.linkAudioEngine(this.engine);
        this.beats = [];
        this.filteredData = null;
        this.isDragging = false;
        this.currentAudioFile = null;
        this.currentMediaFile = null;

        this._debouncedSave = SessionStore.createDebouncedSave(800);

        // Safe DOM element access with null guards for all required elements
        const domElements = {
            timelineContainer: document.getElementById('timelineContainer'),
            vizPlayhead: document.getElementById('vizPlayhead'),
            wfPlayhead: document.getElementById('wfPlayhead'),
            tooltip: document.getElementById('timeTooltip'),
            timeDisplay: document.getElementById('currentTimeDisplay'),
            playBtn: document.getElementById('playBtn'),
            analyzeBtn: document.getElementById('analyzeBtn'),
            exportBtn: document.getElementById('exportBtn'),
            mainSection: document.getElementById('mainSection'),
            statsSection: document.getElementById('statsSection'),
            beatList: document.getElementById('beatList'),
            freqBand: document.getElementById('freqBand'),
            threshold: document.getElementById('threshold'),
            minGap: document.getElementById('minGap'),
            smoothWindow: document.getElementById('smoothWindow'),
        };
        
        // Validate critical DOM elements
        const missingElements = Object.entries(domElements)
            .filter(([_, el]) => !el)
            .map(([key, _]) => key);
        
        if (missingElements.length > 0) {
            console.error('[App] Missing DOM elements:', missingElements);
        }
        
        this.dom = domElements;

        //selection state
        this._beatSelecting = false;
        this._beatSelStart = 0;
        this._beatSelEnd = 0;

        // Store bound event handlers for cleanup
        this._boundHandlers = {
            windowMousemove: (e) => this._onMove(e),
            windowMouseup: () => this._onUp(),
            windowKeydown: (e) => this._onKeyDown(e),
            beforeunload: () => this._saveSession()
        };

                // After DOM is ready, register panels:
        this._initPanels();

        this._bindEvents();
        this._bindMixerEvents();
        this._bindKeyframeEvents();

        this._resize();

        // Store ResizeObserver references for cleanup
        this._resizeObservers = [];
        const timelineObs = new ResizeObserver(() => this._resize());
        timelineObs.observe(this.dom.timelineContainer);
        this._resizeObservers.push(timelineObs);
        
        const vizPanelEl = document.querySelector('.viz-panel');
        if (vizPanelEl) {
            const vizObs = new ResizeObserver(() => this._resize());
            vizObs.observe(vizPanelEl);
            this._resizeObservers.push(vizObs);
        }
        
        const reactorEl = document.getElementById('reactorContainer');
        if (reactorEl) {
            const reactorObs = new ResizeObserver(() => this._resize());
            reactorObs.observe(reactorEl);
            this._resizeObservers.push(reactorObs);
        }

        this._renderLoop();
        this._restoreSession();
        this._loadDefaultMedia();
    }
    
    /** Cleanup method to prevent memory leaks */
    destroy() {
        // Remove window event listeners
        window.removeEventListener('mousemove', this._boundHandlers.windowMousemove);
        window.removeEventListener('mouseup', this._boundHandlers.windowMouseup);
        window.removeEventListener('keydown', this._boundHandlers.windowKeydown);
        window.removeEventListener('beforeunload', this._boundHandlers.beforeunload);
        
        // Disconnect ResizeObservers
        this._resizeObservers.forEach(obs => obs.disconnect());
        this._resizeObservers = [];
        
        // Clean up audio engine
        if (this.engine) {
            this.engine.destroy?.();
        }
        
        // Clean up mixer
        if (this.mixer) {
            this.mixer.destroy?.();
        }
    }

        async _loadDefaultMedia() {
        // Only load default if no media was restored from session
        if (this.currentMediaFile || this.reactor.loaded) return;

        try {
            const response = await fetch('default-bg.png');
            if (!response.ok) return;
            const blob = await response.blob();
            const file = new File([blob], 'default-bg.png', { type: 'image/png' });

            await this.reactor.loadMedia(file);
            this.vizBg.setMedia(this.reactor.mediaEl);
            const reactorPlaceholder = document.getElementById('reactorPlaceholder');
            if (reactorPlaceholder) reactorPlaceholder.style.display = 'none';

            console.log('%c🖼️ Default background loaded', 'color:#555');
        } catch (err) {
            // Log error but don't fail - default image is optional
            console.warn('[App] Failed to load default background:', err.message || err);
        }
    }

        /* ── Multi-Track Mixer ───────────────────────────── */
    _bindMixerEvents() {
        // ── Add Track via mixer panel ──
        const addLayerInput = document.getElementById('addLayerInput');
        if (addLayerInput) {
                addLayerInput.addEventListener('change', async (e) => {
                const files = Array.from(e.target.files);
                if (files.length === 0) return;

                // ✅ Don't re-init if context already exists — just add layers
                
                if (!this.mixer.ctx) {
                    await this.mixer.init();
                    this.panner.linkMixer(this.mixer);  // ✅ Link panner to mixer (runs once after init)
                } else if (this.mixer.ctx.state === 'suspended') {
                    await this.mixer.ctx.resume();
                }

                for (const file of files) {
                    await this.mixer.addLayer(file.name.replace(/\.[^.]+$/, ''), file);
                }

                e.target.value = '';
                this.useMixer = true;
                this._rebuildLayerUI();
                this._syncEngineFromMixer();

                if (this.mixer.getCoreBuffer() && this.beats.length === 0) {
                    await this._detectBeats();
                }

                this.dom.playBtn.disabled = false;
                this.dom.mainSection.classList.remove('hidden');
                this._triggerSave();
            });
        }

        // ── Event Delegation for layer list (fixes X button + all buttons) ──
        const layerList = document.getElementById('layerList');
        if (layerList) {
            layerList.addEventListener('click', async (e) => {
                const target = e.target;

                // Core star button
                if (target.classList.contains('layer-core-btn')) {
                    const id = target.dataset.id;
                    this.mixer.setCoreLayer(id);
                    this._rebuildLayerUI();
                    this._syncEngineFromMixer();
                    if (this.mixer.getCoreBuffer()) await this._detectBeats();
                    this._triggerSave();
                    return;
                }

                // Mute button
                if (target.dataset.action === 'mute') {
                    const id = target.dataset.id;
                    const layer = this.mixer.layers.find(l => l.id === id);
                    if (layer) {
                        layer.setMuted(!layer.muted);
                        target.classList.toggle('active-mute', layer.muted);
                        this._triggerSave();
                    }
                    return;
                }

                // Solo button
                if (target.dataset.action === 'solo') {
                    const id = target.dataset.id;
                    const layer = this.mixer.layers.find(l => l.id === id);
                    if (layer) {
                        layer.soloed = !layer.soloed;
                        target.classList.toggle('active-solo', layer.soloed);
                        this.mixer.updateSoloState();
                        this._triggerSave();
                    }
                    return;
                }

                // Delete button
                if (target.classList.contains('layer-delete')) {
                    const id = target.dataset.id;
                    this.mixer.removeLayer(id);
                    this._rebuildLayerUI();
                    this._syncEngineFromMixer();
                    this._redrawWaveform();
                    this._triggerSave();
                    return;
                }
            });

            // Volume slider delegation (input event bubbles)
            layerList.addEventListener('input', (e) => {
                if (e.target.classList.contains('layer-vol-slider')) {
                    const id = e.target.dataset.id;
                    const layer = this.mixer.layers.find(l => l.id === id);
                    if (layer) {
                        const v = parseFloat(e.target.value);
                        layer.setVolume(v);
                        const valSpan = e.target.nextElementSibling;
                        if (valSpan) valSpan.textContent = Math.round(v * 100) + '%';
                        this._triggerSave();
                    }
                }


            });


        }

        // Register collapsible panel
        const header = document.getElementById('headerMixer');
        const content = document.getElementById('contentMixer');
        if (header && content) this.panelManager.registerPanel('mixer', header, content, true);
    }

    _syncEngineFromMixer() {
        // Point the legacy engine reference to mixer's core layer
        const core = this.mixer.getCoreLayer();
        if (core && core.buffer) {
            // Create a shim object that matches AudioEngine interface
            this.engine = {
                ctx: this.mixer.ctx,
                buffer: core.buffer,
                analyser: core.analyser,
                gainNode: core.gainNode,
                duration: this.mixer.getDuration(),
                channelData: core.buffer.getChannelData(0),
                sampleRate: core.buffer.sampleRate,
                isPlaying: this.mixer.isPlaying,
                startOffset: this.mixer.startOffset,
                getCurrentTime: () => this.mixer.getCurrentTime(),
                play: () => {}, // Handled by mixer
                pause: () => {},
                seekTo: (t) => this.mixer.seekTo(t),
                setVolume: (v) => { if (core.gainNode) core.setVolume(v); },
                get volume() { return core.volume; },
                setExportDestination: (dest) => { /* handled per-layer */ },
                onEnded: null,
            };
            this.dom.playBtn.disabled = false;
            this.dom.mainSection.classList.remove('hidden');
        }
    }

    _rebuildLayerUI() {
        const container = document.getElementById('layerList');
        const empty = document.getElementById('layerEmpty');

        if (this.mixer.layers.length === 0) {
            container.innerHTML = '';
            if (empty) { container.appendChild(empty); empty.style.display = 'block'; }
            return;
        }

        if (empty) empty.style.display = 'none';
        container.innerHTML = '';

        this.mixer.layers.forEach((layer, idx) => {
            const row = document.createElement('div');
            row.className = `layer-row${layer.isCore ? ' core' : ''}`;
            row.dataset.layerId = layer.id;

            row.innerHTML = `
                <button class="layer-core-btn${layer.isCore ? ' active' : ''}" data-id="${layer.id}" title="Set as core (panning + beat detection)">★</button>
                <span class="layer-name" title="${layer.fileName || layer.name}">${layer.name}</span>
                <div class="layer-controls">
                    <input type="range" class="layer-vol-slider" min="0" max="1" step="0.01" value="${layer.volume}" data-id="${layer.id}" title="Volume">
                    <span class="layer-vol-val">${Math.round(layer.volume * 100)}%</span>
                    <button class="layer-btn${layer.muted ? ' active-mute' : ''}" data-action="mute" data-id="${layer.id}" title="Mute">M</button>
                    <button class="layer-btn${layer.soloed ? ' active-solo' : ''}" data-action="solo" data-id="${layer.id}" title="Solo">S</button>
                    <button class="layer-delete" data-id="${layer.id}" title="Remove">✕</button>
                </div>
            `;

            container.appendChild(row);
        });
    }

    _initPanels() {
        // Register collapsible panels
        const panelPairs = [
            ['spectrum', 'headerSpectrum', 'contentSpectrum'],
            ['detection', 'headerDetection', 'contentDetection'],
            ['beatList', 'headerBeatList', 'contentBeatList'],
            ['panning', 'headerPanning', 'contentPanning'],
            ['export', 'headerExport', 'contentExport'],
        ];

        panelPairs.forEach(([id, headerId, contentId]) => {
            const header = document.getElementById(headerId);
            const content = document.getElementById(contentId);
            if (header && content) {
                this.panelManager.registerPanel(id, header, content, true);
            }
        });

        // Init tab navigation
        this.panelManager.initTabs('mainTabs', {
            media: document.getElementById('tabMedia'),
            audio: document.getElementById('tabAudio'),
            export: document.getElementById('tabExport'),
        });
        
        // Follow playhead toggle for beat list
        const followToggle = document.getElementById('followPlayheadToggle');
        if (followToggle) {
            followToggle.addEventListener('change', (e) => {
                this.followPlayhead = e.target.checked;
                // Update visual state of the toggle button/label
                const label = followToggle.closest('label');
                if (label) {
                    label.classList.toggle('active', this.followPlayhead);
                }
                this._triggerSave();
            });
            // Initialize state on load
            if (this.followPlayhead) {
                const label = followToggle.closest('label');
                if (label) label.classList.add('active');
            }
        }
    }

    /* ── Gather current state for saving ───────────── */
    _gatherState() {
        return {
            freqBand: this.dom.freqBand.value,
            threshold: parseFloat(this.dom.threshold.value),
            minGap: parseInt(this.dom.minGap.value),
            smoothWindow: parseInt(this.dom.smoothWindow.value),
            vizMode: this.visualizer.mode,
            reactor: this.reactor.serialize(),
            overlay: {
                enabled: this.overlayViz.enabled,
                mode: this.overlayViz.mode,
                blendMode: this.overlayViz.blendMode,
                opacity: this.overlayViz.opacity,
                scaleX: this.overlayViz.scaleX,
                scaleY: this.overlayViz.scaleY,
                offsetX: this.overlayViz.offsetX,
                offsetY: this.overlayViz.offsetY,
                rotation: this.overlayViz.rotation,
                // ECG Cluster settings
                ecgHeight: this.overlayViz.ecgHeight,
                ecgSpacing: this.overlayViz.ecgSpacing,
                ecgVertices: this.overlayViz.ecgVertices,
                ecgTraces: this.overlayViz.ecgTraces,
                ecgFreqSeparation: this.overlayViz.ecgFreqSeparation,
                ecgSpikeShape: this.overlayViz.ecgSpikeShape,
            },  // ✅ FIXED: overlay object properly closed here
            beats: this.beats,
            bpm: BeatDetector.estimateBPM(this.beats),
            duration: this.engine.duration,
            audioFileName: this.currentAudioFile?.name || null,
            mediaFileName: this.currentMediaFile?.name || null,
            mediaType: this.reactor.getMediaType(),
            playbackPosition: this.engine.getCurrentTime(),
            panner: this.panner.serialize(),
            keyframes: this.keyframes.serialize(),
            waveformZoom: this.waveform.zoomLevel,
            waveformPan: this.waveform.panOffset, 
            detectAlgorithm: document.getElementById('detectAlgorithm')?.value || 'energy',
            onsetSharpness: parseFloat(document.getElementById('onsetSharpness')?.value || 0),
            decayRate: parseFloat(document.getElementById('decayRate')?.value || 0.5),
            bpmLock: document.getElementById('bpmLock')?.value || 'off',
            preEmphasis: document.getElementById('preEmphasis')?.value || 'off',
            multiBand: document.getElementById('multiBand')?.value || 'off',
            labelTypes: document.getElementById('labelTypes')?.value || 'off', 
                        // ✅ Color settings
            colorMode: this.overlayViz.colorMode,
            primaryColor: this.overlayViz.primaryColor,
            secondaryColor: this.overlayViz.secondaryColor,
            saturation: this.overlayViz.saturation,
            lightness: this.overlayViz.lightness, 
            volume: this.engine.volume,
            vizSyncBand: this.overlayViz.vizSyncBand,
        };
    }

    _triggerSave() {
        this._debouncedSave(this._gatherState());
    }

        /* ── Restore session from storage ──────────────── */
    async _restoreSession() {
        const session = SessionStore.loadSession();
        if (!session) return;

        console.log('%c🔄 Restoring previous session...', 'color:#00d4ff;font-weight:bold');

        // Restore mirror settings
        if (session.reactor) {
            const r = session.reactor;
            if (r.mirrorH) { this.reactor.setMirrorH(true); const el = document.getElementById('mirrorH'); if (el) { el.checked = true; el.parentElement.classList.add('active'); } }
            if (r.mirrorV) { this.reactor.setMirrorV(true); const el = document.getElementById('mirrorV'); if (el) { el.checked = true; el.parentElement.classList.add('active'); } }
            if (r.mirrorQuad) { this.reactor.setMirrorQuad(true); const el = document.getElementById('mirrorQuad'); if (el) { el.checked = true; el.parentElement.classList.add('active'); } }
            if (r.mirrorGap !== undefined) { this.reactor.setMirrorGap(r.mirrorGap); const el = document.getElementById('mirrorGap'); if (el) el.value = r.mirrorGap; const v = document.getElementById('mirrorGapVal'); if (v) v.textContent = r.mirrorGap + 'px'; }
            if (r.mirrorOpacity !== undefined) { this.reactor.setMirrorOpacity(r.mirrorOpacity); const el = document.getElementById('mirrorOpacity'); if (el) el.value = r.mirrorOpacity; const v = document.getElementById('mirrorOpacityVal'); if (v) v.textContent = r.mirrorOpacity.toFixed(2); }
        }

        // ── Waveform zoom ──
        if (session.waveformZoom && session.waveformZoom > 1) {
            this.waveform.zoomLevel = session.waveformZoom;
            this.waveform.panOffset = session.waveformPan || 0;
            const slider = document.getElementById('zoomSlider');
            const label = document.getElementById('zoomLabel');
            if (slider) slider.value = this.waveform.zoomLevel;
            if (label) label.textContent = this.waveform.zoomLevel.toFixed(1) + 'x';
        }

        // ── Detection settings UI ──
        if (session.freqBand) this.dom.freqBand.value = session.freqBand;
        if (session.threshold) {
            this.dom.threshold.value = session.threshold;
            document.getElementById('thresholdVal').textContent = session.threshold + 'x';
        }
        if (session.minGap) {
            this.dom.minGap.value = session.minGap;
            document.getElementById('minGapVal').textContent = session.minGap + 'ms';
        }
        if (session.smoothWindow) {
            this.dom.smoothWindow.value = session.smoothWindow;
            document.getElementById('smoothVal').textContent = session.smoothWindow + ' frames';
        }

        const setSelect = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
        setSelect('detectAlgorithm', session.detectAlgorithm);
        setSelect('bpmLock', session.bpmLock);
        setSelect('preEmphasis', session.preEmphasis);
        setSelect('multiBand', session.multiBand);
        setSelect('labelTypes', session.labelTypes);

        if (session.onsetSharpness !== undefined) {
            const el = document.getElementById('onsetSharpness');
            if (el) el.value = session.onsetSharpness;
            const valEl = document.getElementById('sharpnessVal');
            if (valEl) valEl.textContent = session.onsetSharpness === 0 ? 'Off' : session.onsetSharpness.toFixed(2);
        }
        if (session.decayRate !== undefined) {
            const el = document.getElementById('decayRate');
            if (el) el.value = session.decayRate;
            const valEl = document.getElementById('decayVal');
            if (valEl) valEl.textContent = session.decayRate.toFixed(1);
        }

        // ── Viz mode ──
        if (session.vizMode) {
            this.visualizer.setMode(session.vizMode);
            document.querySelectorAll('.viz-mode button').forEach(b => {
                b.classList.toggle('active', b.dataset.mode === session.vizMode);
            });
        }

        // ── Reactor effect configs ──
        if (session.reactor) {
            this.effectsPanel.restoreFromSession(session.reactor);
        }

        // ── Overlay visualizer settings (transform + color) ──
        if (session.overlay) {
            const o = session.overlay;
            this.overlayViz.setEnabled(o.enabled ?? true);
            this.overlayViz.setMode(o.mode || 'bars');
            this.overlayViz.setBlendMode(o.blendMode || 'screen');
            this.overlayViz.setOpacity(o.opacity ?? 0.7);
            this.overlayViz.setScale(o.scaleX ?? 1, o.scaleY ?? 1);
            this.overlayViz.setOffset(o.offsetX ?? 0, o.offsetY ?? 0);
            this.overlayViz.setRotation(o.rotation ?? 0);

            // ✅ Restore color settings
            if (o.colorMode) this.overlayViz.setColorMode(o.colorMode);
            if (o.primaryColor) this.overlayViz.setPrimaryColor(o.primaryColor);
            if (o.secondaryColor) this.overlayViz.setSecondaryColor(o.secondaryColor);
            if (o.saturation !== undefined) this.overlayViz.setSaturation(o.saturation);
            if (o.lightness !== undefined) this.overlayViz.setLightness(o.lightness);

            this.overlayViz.applyTransform();

            // Sync UI controls
            const setVal = (id, value) => {
                const el = document.getElementById(id);
                if (el) el.value = value;
            };
            const setText = (id, text) => {
                const el = document.getElementById(id);
                if (el) el.textContent = text;
            };

            const overlayEnabledEl = document.getElementById('overlayEnabled');
            if (overlayEnabledEl) {
                overlayEnabledEl.checked = o.enabled ?? true;
                overlayEnabledEl.parentElement.classList.toggle('active', o.enabled ?? true);
            }
            setVal('overlayMode', o.mode || 'bars');
            setVal('overlayBlend', o.blendMode || 'screen');
            setVal('overlayOpacity', o.opacity ?? 0.7);
            setText('overlayOpacityVal', (o.opacity ?? 0.7).toFixed(2));
            setVal('overlayScaleX', o.scaleX ?? 1);
            setText('overlayScaleXVal', (o.scaleX ?? 1).toFixed(1) + 'x');
            setVal('overlayScaleY', o.scaleY ?? 1);
            setText('overlayScaleYVal', (o.scaleY ?? 1).toFixed(1) + 'x');
            setVal('overlayOffsetX', o.offsetX ?? 0);
            setText('overlayOffsetXVal', (o.offsetX ?? 0) + '%');
            setVal('overlayOffsetY', o.offsetY ?? 0);
            setText('overlayOffsetYVal', (o.offsetY ?? 0) + '%');
            setVal('overlayRotation', o.rotation ?? 0);
            setText('overlayRotationVal', (o.rotation ?? 0) + '°');

            // ECG Cluster settings
            setVal('ecgHeight', o.ecgHeight ?? 0.35);
            setText('ecgHeightVal', (o.ecgHeight ?? 0.35).toFixed(2));
            setVal('ecgSpacing', o.ecgSpacing ?? 0.25);
            setText('ecgSpacingVal', (o.ecgSpacing ?? 0.25).toFixed(2));
            setVal('ecgVertices', o.ecgVertices ?? 500);
            setText('ecgVerticesVal', o.ecgVertices ?? 500);
            setVal('ecgTraces', o.ecgTraces ?? 4);
            setText('ecgTracesVal', o.ecgTraces ?? 4);
            setVal('ecgFreqSeparation', o.ecgFreqSeparation ?? 0.5);
            setText('ecgFreqSeparationVal', (o.ecgFreqSeparation ?? 0.5).toFixed(2));
            setVal('ecgSpikeShape', o.ecgSpikeShape ?? 0.5);
            setText('ecgSpikeShapeVal', (o.ecgSpikeShape ?? 0.5).toFixed(2));

            // ✅ Sync color UI controls
            setSelect('overlayColorMode', o.colorMode || 'rainbow');
            const pcEl = document.getElementById('overlayPrimaryColor');
            if (pcEl && o.primaryColor) pcEl.value = o.primaryColor;
            const scEl = document.getElementById('overlaySecondaryColor');
            if (scEl && o.secondaryColor) scEl.value = o.secondaryColor;
            const satSlider = document.getElementById('overlaySaturation');
            if (satSlider) satSlider.value = o.saturation ?? 100;
            setText('overlaySaturationVal', (o.saturation ?? 100) + '%');
            const lightSlider = document.getElementById('overlayLightness');
            if (lightSlider) lightSlider.value = o.lightness ?? 55;
            setText('overlayLightnessVal', (o.lightness ?? 55) + '%');

            // Trigger color mode visibility update
            const colorModeEl = document.getElementById('overlayColorMode');
            if (colorModeEl) colorModeEl.dispatchEvent(new Event('change'));
        }

        // ── Panner settings ──
        if (session.panner) {
            this.panner.deserialize(session.panner);

            const pannerEnabledEl = document.getElementById('pannerEnabled');
            if (pannerEnabledEl) {
                pannerEnabledEl.checked = this.panner.enabled;
                pannerEnabledEl.parentElement.classList.toggle('active', this.panner.enabled);
            }

            document.querySelectorAll('.pan-mode-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.mode === this.panner.mode);
            });
            const manualGroup = document.getElementById('manualPanGroup');
            if (manualGroup) manualGroup.classList.toggle('active', this.panner.mode === 'manual');

            const setSlider = (id, valId, value, formatter) => {
                const el = document.getElementById(id);
                if (el) el.value = value;
                const valEl = document.getElementById(valId);
                if (valEl) valEl.textContent = formatter(value);
            };

            setSlider('panSpeed', 'panSpeedVal', this.panner.speed, v => v.toFixed(1) + ' Hz');
            setSlider('panIntensity', 'panIntensityVal', this.panner.intensity, v => Math.round(v * 100) + '%');
            setSlider('panSmoothing', 'panSmoothingVal', this.panner.smoothing, v => v.toFixed(2));
            setSlider('panManual', 'panManualVal', this.panner.manualPan, v => {
                return v < -0.05 ? `Left ${Math.round(Math.abs(v) * 100)}%` :
                    v > 0.05 ? `Right ${Math.round(v * 100)}%` : 'Center';
            });
        }

        // ✅ FIXED: Keyframes block — was missing closing brace
        if (session.keyframes) {
            this.keyframes.deserialize(session.keyframes);
            this._rebuildKeyframeUI();
            const kfEnabledEl = document.getElementById('keyframeEnabled');
            if (kfEnabledEl) {
                kfEnabledEl.checked = this.keyframes.enabled;
                kfEnabledEl.parentElement.classList.toggle('active', this.keyframes.enabled);
            }
        }

        // ── Beats + stats ──
        if (session.beats && session.beats.length > 0) {
            this.beats = session.beats;
            document.getElementById('bpmDisplay').textContent = session.bpm || '--';
            document.getElementById('beatCount').textContent = session.beats.length;
            document.getElementById('durationDisplay').textContent = session.duration ? this._fmt(session.duration) : '--';

            // ✅ Updated band names to include all new bands
            const bandNames = {};
            if (BeatDetector.BANDS) {
                Object.entries(BeatDetector.BANDS).forEach(([k, v]) => {
                    bandNames[k] = v ? v.label.split('(')[0].trim() : 'Full Spectrum';
                });
            }
            document.getElementById('bandDisplay').textContent = bandNames[session.freqBand] || session.freqBand || '--';

            // Restore algo display
            const algoEl = document.getElementById('algoDisplay');
            if (algoEl && session.detectAlgorithm) {
                const algoSelect = document.getElementById('detectAlgorithm');
                if (algoSelect) algoEl.textContent = algoSelect.selectedOptions[0]?.text.split('(')[0].trim() || session.detectAlgorithm;
            }

            // Restore type display
            const types = { kick: 0, snare: 0, hat: 0, other: 0, unknown: 0 };
            this.beats.forEach(b => { types[b.type] = (types[b.type] || 0) + 1; });
            const labeled = types.kick + types.snare + types.hat;
            const typeEl = document.getElementById('typeDisplay');
            if (typeEl) typeEl.textContent = labeled > 0 ? `${types.kick}/${types.snare}/${types.hat}` : 'N/A';

            this.dom.statsSection.classList.remove('hidden');
            this.dom.exportBtn.disabled = false;
            this._populateBeatList();
        }

        // ── Audio file from IndexedDB ──
        const audioBlob = await SessionStore.loadBlob('audio');
        if (audioBlob && session.audioFileName) {
            try {
                const file = new File([audioBlob], session.audioFileName, { type: audioBlob.type });
                await this.engine.load(file);
                this.panner.init();
                if (session.panner) {
                    this.panner.deserialize(session.panner);
                    this.panner.setMode(this.panner.mode);
                }
                this.currentAudioFile = file;
                this.dom.playBtn.disabled = false;
                this.dom.mainSection.classList.remove('hidden');

                if (this.beats.length > 0) {
                    const result = await BeatDetector.detect(this.engine.buffer, {
                        band: session.freqBand || 'bass',
                        threshold: session.threshold || 1.4,
                        minGapMs: session.minGap || 200,
                        windowSize: session.smoothWindow || 40,
                        algorithm: session.detectAlgorithm || 'energy',
                        onsetSharpness: session.onsetSharpness || 0,
                        decayRate: session.decayRate || 0.5,
                        bpmLock: session.bpmLock === 'on',
                        preEmphasis: session.preEmphasis === 'on',
                        multiBand: session.multiBand === 'on',
                        labelTypes: session.labelTypes === 'on',
                    });
                    this.filteredData = result.filteredData;
                }

                this._redrawWaveform();

                if (session.playbackPosition) {
                    this.engine.startOffset = Math.min(session.playbackPosition, this.engine.duration);
                    this._updatePlayheads(this.engine.startOffset);
                    this.dom.timeDisplay.textContent = this._fmt(this.engine.startOffset);
                }

                console.log(`   ✅ Audio restored: ${session.audioFileName}`);
            } catch (err) {
                console.warn('   ⚠️ Audio restore failed:', err);
            }
        }

                // Restore volume
        if (session.volume !== undefined) {
            this.engine.setVolume(session.volume);
            const vs = document.getElementById('volumeSlider');
            if (vs) { vs.value = session.volume; vs.style.setProperty('--vol-pct', (session.volume*100)+'%'); }
            const vv = document.getElementById('volumeVal');
            if (vv) vv.textContent = Math.round(session.volume*100) + '%';
            const vi = document.getElementById('volumeIcon');
            if (vi) {
                vi.textContent = session.volume === 0 ? '🔇' : session.volume < 0.3 ? '🔈' : session.volume < 0.7 ? '🔉' : '🔊';
                vi.classList.toggle('muted', session.volume === 0);
            }
        }

        // ── Media file from IndexedDB ──
        const mediaBlob = await SessionStore.loadBlob('media');
        if (mediaBlob && session.mediaFileName) {
            try {
                const file = new File([mediaBlob], session.mediaFileName, { type: mediaBlob.type });
                await this.reactor.loadMedia(file);
                this.vizBg.setMedia(this.reactor.mediaEl);
                this.currentMediaFile = file;
                document.getElementById('reactorPlaceholder').style.display = 'none';

                if (session.reactor) {
                    this.effectsPanel.restoreFromSession(session.reactor);
                }

                console.log(`   ✅ Media restored: ${session.mediaFileName} (${session.mediaType})`);
            } catch (err) {
                console.warn('   ⚠️ Media restore failed:', err);
            }
        }

        // Restore media transform settings
        if (session.reactor) {
            const r = session.reactor;
            if (r.videoLoop !== undefined) {
                this.reactor.setVideoLoop(r.videoLoop);
                const el = document.getElementById('videoLoop');
                if (el) { el.checked = r.videoLoop; el.parentElement.classList.toggle('active', r.videoLoop); }
            }
            if (r.mediaScaleX !== undefined) { this.reactor.setMediaScaleX(r.mediaScaleX); const el = document.getElementById('mediaScaleX'); if (el) el.value = r.mediaScaleX; const v = document.getElementById('mediaScaleXVal'); if (v) v.textContent = r.mediaScaleX.toFixed(1) + 'x'; }
            if (r.mediaScaleY !== undefined) { this.reactor.setMediaScaleY(r.mediaScaleY); const el = document.getElementById('mediaScaleY'); if (el) el.value = r.mediaScaleY; const v = document.getElementById('mediaScaleYVal'); if (v) v.textContent = r.mediaScaleY.toFixed(1) + 'x'; }
            if (r.mediaRotate !== undefined) { this.reactor.setMediaRotate(r.mediaRotate); const el = document.getElementById('mediaRotate'); if (el) el.value = r.mediaRotate; const v = document.getElementById('mediaRotateVal'); if (v) v.textContent = r.mediaRotate + '°'; }
            if (r.mediaOffsetX !== undefined) { this.reactor.setMediaOffsetX(r.mediaOffsetX); const el = document.getElementById('mediaOffsetX'); if (el) el.value = r.mediaOffsetX; const v = document.getElementById('mediaOffsetXVal'); if (v) v.textContent = r.mediaOffsetX + '%'; }
            if (r.mediaOffsetY !== undefined) { this.reactor.setMediaOffsetY(r.mediaOffsetY); const el = document.getElementById('mediaOffsetY'); if (el) el.value = r.mediaOffsetY; const v = document.getElementById('mediaOffsetYVal'); if (v) v.textContent = r.mediaOffsetY + '%'; }
            if (r.mediaFlipH) { this.reactor.setMediaFlipH(true); const el = document.getElementById('mediaFlipH'); if (el) el.classList.add('active'); }
            if (r.mediaFlipV) { this.reactor.setMediaFlipV(true); const el = document.getElementById('mediaFlipV'); if (el) el.classList.add('active'); }
        }

        if (session.vizSyncBand) {
            this.overlayViz.setVizSyncBand(session.vizSyncBand);
            const el = document.getElementById('vizSyncBand');
            if (el) el.value = session.vizSyncBand;
        }

        this._showRestoreToast();
    }

    _populateBeatList() {
        this.dom.beatList.innerHTML = '';
        this.dom.beatList.classList.remove('hidden');
        this.beats.forEach((beat, i) => {
            const el = document.createElement('div');
            el.className = 'beat-item';
            el.dataset.time = beat.time;
            if (beat.type && beat.type !== 'unknown') el.dataset.type = beat.type;

            const typeBadge = beat.type && beat.type !== 'unknown'
                ? `<span class="beat-type-badge ${beat.type}">${beat.type}</span>`
                : '';

            el.innerHTML = `
                <span class="beat-time">#${i + 1} ${this._fmt(beat.time)} ${typeBadge}</span>
                <div style="display:flex;align-items:center;gap:8px">
                    <div class="beat-strength">
                        <div class="beat-strength-fill" style="width:${Math.min(100, beat.strength * 40)}%"></div>
                    </div>
                    <button class="beat-delete-btn" data-beat-idx="${i}" title="Delete this beat">✕</button>
                </div>`;

            el.onclick = (e) => {
                if (e.target.classList.contains('beat-delete-btn')) return;
                this._seekTo(beat.time);
            };

            // ✅ Delete button in beat list
            el.querySelector('.beat-delete-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                this.undoManager.push(this.beats);  // ✅ Save state before change
                this.beats.splice(i, 1);
                this._redrawWaveform();
                this._populateBeatList();
                this._showStats();
                this._triggerSave();
                this._updateUndoRedoUI();
            });

            this.dom.beatList.appendChild(el);
        });
    }

    _showRestoreToast() {
        const toast = document.createElement('div');
        toast.className = 'restore-toast';
        toast.innerHTML = '✅ Previous session restored';
        document.body.appendChild(toast);
        setTimeout(() => toast.classList.add('visible'), 100);
        setTimeout(() => {
            toast.classList.remove('visible');
            setTimeout(() => toast.remove(), 400);
        }, 3000);
    }

    /* ── Event Binding ─────────────────────────────── */
    _bindEvents() {

                // ── Volume Control ────────────────────────────────
        const volumeSlider = document.getElementById('volumeSlider');
        const volumeIcon = document.getElementById('volumeIcon');
        const volumeVal = document.getElementById('volumeVal');
        let previousVolume = 1.0; // For mute/unmute toggle

        if (volumeSlider) {
            // Set initial track fill
            volumeSlider.style.setProperty('--vol-pct', '100%');

            volumeSlider.addEventListener('input', (e) => {
                const v = parseFloat(e.target.value);
                this.engine.setVolume(v);
                volumeVal.textContent = Math.round(v * 100) + '%';
                volumeSlider.style.setProperty('--vol-pct', (v * 100) + '%');

                // Update icon
                if (v === 0) {
                    volumeIcon.textContent = '🔇';
                    volumeIcon.classList.add('muted');
                } else if (v < 0.3) {
                    volumeIcon.textContent = '🔈';
                    volumeIcon.classList.remove('muted');
                } else if (v < 0.7) {
                    volumeIcon.textContent = '🔉';
                    volumeIcon.classList.remove('muted');
                } else {
                    volumeIcon.textContent = '🔊';
                    volumeIcon.classList.remove('muted');
                }

                if (v > 0) previousVolume = v;
                this._triggerSave();
            });
        }

        // Mute/unmute toggle on icon click
        if (volumeIcon) {
            volumeIcon.addEventListener('click', () => {
                if (this.engine.volume > 0) {
                    // Mute
                    previousVolume = this.engine.volume;
                    this.engine.setVolume(0);
                    volumeSlider.value = 0;
                    volumeVal.textContent = '0%';
                    volumeSlider.style.setProperty('--vol-pct', '0%');
                    volumeIcon.textContent = '🔇';
                    volumeIcon.classList.add('muted');
                } else {
                    // Unmute — restore previous volume
                    this.engine.setVolume(previousVolume);
                    volumeSlider.value = previousVolume;
                    volumeVal.textContent = Math.round(previousVolume * 100) + '%';
                    volumeSlider.style.setProperty('--vol-pct', (previousVolume * 100) + '%');
                    volumeIcon.textContent = previousVolume < 0.3 ? '🔈' : previousVolume < 0.7 ? '🔉' : '🔊';
                    volumeIcon.classList.remove('muted');
                }
                this._triggerSave();
            });
        }

                // ── Media Transform Controls ──────────────────────
        const videoLoopEl = document.getElementById('videoLoop');
        if (videoLoopEl) {
            videoLoopEl.addEventListener('change', (e) => {
                this.reactor.setVideoLoop(e.target.checked);
                e.target.parentElement.classList.toggle('active', e.target.checked);
                this._triggerSave();
            });
        }

        const safeBindMedia = (id, handler) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', handler);
        };

        safeBindMedia('mediaScaleX', (e) => {
            const v = parseFloat(e.target.value);
            document.getElementById('mediaScaleXVal').textContent = v.toFixed(1) + 'x';
            this.reactor.setMediaScaleX(v);
            this._triggerSave();
        });

        safeBindMedia('mediaScaleY', (e) => {
            const v = parseFloat(e.target.value);
            document.getElementById('mediaScaleYVal').textContent = v.toFixed(1) + 'x';
            this.reactor.setMediaScaleY(v);
            this._triggerSave();
        });

        safeBindMedia('mediaRotate', (e) => {
            const v = parseInt(e.target.value);
            document.getElementById('mediaRotateVal').textContent = v + '°';
            this.reactor.setMediaRotate(v);
            this._triggerSave();
        });

        safeBindMedia('mediaOffsetX', (e) => {
            const v = parseInt(e.target.value);
            document.getElementById('mediaOffsetXVal').textContent = v + '%';
            this.reactor.setMediaOffsetX(v);
            this._triggerSave();
        });

        safeBindMedia('mediaOffsetY', (e) => {
            const v = parseInt(e.target.value);
            document.getElementById('mediaOffsetYVal').textContent = v + '%';
            this.reactor.setMediaOffsetY(v);
            this._triggerSave();
        });

        // Flip buttons (toggle)
        const flipHBtn = document.getElementById('mediaFlipH');
        if (flipHBtn) {
            flipHBtn.addEventListener('click', () => {
                this.reactor.setMediaFlipH(!this.reactor.mediaFlipH);
                flipHBtn.classList.toggle('active', this.reactor.mediaFlipH);
                this._triggerSave();
            });
        }

        const flipVBtn = document.getElementById('mediaFlipV');
        if (flipVBtn) {
            flipVBtn.addEventListener('click', () => {
                this.reactor.setMediaFlipV(!this.reactor.mediaFlipV);
                flipVBtn.classList.toggle('active', this.reactor.mediaFlipV);
                this._triggerSave();
            });
        }

        // Reset transform button
        const resetTransformBtn = document.getElementById('mediaResetTransform');
        if (resetTransformBtn) {
            resetTransformBtn.addEventListener('click', () => {
                this.reactor.setMediaScaleX(1.0);
                this.reactor.setMediaScaleY(1.0);
                this.reactor.setMediaRotate(0);
                this.reactor.setMediaOffsetX(0);
                this.reactor.setMediaOffsetY(0);
                this.reactor.setMediaFlipH(false);
                this.reactor.setMediaFlipV(false);

                document.getElementById('mediaScaleX').value = 1.0;
                document.getElementById('mediaScaleXVal').textContent = '1.0x';
                document.getElementById('mediaScaleY').value = 1.0;
                document.getElementById('mediaScaleYVal').textContent = '1.0x';
                document.getElementById('mediaRotate').value = 0;
                document.getElementById('mediaRotateVal').textContent = '0°';
                document.getElementById('mediaOffsetX').value = 0;
                document.getElementById('mediaOffsetXVal').textContent = '0%';
                document.getElementById('mediaOffsetY').value = 0;
                document.getElementById('mediaOffsetYVal').textContent = '0%';
                if (flipHBtn) flipHBtn.classList.remove('active');
                if (flipVBtn) flipVBtn.classList.remove('active');

                this._triggerSave();
            });
        }

                // ── Mirror Controls ───────────────────────────────
        const mirrorH = document.getElementById('mirrorH');
        if (mirrorH) {
            mirrorH.addEventListener('change', (e) => {
                this.reactor.setMirrorH(e.target.checked);
                e.target.parentElement.classList.toggle('active', e.target.checked);
                this._triggerSave();
            });
        }

        const mirrorV = document.getElementById('mirrorV');
        if (mirrorV) {
            mirrorV.addEventListener('change', (e) => {
                this.reactor.setMirrorV(e.target.checked);
                e.target.parentElement.classList.toggle('active', e.target.checked);
                this._triggerSave();
            });
        }

        const mirrorQuad = document.getElementById('mirrorQuad');
        if (mirrorQuad) {
            mirrorQuad.addEventListener('change', (e) => {
                this.reactor.setMirrorQuad(e.target.checked);
                e.target.parentElement.classList.toggle('active', e.target.checked);
                // Quad overrides individual H/V
                if (e.target.checked) {
                    this.reactor.setMirrorH(true);
                    this.reactor.setMirrorV(true);
                    if (mirrorH) { mirrorH.checked = true; mirrorH.parentElement.classList.add('active'); }
                    if (mirrorV) { mirrorV.checked = true; mirrorV.parentElement.classList.add('active'); }
                }
                this._triggerSave();
            });
        }

        const mirrorGapEl = document.getElementById('mirrorGap');
        if (mirrorGapEl) {
            mirrorGapEl.addEventListener('input', (e) => {
                const v = parseInt(e.target.value);
                document.getElementById('mirrorGapVal').textContent = v + 'px';
                this.reactor.setMirrorGap(v);
                this._triggerSave();
            });
        }

        const mirrorOpacityEl = document.getElementById('mirrorOpacity');
        if (mirrorOpacityEl) {
            mirrorOpacityEl.addEventListener('input', (e) => {
                const v = parseFloat(e.target.value);
                document.getElementById('mirrorOpacityVal').textContent = v.toFixed(2);
                this.reactor.setMirrorOpacity(v);
                this._triggerSave();
            });
        }

        // ── Waveform Zoom Controls ────────────────────────
        document.getElementById('zoomInBtn').addEventListener('click', () => {
            this.waveform.setZoom(this.waveform.zoomLevel * 1.5);
        });
        document.getElementById('zoomOutBtn').addEventListener('click', () => {
            this.waveform.setZoom(this.waveform.zoomLevel / 1.5);
        });
        document.getElementById('zoomResetBtn').addEventListener('click', () => {
            this.waveform.resetZoom();
        });
        document.getElementById('zoomSlider').addEventListener('input', (e) => {
            this.waveform.setZoom(parseFloat(e.target.value));
        });

        document.getElementById('audioInput').addEventListener('change', e => this._loadAudio(e));
        this.dom.playBtn.addEventListener('click', () => this._togglePlay());
        this.dom.analyzeBtn.addEventListener('click', () => this._detectBeats());
        this.dom.exportBtn.addEventListener('click', () => this._exportCSV());

        // Viz mode selector
        document.querySelectorAll('.viz-mode button').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.viz-mode button').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.visualizer.setMode(btn.dataset.mode);
                this._triggerSave();
            });
        });

        // ── Effect Pagination + Overlay Page Toggle ───────
        document.querySelectorAll('.page-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.page-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const page = btn.dataset.page;

                const effectsGrid = document.getElementById('effectsGrid');
                const overlayPage = document.getElementById('overlayPageContent');

                if (page === 'overlay') {
                    // Show overlay controls, hide effects grid
                    effectsGrid.style.display = 'none';
                    overlayPage.classList.remove('hidden');
                } else {
                    // Show effects grid, hide overlay controls
                    effectsGrid.style.display = '';
                    overlayPage.classList.add('hidden');
                    this.effectsPanel.setPage(page);
                    this.effectsPanel._onSettingsChange = () => this._triggerSave();
                }
            });
        });

                // ── Master Intensity (lives outside effectsGrid, must bind here) ──
        const masterSlider = document.getElementById('masterIntensity');
        if (masterSlider) {
            masterSlider.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                document.getElementById('masterIntensityVal').textContent = val.toFixed(1) + 'x';
                this.reactor.setMasterIntensity(val);
                this._triggerSave();
            });
        }

        // Detection settings — auto-redetect on change
        const autoDetectEl = document.getElementById('autoDetect');
        let autoDetectTimer = null;

        const triggerAutoDetect = () => {
            if (!autoDetectEl || autoDetectEl.value !== 'on') return;
            if (!this.engine.buffer) return;
            clearTimeout(autoDetectTimer);
            autoDetectTimer = setTimeout(() => this._detectBeats(), 500);
        };

        // All sliders that trigger auto-detect
        const autoDetectSliders = ['threshold', 'minGap', 'smoothWindow', 'onsetSharpness', 'decayRate'];
        const sliderLabels = {
            threshold: ['thresholdVal', 'x'],
            minGap: ['minGapVal', 'ms'],
            smoothWindow: ['smoothVal', ' frames'],
            onsetSharpness: ['sharpnessVal', ''],
            decayRate: ['decayVal', ''],
        };

        autoDetectSliders.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('input', e => {
                const [valId, suffix] = sliderLabels[id];
                const valEl = document.getElementById(valId);
                if (valEl) {
                    const v = parseFloat(e.target.value);
                    valEl.textContent = id === 'onsetSharpness'
                        ? (v === 0 ? 'Off' : v.toFixed(2))
                        : v.toFixed(id === 'decayRate' ? 1 : id === 'threshold' ? 1 : 0) + suffix;
                }
                triggerAutoDetect();
            });
        });

        // All selects that trigger auto-detect
        ['freqBand', 'detectAlgorithm', 'bpmLock', 'preEmphasis', 'multiBand', 'labelTypes'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('change', triggerAutoDetect);
        });

        if (autoDetectEl) {
            autoDetectEl.addEventListener('change', () => {
                if (autoDetectEl.value === 'on' && this.engine.buffer) this._detectBeats();
            });
        }

        // Timeline interaction - use stored bound handlers for proper cleanup
        this.dom.timelineContainer.addEventListener('mousedown', e => this._onDown(e));
        this.dom.timelineContainer.addEventListener('contextmenu', (e) => {
            e.preventDefault();  // ✅ Allow right-click beat deletion
        });
        window.addEventListener('mousemove', this._boundHandlers.windowMousemove);
        window.addEventListener('mouseup', this._boundHandlers.windowMouseup);
        this.dom.timelineContainer.addEventListener('mouseenter', () => this.dom.tooltip.style.opacity = '1');
        this.dom.timelineContainer.addEventListener('mouseleave', () => {
            if (!this.isDragging) this.dom.tooltip.style.opacity = '0';
        });

        // Viz Canvas as audio scrubber
        const vizPanel = document.querySelector('.viz-panel');
        if (vizPanel) {
            vizPanel.addEventListener('mousedown', (e) => this._onVizMouseDown(e));
            vizPanel.addEventListener('mousemove', (e) => this._onVizMouseMove(e));
            vizPanel.addEventListener('mouseup', () => this._onVizMouseUp());
            vizPanel.addEventListener('click', (e) => this._onVizClick(e));
            // Prevent context menu on right-click
            vizPanel.addEventListener('contextmenu', (e) => e.preventDefault());
        }

        // Audio end callback
        this.engine.onEnded = () => {
            this._updatePlayheads(0);
            this.dom.timeDisplay.textContent = this._fmt(0);
            this._triggerSave();
        };

        // Keyboard shortcuts
        // ✅ CRITICAL: passive:false ensures preventDefault() works for Space/Arrow keys
        window.addEventListener('keydown', this._boundHandlers.windowKeydown, { passive: false });

        // ── Media upload ──────────────────────────────
        const mediaInput = document.getElementById('mediaInput');
        if (mediaInput) {
            mediaInput.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                this.currentMediaFile = file;
                await this.reactor.loadMedia(file);
                this.vizBg.setMedia(this.reactor.mediaEl);
                const reactorPlaceholder = document.getElementById('reactorPlaceholder');
                if (reactorPlaceholder) reactorPlaceholder.style.display = 'none';
                await SessionStore.saveBlob('media', file);
                this._triggerSave();
            });
        }

        // ── Overlay Visualizer Controls ───────────────
        const overlayEnabledEl = document.getElementById('overlayEnabled');
        if (overlayEnabledEl) {
            overlayEnabledEl.addEventListener('change', (e) => {
                const enabled = e.target.checked;
                e.target.parentElement.classList.toggle('active', enabled);
                this.overlayViz.setEnabled(enabled);
                this._triggerSave();
            });
        }

        const bindOverlaySelect = (id, method) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('change', (e) => { this.overlayViz[method](e.target.value); this.overlayViz.applyTransform(); this._triggerSave(); });
        };
        bindOverlaySelect('overlayMode', 'setMode');
        bindOverlaySelect('overlayBlend', 'setBlendMode');

        const bindOverlaySlider = (id, valId, method, formatter, extraArg) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('input', (e) => {
                const v = parseFloat(e.target.value);
                const valEl = document.getElementById(valId);
                if (valEl) valEl.textContent = formatter(v);
                if (extraArg !== undefined) {
                    this.overlayViz[method](extraArg === 'scaleY' ? this.overlayViz.scaleX : v, extraArg === 'scaleY' ? v : this.overlayViz.offsetY);
                } else {
                    this.overlayViz[method](v);
                }
                this.overlayViz.applyTransform();
                this._triggerSave();
            });
        };

        // Simpler explicit bindings to avoid confusion
        const safeBind = (id, handler) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', handler);
        };

        safeBind('overlayOpacity', (e) => {
            const v = parseFloat(e.target.value);
            document.getElementById('overlayOpacityVal').textContent = v.toFixed(2);
            this.overlayViz.setOpacity(v);
            this.overlayViz.applyTransform();
            this._triggerSave();
        });

        safeBind('overlayScaleX', (e) => {
            const v = parseFloat(e.target.value);
            document.getElementById('overlayScaleXVal').textContent = v.toFixed(1) + 'x';
            this.overlayViz.setScale(v, this.overlayViz.scaleY);
            this.overlayViz.applyTransform();
            this._triggerSave();
        });

        safeBind('overlayScaleY', (e) => {
            const v = parseFloat(e.target.value);
            document.getElementById('overlayScaleYVal').textContent = v.toFixed(1) + 'x';
            this.overlayViz.setScale(this.overlayViz.scaleX, v);
            this.overlayViz.applyTransform();
            this._triggerSave();
        });

        safeBind('overlayOffsetX', (e) => {
            const v = parseInt(e.target.value);
            document.getElementById('overlayOffsetXVal').textContent = v + '%';
            this.overlayViz.setOffset(v, this.overlayViz.offsetY);
            this.overlayViz.applyTransform();
            this._triggerSave();
        });

        safeBind('overlayOffsetY', (e) => {
            const v = parseInt(e.target.value);
            document.getElementById('overlayOffsetYVal').textContent = v + '%';
            this.overlayViz.setOffset(this.overlayViz.offsetX, v);
            this.overlayViz.applyTransform();
            this._triggerSave();
        });

        safeBind('overlayRotation', (e) => {
            const v = parseInt(e.target.value);
            document.getElementById('overlayRotationVal').textContent = v + '°';
            this.overlayViz.setRotation(v);
            this.overlayViz.applyTransform();
            this._triggerSave();
        });

        // ECG Cluster Settings visibility toggle based on mode
        const overlayModeEl = document.getElementById('overlayMode');
        const ecgSettingsGroup = document.getElementById('ecgSettingsGroup');
        if (overlayModeEl && ecgSettingsGroup) {
            const toggleECGSettings = () => {
                const isECG = overlayModeEl.value === 'ecgCluster';
                ecgSettingsGroup.style.display = isECG ? 'block' : 'none';
            };
            overlayModeEl.addEventListener('change', toggleECGSettings);
            toggleECGSettings(); // Initial check
        }

        // ECG Cluster settings bindings
        safeBind('ecgHeight', (e) => {
            const v = parseFloat(e.target.value);
            document.getElementById('ecgHeightVal').textContent = v.toFixed(2);
            this.overlayViz.setECGHeight(v);
            this._triggerSave();
        });

        safeBind('ecgSpacing', (e) => {
            const v = parseFloat(e.target.value);
            document.getElementById('ecgSpacingVal').textContent = v.toFixed(2);
            this.overlayViz.setECGSpacing(v);
            this._triggerSave();
        });

        safeBind('ecgVertices', (e) => {
            const v = parseInt(e.target.value);
            document.getElementById('ecgVerticesVal').textContent = v;
            this.overlayViz.setECGVertices(v);
            this._triggerSave();
        });

        safeBind('ecgTraces', (e) => {
            const v = parseInt(e.target.value);
            document.getElementById('ecgTracesVal').textContent = v;
            this.overlayViz.setECGTraces(v);
            this._triggerSave();
        });

        safeBind('ecgFreqSeparation', (e) => {
            const v = parseFloat(e.target.value);
            document.getElementById('ecgFreqSeparationVal').textContent = v.toFixed(2);
            this.overlayViz.setECGFreqSeparation(v);
            this._triggerSave();
        });

        safeBind('ecgSpikeShape', (e) => {
            const v = parseFloat(e.target.value);
            document.getElementById('ecgSpikeShapeVal').textContent = v.toFixed(2);
            this.overlayViz.setECGSpikeShape(v);
            this._triggerSave();
        });

                // ── Overlay Color Controls ────────────────────────
        const colorModeEl = document.getElementById('overlayColorMode');
        if (colorModeEl) {
            colorModeEl.addEventListener('change', (e) => {
                const mode = e.target.value;
                this.overlayViz.setColorMode(mode);

                // Show/hide relevant controls
                const primaryGroup = document.getElementById('primaryColorGroup');
                const secondaryGroup = document.getElementById('secondaryColorGroup');
                const satGroup = document.getElementById('saturationGroup');
                const lightGroup = document.getElementById('lightnessGroup');

                if (mode === 'solid') {
                    primaryGroup.style.display = '';
                    secondaryGroup.style.display = 'none';
                    satGroup.style.display = 'none';
                    lightGroup.style.display = 'none';
                } else if (mode === 'gradient') {
                    primaryGroup.style.display = '';
                    secondaryGroup.style.display = '';
                    satGroup.style.display = 'none';
                    lightGroup.style.display = 'none';
                } else {
                    // rainbow or beat
                    primaryGroup.style.display = 'none';
                    secondaryGroup.style.display = 'none';
                    satGroup.style.display = '';
                    lightGroup.style.display = '';
                }
                this._triggerSave();
            });
        }

        const primaryColorEl = document.getElementById('overlayPrimaryColor');
        if (primaryColorEl) {
            primaryColorEl.addEventListener('input', (e) => {
                this.overlayViz.setPrimaryColor(e.target.value);
                this._triggerSave();
            });
        }

        const secondaryColorEl = document.getElementById('overlaySecondaryColor');
        if (secondaryColorEl) {
            secondaryColorEl.addEventListener('input', (e) => {
                this.overlayViz.setSecondaryColor(e.target.value);
                this._triggerSave();
            });
        }

        const satEl = document.getElementById('overlaySaturation');
        if (satEl) {
            satEl.addEventListener('input', (e) => {
                const v = parseInt(e.target.value);
                document.getElementById('overlaySaturationVal').textContent = v + '%';
                this.overlayViz.setSaturation(v);
                this._triggerSave();
            });
        }

        const lightEl = document.getElementById('overlayLightness');
        if (lightEl) {
            lightEl.addEventListener('input', (e) => {
                const v = parseInt(e.target.value);
                document.getElementById('overlayLightnessVal').textContent = v + '%';
                this.overlayViz.setLightness(v);
                this._triggerSave();
            });
        }

        // Color presets
        const colorPresets = {
            'neon':        { mode: 'rainbow',  primary: '#00ff88', secondary: '#ff00ff', sat: 100, light: 55 },
            'fire':        { mode: 'gradient', primary: '#ff4400', secondary: '#ffcc00', sat: 100, light: 55 },
            'ice':         { mode: 'gradient', primary: '#00ccff', secondary: '#ffffff', sat: 80,  light: 65 },
            'matrix':      { mode: 'solid',    primary: '#00ff41', secondary: '#00ff41', sat: 100, light: 50 },
            'sunset':      { mode: 'gradient', primary: '#ff6b35', secondary: '#f7c59f', sat: 90,  light: 55 },
            'purple-haze': { mode: 'gradient', primary: '#8b00ff', secondary: '#ff1493', sat: 100, light: 50 },
            'white':       { mode: 'solid',    primary: '#ffffff', secondary: '#ffffff', sat: 0,   light: 80 },
            'reset-color': { mode: 'rainbow',  primary: '#00d4ff', secondary: '#ff3366', sat: 100, light: 55 },
            // ✅ Phonk preset — sets overlay mode + blend + colors all at once
            'phonk':       { mode: 'rainbow',  primary: '#ff0044', secondary: '#00d4ff', sat: 100, light: 55, vizMode: 'glitchSpectrum', blendMode: 'screen', opacity: 0.6 },
        };

        document.querySelectorAll('[data-color-preset]').forEach(btn => {
            btn.addEventListener('click', () => {
                const preset = colorPresets[btn.dataset.colorPreset];
                if (!preset) return;

                this.overlayViz.setColorMode(preset.mode);
                this.overlayViz.setPrimaryColor(preset.primary);
                this.overlayViz.setSecondaryColor(preset.secondary);
                this.overlayViz.setSaturation(preset.sat);
                this.overlayViz.setLightness(preset.light);

                // Sync UI
                document.getElementById('overlayColorMode').value = preset.mode;
                document.getElementById('overlayPrimaryColor').value = preset.primary;
                document.getElementById('overlaySecondaryColor').value = preset.secondary;
                document.getElementById('overlaySaturation').value = preset.sat;
                document.getElementById('overlaySaturationVal').textContent = preset.sat + '%';
                document.getElementById('overlayLightness').value = preset.light;
                document.getElementById('overlayLightnessVal').textContent = preset.light + '%';

                // Trigger visibility update
                colorModeEl.dispatchEvent(new Event('change'));
                this._triggerSave();
            });
        });

        // Reset overlay button
        const resetBtn = document.getElementById('resetOverlayBtn');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                this.overlayViz.setOpacity(0.7);
                this.overlayViz.setBlendMode('screen');
                this.overlayViz.setScale(1.0, 1.0);
                this.overlayViz.setOffset(0, 0);
                this.overlayViz.setRotation(0);
                this.overlayViz.setMode('bars');
                this.overlayViz.applyTransform();

                const resets = [
                    ['overlayOpacity', 0.7, '0.70'],
                    ['overlayScaleX', 1.0, '1.0x'],
                    ['overlayScaleY', 1.0, '1.0x'],
                    ['overlayOffsetX', 0, '0%'],
                    ['overlayOffsetY', 0, '0%'],
                    ['overlayRotation', 0, '0°'],
                ];
                resets.forEach(([id, val, text]) => {
                    const el = document.getElementById(id);
                    if (el) el.value = val;
                    const valEl = document.getElementById(id + 'Val');
                    if (valEl) valEl.textContent = text;
                });
                const modeEl = document.getElementById('overlayMode');
                if (modeEl) modeEl.value = 'bars';
                const blendEl = document.getElementById('overlayBlend');
                if (blendEl) blendEl.value = 'screen';

                this._triggerSave();
            });
        }

        // ── Clear Session Button ──────────────────────
        const clearBtn = document.getElementById('clearSessionBtn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                if (confirm('Clear saved session? This cannot be undone.')) {
                    SessionStore.clearSession();
                    location.reload();
                }
            });
        }

        // Save before page unload - use stored bound handler for proper cleanup
        window.addEventListener('beforeunload', this._boundHandlers.beforeunload);

        // ── Video Export Controls ─────────────────────
        const startExportBtn = document.getElementById('startExportBtn');
        if (startExportBtn) startExportBtn.addEventListener('click', () => this._startExport());

        const cancelExportBtn = document.getElementById('cancelExportBtn');
        if (cancelExportBtn) cancelExportBtn.addEventListener('click', () => this._cancelExport());

        const exportDurationEl = document.getElementById('exportDuration');
        if (exportDurationEl) {
            exportDurationEl.addEventListener('change', (e) => {
                if (e.target.value === 'custom') {
                    const val = prompt('Enter custom duration in seconds:', '45');
                    if (val && !isNaN(val) && parseInt(val) > 0) {
                        e.target.dataset.customValue = parseInt(val);
                    } else {
                        e.target.value = '30';
                    }
                }
            });
        }

                // ── Audio Panning Controls ────────────────────────
        const pannerEnabledEl = document.getElementById('pannerEnabled');
        if (pannerEnabledEl) {
            pannerEnabledEl.addEventListener('change', (e) => {
                const enabled = e.target.checked;
                e.target.parentElement.classList.toggle('active', enabled);
                this.panner.setEnabled(enabled);
                this._triggerSave();
            });
        }

        // Mode buttons
        document.querySelectorAll('.pan-mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.pan-mode-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const mode = btn.dataset.mode;
                this.panner.setMode(mode);

                // Enable/disable manual slider
                const manualGroup = document.getElementById('manualPanGroup');
                if (manualGroup) manualGroup.classList.toggle('active', mode === 'manual');

                this._triggerSave();
            });
        });

        // Speed
        const panSpeedEl = document.getElementById('panSpeed');
        if (panSpeedEl) {
            panSpeedEl.addEventListener('input', (e) => {
                const v = parseFloat(e.target.value);
                document.getElementById('panSpeedVal').textContent = v.toFixed(1) + ' Hz';
                this.panner.setSpeed(v);
                this._triggerSave();
            });
        }

        // Intensity
        const panIntensityEl = document.getElementById('panIntensity');
        if (panIntensityEl) {
            panIntensityEl.addEventListener('input', (e) => {
                const v = parseFloat(e.target.value);
                document.getElementById('panIntensityVal').textContent = Math.round(v * 100) + '%';
                this.panner.setIntensity(v);
                this._triggerSave();
            });
        }

        // Smoothing
        const panSmoothingEl = document.getElementById('panSmoothing');
        if (panSmoothingEl) {
            panSmoothingEl.addEventListener('input', (e) => {
                const v = parseFloat(e.target.value);
                document.getElementById('panSmoothingVal').textContent = v.toFixed(2);
                this.panner.setSmoothing(v);
                this._triggerSave();
            });
        }

        // Manual pan
        const panManualEl = document.getElementById('panManual');
        if (panManualEl) {
            panManualEl.addEventListener('input', (e) => {
                const v = parseFloat(e.target.value);
                const label = v < -0.05 ? `Left ${Math.round(Math.abs(v) * 100)}%` :
                            v > 0.05 ? `Right ${Math.round(v * 100)}%` : 'Center';
                document.getElementById('panManualVal').textContent = label;
                this.panner.setManualPan(v);
                this._triggerSave();
            });
        }

        // Pan presets
        const panPresets = {
            'slow-sweep':  { mode: 'loop',    speed: 0.3, intensity: 1.0, smoothing: 0.08 },
            'fast-bounce': { mode: 'bounce',  speed: 3.0, intensity: 1.0, smoothing: 0.02 },
            'subtle-drift':{ mode: 'loop',    speed: 0.15,intensity: 0.3, smoothing: 0.12 },
            'hard-left':   { mode: 'left',    speed: 1.0, intensity: 1.0, smoothing: 0.03 },
            'hard-right':  { mode: 'right',   speed: 1.0, intensity: 1.0, smoothing: 0.03 },
            'chaos':       { mode: 'random',  speed: 4.0, intensity: 1.0, smoothing: 0.01 },
            'reset-pan':   { mode: 'center',  speed: 1.0, intensity: 1.0, smoothing: 0.05 },
        };

        const vizSyncBandEl = document.getElementById('vizSyncBand');
            if (vizSyncBandEl) {
                vizSyncBandEl.addEventListener('change', (e) => {
                    this.overlayViz.setVizSyncBand(e.target.value);
                    this._triggerSave();
                });
            }

        document.querySelectorAll('[data-pan-preset]').forEach(btn => {
            btn.addEventListener('click', () => {
                const preset = panPresets[btn.dataset.panPreset];
                if (!preset) return;

                this.panner.setMode(preset.mode);
                this.panner.setSpeed(preset.speed);
                this.panner.setIntensity(preset.intensity);
                this.panner.setSmoothing(preset.smoothing);

                // Sync UI
                document.querySelectorAll('.pan-mode-btn').forEach(b => {
                    b.classList.toggle('active', b.dataset.mode === preset.mode);
                });
                const manualGroup = document.getElementById('manualPanGroup');
                if (manualGroup) manualGroup.classList.toggle('active', preset.mode === 'manual');

                document.getElementById('panSpeed').value = preset.speed;
                document.getElementById('panSpeedVal').textContent = preset.speed.toFixed(1) + ' Hz';
                document.getElementById('panIntensity').value = preset.intensity;
                document.getElementById('panIntensityVal').textContent = Math.round(preset.intensity * 100) + '%';
                document.getElementById('panSmoothing').value = preset.smoothing;
                document.getElementById('panSmoothingVal').textContent = preset.smoothing.toFixed(2);

                this._triggerSave();
            });
        });


        document.getElementById('undoBtn').addEventListener('click', () => this._undo());
        document.getElementById('redoBtn').addEventListener('click', () => this._redo());
    }

    /* ── Resize ───────────────────────────────────── */
    _resize() {
        const wfRect = this.dom.timelineContainer.getBoundingClientRect();
        const vizRect = document.querySelector('.viz-panel')?.getBoundingClientRect();
        const reactorRect = document.getElementById('reactorContainer')?.getBoundingClientRect();

        this.waveform.resize(wfRect.width, wfRect.height);
        if (vizRect) {
            this.visualizer.resize(vizRect.width, vizRect.height);
            this.vizBg.resize(vizRect.width, vizRect.height);  // ← NEW
        }
        if (reactorRect) this.overlayViz.resize(reactorRect.width, reactorRect.height);

        if (this.engine.channelData) this._redrawWaveform();
    }

        /* ── Audio Loading ─────────────────────────────── */
    async _loadAudio(e) {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;

        if (files.length === 1) {
            // ── Single file: destroy mixer if active, use AudioEngine ──
            if (this.useMixer) {
                this.mixer.destroy();
                this.mixer = new AudioMixer();
            }

            const file = files[0];
            this.currentAudioFile = file;
            await this.engine.load(file);
            this.panner.init();
            this.beats = [];
            this.filteredData = null;
            this.reactor.reset();
            this.useMixer = false;

            await SessionStore.saveBlob('audio', file);

            this.dom.playBtn.textContent = '▶ Play';
            this.dom.playBtn.disabled = false;
            this.dom.mainSection.classList.remove('hidden');
            this.dom.statsSection.classList.add('hidden');
            this.dom.beatList.classList.add('hidden');
            this.dom.exportBtn.disabled = true;

            this._redrawWaveform();
            this._updatePlayheads(0);
            this.dom.timeDisplay.textContent = this._fmt(0);
            this._triggerSave();

        } else {
            // ── Multiple files: destroy old mixer first, then create fresh one ──
            if (this.useMixer) {
                this.mixer.destroy();
            }
            this.mixer = new AudioMixer();
            await this.mixer.init();
            this.panner.linkMixer(this.mixer); // ✅ Link panner to new mixer


            for (const file of files) {
                await this.mixer.addLayer(file.name.replace(/\.[^.]+$/, ''), file);
                await SessionStore.saveBlob(`layer_${file.name}`, file);
            }

            this.useMixer = true;
            this.beats = [];
            this.filteredData = null;
            this.reactor.reset();
            this._mixerFiles = files.map(f => f.name);

            this._rebuildLayerUI();
            this._syncEngineFromMixer();

            if (this.mixer.getCoreBuffer()) {
                await this._detectBeats();
            }

            this.dom.playBtn.textContent = '▶ Play';
            this.dom.playBtn.disabled = false;
            this.dom.mainSection.classList.remove('hidden');
            this.dom.statsSection.classList.remove('hidden');
            this.dom.exportBtn.disabled = false;

            this._redrawWaveform();
            this._updatePlayheads(0);
            this.dom.timeDisplay.textContent = this._fmt(0);
            this._triggerSave();
        }

        e.target.value = '';
    }

    /* ── Beat Detection ────────────────────────────── */
    async _detectBeats() {
        const buffer = this.useMixer ? this.mixer.getCoreBuffer() : this.engine.buffer;
        if (!buffer) return;

        this.undoManager.push(this.beats);  // ✅ Save current beats before re-detection

        this.dom.analyzeBtn.textContent = '⏳ Analyzing...';
        this.dom.analyzeBtn.disabled = true;
        await new Promise(r => setTimeout(r, 50));

        this.dom.analyzeBtn.textContent = '⏳ Analyzing...';
        this.dom.analyzeBtn.disabled = true;
        await new Promise(r => setTimeout(r, 50));

        const result = await BeatDetector.detect(buffer, {
            band: this.dom.freqBand.value,
            threshold: parseFloat(this.dom.threshold.value),
            minGapMs: parseInt(this.dom.minGap.value),
            windowSize: parseInt(this.dom.smoothWindow.value),
            algorithm: document.getElementById('detectAlgorithm').value,
            onsetSharpness: parseFloat(document.getElementById('onsetSharpness').value),
            decayRate: parseFloat(document.getElementById('decayRate').value),
            bpmLock: document.getElementById('bpmLock').value === 'on',
            preEmphasis: document.getElementById('preEmphasis').value === 'on',
            multiBand: document.getElementById('multiBand')?.value === 'on',
            labelTypes: document.getElementById('labelTypes')?.value === 'on',
        });

        this.beats = result.beats;
        this.filteredData = result.filteredData;

        this._showStats();
        this._redrawWaveform();
        this.dom.analyzeBtn.textContent = '🔍 Detect Beats';
        this.dom.analyzeBtn.disabled = false;
        this._triggerSave();
        this._updateUndoRedoUI();  // ✅ Update button states
    }

        /* ── Undo / Redo ─────────────────────────────────── */
    _undo() {
        const previous = this.undoManager.undo(this.beats);
        if (!previous) return;
        this.beats = previous;
        this._redrawWaveform();
        this._populateBeatList();
        this._showStats();
        this._triggerSave();
        this._updateUndoRedoUI();
        console.log('%c↩ Undo', 'color:#00d4ff');
    }

    _redo() {
        const next = this.undoManager.redo(this.beats);
        if (!next) return;
        this.beats = next;
        this._redrawWaveform();
        this._populateBeatList();
        this._showStats();
        this._triggerSave();
        this._updateUndoRedoUI();
        console.log('%c↪ Redo', 'color:#00d4ff');
    }

    _updateUndoRedoUI() {
        const undoBtn = document.getElementById('undoBtn');
        const redoBtn = document.getElementById('redoBtn');
        if (undoBtn) undoBtn.disabled = !this.undoManager.canUndo;
        if (redoBtn) redoBtn.disabled = !this.undoManager.canRedo;
    }

    _showStats() {
        const bandNames = {};
        Object.entries(BeatDetector.BANDS).forEach(([k, v]) => {
            bandNames[k] = v ? v.label.split('(')[0].trim() : 'Full Spectrum';
        });

        document.getElementById('bpmDisplay').textContent = BeatDetector.estimateBPM(this.beats);
        document.getElementById('beatCount').textContent = this.beats.length;
        document.getElementById('durationDisplay').textContent = this._fmt(this.engine.duration);
        document.getElementById('bandDisplay').textContent = bandNames[this.dom.freqBand.value] || this.dom.freqBand.value;

        const algoEl = document.getElementById('detectAlgorithm');
        document.getElementById('algoDisplay').textContent = algoEl ? algoEl.selectedOptions[0].text.split('(')[0].trim() : '--';

        // Count beat types
        const types = { kick: 0, snare: 0, hat: 0, other: 0, unknown: 0 };
        this.beats.forEach(b => { types[b.type] = (types[b.type] || 0) + 1; });
        const labeled = types.kick + types.snare + types.hat;
        document.getElementById('typeDisplay').textContent = labeled > 0
            ? `${types.kick}/${types.snare}/${types.hat}`
            : 'N/A';

        this.dom.statsSection.classList.remove('hidden');
        this.dom.exportBtn.disabled = false;
        this._populateBeatList();
    }

    /* ── Playback Controls ─────────────────────────── */
    _togglePlay() {
        if (this.useMixer) {
            if (this.mixer.layers.length === 0) return;
            this.mixer.isPlaying ? this.mixer.pause() : this.mixer.play(this.mixer.startOffset);
            this.reactor.syncPlayback(this.mixer.isPlaying, this.mixer.getCurrentTime());
            // ✅ Panner drives mixer.masterPanner via update() — no reconnect needed
        } else {
            this.engine.isPlaying ? this.engine.pause() : this.engine.play();
            this.reactor.syncPlayback(this.engine.isPlaying, this.engine.getCurrentTime());
            if (this.engine.isPlaying) this.panner.reconnect();
        }
        this._updatePlayBtn();
    }

    _updatePlayBtn() {
        const playing = this.useMixer ? this.mixer.isPlaying : this.engine.isPlaying;
        this.dom.playBtn.textContent = playing ? '⏸ Pause' : '▶ Play';
    }

    _seekTo(time) {
        let clamped;
        if (this.useMixer) {
            clamped = this.mixer.seekTo(time);
        } else {
            clamped = this.engine.seekTo(time);
        }
        this._updatePlayheads(clamped);
        this.dom.timeDisplay.textContent = this._fmt(clamped);
        this._highlightBeat(clamped);
        this._updatePlayBtn();
        this.reactor.seekVideo(clamped);
        this.reactor.syncPlayback(this.useMixer ? this.mixer.isPlaying : this.engine.isPlaying, clamped);
        this._triggerSave();
    }

    /* ── Render Loop ───────────────────────────────── */
    _renderLoop() {
        requestAnimationFrame(() => this._renderLoop());

        // ✅ Get data from whichever system is active
        let freqData, timeData, ct;
        if (this.useMixer) {
            freqData = this.mixer.getCoreFrequencyData();
            timeData = null;
            ct = this.mixer.getCurrentTime();
        } else {
            freqData = this.engine.getFrequencyData();
            timeData = this.engine.getTimeDomainData();
            ct = this.engine.getCurrentTime();
        }

        let flashAlpha = 0;
        if (this.beats.length > 0 && (this.useMixer ? this.mixer.isPlaying : this.engine.isPlaying)) {
            const nearest = this.beats.reduce((best, b) =>
                Math.abs(b.time - ct) < Math.abs(best.time - ct) ? b : best
            );
            const dist = Math.abs(nearest.time - ct);
            if (dist < 0.08) flashAlpha = (1 - dist / 0.08) * 0.15;
        }

        this._renderLivePreview();
        this.overlayViz.render(freqData, timeData, this.beats, ct);
        this.reactor.update(ct, this.beats);

        if (this.keyframes.enabled) {
            this._applyKeyframes(ct);
        }
        this._updateKeyframePlayhead();

        this.panner.update(ct);
        this._updatePanMeter();

        const isPlaying = this.useMixer ? this.mixer.isPlaying : this.engine.isPlaying;
        if (isPlaying) {
            this._updatePlayheads(ct);
            this.dom.timeDisplay.textContent = this._fmt(ct);
            this._highlightBeat(ct);

            if (this.waveform.zoomLevel > 1.0) {
                const duration = this.useMixer ? this.mixer.getDuration() : this.engine.duration;
                const fraction = ct / duration;
                const { start, end } = this.waveform.getVisibleRange();
                if (fraction > end - 0.05 / this.waveform.zoomLevel) {
                    this.waveform.scrollTo(fraction);
                }
            }
        }
    }
    _updatePanMeter() {
        const pan = this.panner.getCurrentPan();
        const indicator = document.getElementById('panIndicator');
        const valueDisplay = document.getElementById('panValueDisplay');
        if (indicator) {
            // Map -1..+1 to 0%..100%
            const pct = ((pan + 1) / 2) * 100;
            indicator.style.left = `${pct}%`;
        }
        if (valueDisplay) {
            valueDisplay.textContent = pan.toFixed(2);
        }
    }

    /* ── Canvas Helpers ────────────────────────────── */
    _redrawWaveform() {
        if (this.useMixer && this.mixer.layers.length > 1) {
            const duration = this.mixer.getDuration();
            const layerData = this.mixer.layers.map(layer => ({
                data: layer.buffer ? layer.buffer.getChannelData(0) : null,
                name: layer.name,
                isCore: layer.isCore,
            }));
            this.waveform.drawLayers(layerData, duration, this.beats);
        } else {
            const data = this.filteredData ||
                (this.useMixer ? this.mixer.getCoreChannelData() : this.engine.channelData);
            const duration = this.useMixer ? this.mixer.getDuration() : this.engine.duration;
            this.waveform.draw(data, this.beats, duration);
        }

        // ✅ Draw selection box if actively selecting
        if (this._beatSelecting) {
            this._drawSelectionBox();
        }
    }

    _drawSelectionBox() {
        const canvas = document.getElementById('waveformCanvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.width / dpr;
        const h = canvas.height / dpr;

        const duration = this.useMixer ? this.mixer.getDuration() : this.engine.duration;
        if (!duration) return;

        const { start, end } = this.waveform.getVisibleRange();
        const visibleDuration = end - start;

        const selStart = Math.min(this._beatSelStart, this._beatSelEnd);
        const selEnd = Math.max(this._beatSelStart, this._beatSelEnd);

        // Convert time to pixel positions
        const startPct = (selStart / duration - start) / visibleDuration;
        const endPct = (selEnd / duration - start) / visibleDuration;
        const x1 = Math.max(0, startPct * w);
        const x2 = Math.min(w, endPct * w);

        if (x2 - x1 < 1) return;

        // Semi-transparent red selection box
        ctx.fillStyle = 'rgba(255,51,102,0.15)';
        ctx.fillRect(x1, 0, x2 - x1, h);

        // Border lines
        ctx.strokeStyle = 'rgba(255,51,102,0.8)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(x1, 0, x2 - x1, h);
        ctx.setLineDash([]);

        // Count label
        const count = this.beats.filter(b => b.time >= selStart && b.time <= selEnd).length;
        if (count > 0) {
            ctx.fillStyle = 'rgba(255,51,102,0.9)';
            ctx.font = 'bold 11px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(`${count} beat${count > 1 ? 's' : ''}`, (x1 + x2) / 2, 14);
            ctx.textAlign = 'left';
        }

        // Highlight selected beat markers in bright red
        this.beats.forEach(beat => {
            if (beat.time < selStart || beat.time > selEnd) return;
            const beatPct = (beat.time / duration - start) / visibleDuration;
            const bx = beatPct * w;
            if (bx < 0 || bx > w) return;

            ctx.strokeStyle = '#ff3366';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.moveTo(bx, 0);
            ctx.lineTo(bx, h);
            ctx.stroke();
        });
    }

    _updatePlayheads(time) {
        const duration = this.useMixer ? this.mixer.getDuration() : this.engine.duration;
        if (!duration) return;

        const vizPct = (time / duration) * 100;
        this.dom.vizPlayhead.style.left = `${vizPct}%`;

        const { start, end } = this.waveform.getVisibleRange();
        const visibleDuration = end - start;
        const timeInRange = (time / duration) - start;
        const wfPct = (timeInRange / visibleDuration) * 100;

        if (wfPct < 0 || wfPct > 100) {
            this.dom.wfPlayhead.style.display = 'none';
        } else {
            this.dom.wfPlayhead.style.display = 'block';
            this.dom.wfPlayhead.style.left = `${wfPct}%`;
        }
        
        // Auto-scroll beat list to follow playhead if enabled
        if (this.followPlayhead) {
            this._scrollBeatListToCurrent(time);
        }
    }

    _scrollBeatListToCurrent(currentTime) {
        const activeEl = this.dom.beatList.querySelector('.beat-item.active');
        if (activeEl) {
            // Scroll to center the active element
            activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    _highlightBeat(currentTime) {
        this.dom.beatList.querySelectorAll('.beat-item').forEach(el => {
            el.classList.toggle('active', Math.abs(parseFloat(el.dataset.time) - currentTime) < 0.15);
        });
    }

    /* ── Timeline Mouse Interaction ────────────────── */
    _getTimeFromX(clientX) {
        const rect = this.dom.timelineContainer.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const { start, end } = this.waveform.getVisibleRange();
        const visibleFraction = start + pct * (end - start);
        const duration = this.useMixer ? this.mixer.getDuration() : this.engine.duration;
        return visibleFraction * duration;
    }

    _getTimeFromVizX(clientX) {
        const vizCanvas = document.getElementById('vizCanvas');
        if (!vizCanvas) return 0;
        const rect = vizCanvas.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const duration = this.useMixer ? this.mixer.getDuration() : this.engine.duration;
        return pct * duration;
    }

    _onVizMouseDown(e) {
        const hasAudio = this.useMixer ? this.mixer.layers.length > 0 : this.engine.buffer;
        if (!hasAudio) return;
        
        // Right-click: delete nearest beat marker
        if (e.button === 2) {
            e.preventDefault();
            const time = this._getTimeFromVizX(e.clientX);
            this._removeBeatNearTime(time);
            return;
        }
        
        // Alt+Click: start drag-select for batch delete
        if (e.altKey) {
            e.preventDefault();
            this._beatSelecting = true;
            this._beatSelStart = this._getTimeFromVizX(e.clientX);
            this._beatSelEnd = this._beatSelStart;
            return;
        }
        
        // Shift+Click: add beat marker
        if (e.shiftKey) {
            e.preventDefault();
            const time = this._getTimeFromVizX(e.clientX);
            this._addBeatAtTime(time);
            return;
        }
        
        // Normal click: start dragging for scrubbing
        this.isDragging = true;
        const time = this._getTimeFromVizX(e.clientX);
        this._seekTo(time);
    }

    _onVizMouseMove(e) {
        if (!this.isDragging || !this.engine.buffer) return;
        
        // Seek to exact mouse position for precise scrubbing
        const time = this._getTimeFromVizX(e.clientX);
        this._seekTo(time);
    }

    _onVizMouseUp() {
        this.isDragging = false;
        this._beatSelecting = false;
    }

    _onVizClick(e) {
        // Handle click-specific actions if needed
        // Currently handled in mousedown/up
    }

    _onDown(e) {
        const hasAudio = this.useMixer ? this.mixer.layers.length > 0 : this.engine.buffer;
        if (!hasAudio) return;

        const time = this._getTimeFromX(e.clientX);

        // ✅ Right-click: delete nearest beat marker
        if (e.button === 2) {
            e.preventDefault();
            this._removeBeatNearTime(time);
            return;
        }

        // ✅ Alt+Click: start drag-select for batch delete
        if (e.altKey) {
            e.preventDefault();
            this._beatSelecting = true;
            this._beatSelStart = time;
            this._beatSelEnd = time;
            this._redrawWaveform();
            return;
        }

        // ✅ Shift+Click: add beat marker
        if (e.shiftKey) {
            e.preventDefault();
            this._addBeatAtTime(time);
            return;
        }

        // Normal click: seek
        this.isDragging = true;
        this._seekTo(time);
    }

    _onMove(e) {
        const hasAudio = this.useMixer ? this.mixer.layers.length > 0 : this.engine.buffer;
        if (!hasAudio) return;

        const rect = this.dom.timelineContainer.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const time = this._getTimeFromX(e.clientX);

        // ✅ Update selection range while dragging
        if (this._beatSelecting) {
            this._beatSelEnd = time;
            this._redrawWaveform();

            // Show count of beats in selection
            const selStart = Math.min(this._beatSelStart, this._beatSelEnd);
            const selEnd = Math.max(this._beatSelStart, this._beatSelEnd);
            const count = this.beats.filter(b => b.time >= selStart && b.time <= selEnd).length;
            this.dom.tooltip.textContent = `${count} beat${count !== 1 ? 's' : ''} selected — release to delete`;
            this.dom.tooltip.style.color = '#ff3366';
            this.dom.tooltip.style.left = `${Math.min(x + 10, rect.width - 80)}px`;
            this.dom.tooltip.style.opacity = '1';
            return;
        }

        if (x >= 0 && x <= rect.width) {
            const nearBeat = this.beats.find(b => Math.abs(b.time - time) < 0.10);
            if (nearBeat) {
                this.dom.tooltip.textContent = `${this._fmt(nearBeat.time)} [Right-click to delete]`;
                this.dom.tooltip.style.color = '#ff3366';
            } else if (e.shiftKey) {
                this.dom.tooltip.textContent = `${this._fmt(time)} [Click to add beat]`;
                this.dom.tooltip.style.color = '#00ff88';
            } else if (e.altKey) {
                this.dom.tooltip.textContent = `Drag to select beats for deletion`;
                this.dom.tooltip.style.color = '#ffcc00';
            } else {
                this.dom.tooltip.textContent = this._fmt(time);
                this.dom.tooltip.style.color = '#fff';
            }
            this.dom.tooltip.style.left = `${Math.min(x + 10, rect.width - 80)}px`;
            this.dom.tooltip.style.opacity = '1';
        }

        if (this.isDragging) this._seekTo(time);
    }

    _onUp() {
        if (this._beatSelecting) {
            this._beatSelecting = false;

            const selStart = Math.min(this._beatSelStart, this._beatSelEnd);
            const selEnd = Math.max(this._beatSelStart, this._beatSelEnd);

            if (selEnd - selStart > 0.02) {
                const before = this.beats.length;
                const selectedBeats = this.beats.filter(b => b.time >= selStart && b.time <= selEnd);

                if (selectedBeats.length > 0) {
                    this.undoManager.push(this.beats);  // ✅ Save state before batch delete
                    this.beats = this.beats.filter(b => b.time < selStart || b.time > selEnd);
                    const removed = before - this.beats.length;

                    if (removed > 0) {
                        console.log(`%c- ${removed} beat${removed > 1 ? 's' : ''} deleted`, 'color:#ff3366');
                        this._redrawWaveform();
                        this._populateBeatList();
                        this._showStats();
                        this._triggerSave();
                        this._updateUndoRedoUI();
                    }
                }
            }

            this._redrawWaveform();
            return;
        }

        this.isDragging = false;
    }

    /* ── Keyboard Shortcuts ────────────────────────── */
    _onKeyDown(e) {
        // ✅ ALWAYS prevent spacebar default (page scroll) — no exceptions
        if (e.code === 'Space') {
            e.preventDefault();
            e.stopPropagation();
            const hasAudio = this.useMixer ? this.mixer.layers.length > 0 : this.engine.buffer;
            if (hasAudio) this._togglePlay();
            return;
        }
        
        // ✅ Prevent Alt key default behavior (browser menu activation)
        // This allows Alt+Click to work for beat selection without browser interference
        if (e.code === 'AltLeft' || e.code === 'AltRight') {
            e.preventDefault();
            return;
        }
        

        const tag = e.target.tagName.toLowerCase();
        if (tag === 'input' || tag === 'select' || tag === 'textarea') {
            // ✅ Still allow Ctrl+Z/Y even in inputs
            if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyZ' || e.code === 'KeyY')) {
                // Don't return — let it fall through to the switch
            } else {
                return;
            }
        }
        // if (tag === 'input' || tag === 'select' || tag === 'textarea') return;

        const hasAudio = this.useMixer ? this.mixer.layers.length > 0 : this.engine.buffer;
        const getCurrentTime = () => this.useMixer ? this.mixer.getCurrentTime() : this.engine.getCurrentTime();


        switch (e.code) {
            case 'ArrowLeft':
                e.preventDefault();
                if (hasAudio) this._seekTo(getCurrentTime() - 5);
                break;
            case 'ArrowRight':
                e.preventDefault();
                if (hasAudio) this._seekTo(getCurrentTime() + 5);
                break;
            case 'KeyD':
                e.preventDefault();
                if (hasAudio && !this.dom.analyzeBtn.disabled) this._detectBeats();
                break;
            case 'KeyE':
                e.preventDefault();
                if (!this.dom.exportBtn.disabled) this._exportCSV();
                break;
            case 'ArrowUp':
                e.preventDefault();
                if (hasAudio) {
                    const newVol = Math.min(1, this.engine.volume + 0.05);
                    this.engine.setVolume(newVol);
                    const vs = document.getElementById('volumeSlider');
                    if (vs) { vs.value = newVol; vs.style.setProperty('--vol-pct', (newVol*100)+'%'); }
                    const vv = document.getElementById('volumeVal');
                    if (vv) vv.textContent = Math.round(newVol*100) + '%';
                    const vi = document.getElementById('volumeIcon');
                    if (vi) { vi.textContent = newVol < 0.3 ? '🔈' : newVol < 0.7 ? '🔉' : '🔊'; vi.classList.remove('muted'); }
                }
                break;
            case 'ArrowDown':
                e.preventDefault();
                if (hasAudio) {
                    const newVol = Math.max(0, this.engine.volume - 0.05);
                    this.engine.setVolume(newVol);
                    const vs = document.getElementById('volumeSlider');
                    if (vs) { vs.value = newVol; vs.style.setProperty('--vol-pct', (newVol*100)+'%'); }
                    const vv = document.getElementById('volumeVal');
                    if (vv) vv.textContent = Math.round(newVol*100) + '%';
                    const vi = document.getElementById('volumeIcon');
                    if (vi) { vi.textContent = newVol === 0 ? '🔇' : newVol < 0.3 ? '🔈' : newVol < 0.7 ? '🔉' : '🔊'; vi.classList.toggle('muted', newVol === 0); }
                }
                break;
            case 'KeyM':
                e.preventDefault();
                if (hasAudio) {
                    const vi = document.getElementById('volumeIcon');
                    if (vi) vi.click();
                }
                break;

            case 'KeyZ':
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    if (e.shiftKey) {
                        this._redo();       // Ctrl+Shift+Z = Redo
                    } else {
                        this._undo();       // Ctrl+Z = Undo
                    }
                }
                break;
            case 'KeyY':
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    this._redo();           // Ctrl+Y = Redo
                }
                break;
        }

        
    }

    /* ── CSV Export ─────────────────────────────────── */
    _exportCSV() {
        const band = this.dom.freqBand.selectedOptions[0].text;
        const csv = `Band,${band}\nBeat,Time,Strength\n` +
            this.beats.map((b, i) => `${i + 1},${b.time.toFixed(3)},${b.strength.toFixed(2)}`).join('\n');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
        a.download = `beats_${this.dom.freqBand.value}.csv`;
        a.click();
    }

    /* ── Video Export ───────────────────────────────── */
    async _startExport() {
        const hasAudio = this.useMixer ? this.mixer.layers.length > 0 : this.engine.buffer;
        if (!hasAudio) { alert('Load an audio file first.'); return; }
        if (!this.reactor.loaded) { alert('Upload an image or video to the reactor panel first.'); return; }
        if (this.beats.length === 0) { if (!confirm('No beats detected yet. Export anyway?')) return; }

        const [width, height] = document.getElementById('exportResolution').value.split('x').map(Number);
        const fps = parseInt(document.getElementById('exportFps').value);
        const durationSelect = document.getElementById('exportDuration');
        const duration = this.useMixer ? this.mixer.getDuration() : this.engine.duration;
        let durationSec;
        if (durationSelect.value === 'full') durationSec = Math.ceil(duration);
        else if (durationSelect.value === 'custom') durationSec = parseInt(durationSelect.dataset.customValue) || 30;
        else durationSec = parseInt(durationSelect.value);

        const includeAudio = document.getElementById('exportAudio').value === 'yes';

        const startBtn = document.getElementById('startExportBtn');
        const cancelBtn = document.getElementById('cancelExportBtn');
        const progressEl = document.getElementById('exportProgress');
        const progressFill = document.getElementById('progressFill');
        const progressText = document.getElementById('progressText');

        startBtn.disabled = true;
        startBtn.classList.add('recording');
        startBtn.textContent = '🔴 Recording...';
        cancelBtn.classList.remove('hidden');
        progressEl.classList.remove('hidden');
        progressFill.style.width = '0%';
        progressText.textContent = `Starting ${width}×${height} @ ${fps}fps for ${durationSec}s...`;

        let audioStream = null;
        if (includeAudio) {
            try {
                if (this.useMixer) {
                    // ✅ Multi-track: create dest on mixer's context, route ALL layers
                    const dest = this.mixer.ctx.createMediaStreamDestination();
                    this.mixer.setExportDestination(dest);
                    audioStream = dest.stream;
                } else {
                    // Single-file: use engine's context
                    const dest = this.engine.ctx.createMediaStreamDestination();
                    this.engine.setExportDestination(dest);
                    audioStream = dest.stream;
                }
            } catch (err) {
                console.warn('Audio capture unavailable:', err);
            }
        }

        this.exporter.onProgress = (percent, elapsed) => {
            progressFill.style.width = `${percent}%`;
            progressText.textContent = `Recording: ${elapsed.toFixed(1)}s / ${durationSec}s (${percent.toFixed(0)}%)`;
        };

        this.exporter.onComplete = (blob, mimeType) => {
            // ✅ Cleanup export routing for whichever system is active
            // Seek to start and begin playback
            if (this.useMixer) {
                this.mixer.seekTo(0);
                if (!this.mixer.isPlaying) this.mixer.play(0);
            } else {
                this.engine.seekTo(0);
                if (!this.engine.isPlaying) {
                    this.engine.play();
                    this._updatePlayBtn();
                }
            }
            this._updatePlayheads(0);
            this.dom.timeDisplay.textContent = this._fmt(0);
            this.reactor.syncPlayback(true, 0);

            let ext = 'webm';
            if (mimeType.includes('mp4')) ext = 'mp4';
            else if (mimeType.includes('quicktime') || mimeType.includes('mov')) ext = 'mov';

            const filename = `beat-visualizer-${Date.now()}.${ext}`;
            VideoExporter.downloadBlob(blob, filename);

            startBtn.disabled = false;
            startBtn.classList.remove('recording');
            startBtn.textContent = '🔴 Start Recording & Export';
            cancelBtn.classList.add('hidden');
            progressText.textContent = `✅ Exported ${filename} (${(blob.size / 1024 / 1024).toFixed(1)} MB)`;
            setTimeout(() => progressEl.classList.add('hidden'), 5000);
            console.log(`%c✅ Video exported: ${filename}`, 'color:#00ff88;font-weight:bold');
        };

        this.exporter.onError = (msg) => {
            if (this.useMixer) {
                this.mixer.setExportDestination(null);
            } else {
                this.engine.setExportDestination(null);
            }
            startBtn.disabled = false;
            startBtn.classList.remove('recording');
            startBtn.textContent = '🔴 Start Recording & Export';
            cancelBtn.classList.add('hidden');
            progressText.textContent = `❌ ${msg}`;
            alert(`Export failed: ${msg}`);
        };

        // Seek to start
        if (this.useMixer) {
            this.mixer.seekTo(0);
            if (!this.mixer.isPlaying) { this.mixer.play(0); }
        } else {
            this.engine.seekTo(0);
            if (!this.engine.isPlaying) { this.engine.play(); this._updatePlayBtn(); }
        }
        this._updatePlayheads(0);
        this.dom.timeDisplay.textContent = this._fmt(0);
        this.reactor.syncPlayback(true, 0);

        const reactorContainer = document.getElementById('reactorContainer');
        if (!reactorContainer || reactorContainer.offsetWidth === 0) {
            alert('Media panel not ready. Switch to the Media tab first, then try again.');
            return;
        }
        await this.exporter.start(reactorContainer, { durationSec, fps, width, height, audioStream });
    }

        _cancelExport() {
            this.exporter.cancel();
            if (this.useMixer) {
                this.mixer.setExportDestination(null);
            } else {
                this.engine.setExportDestination(null);
            }
            const startBtn = document.getElementById('startExportBtn');
            const cancelBtn = document.getElementById('cancelExportBtn');
            const progressText = document.getElementById('progressText');

            startBtn.disabled = false;
            startBtn.classList.remove('recording');
            startBtn.textContent = '🔴 Start Recording & Export';
            cancelBtn.classList.add('hidden');
            progressText.textContent = '⏹ Cancelled';
            setTimeout(() => document.getElementById('exportProgress')?.classList.add('hidden'), 2000);
        }

        /* ── Keyframe Automation ─────────────────────────── */
    _applyKeyframes(time) {
        const values = this.keyframes.getAllValuesAtTime(time);

        for (const [path, value] of values) {
            const [target, param] = path.split('.');

            if (target === 'masterIntensity') {
                this.reactor.setMasterIntensity(value);
                const slider = document.getElementById('masterIntensity');
                if (slider) slider.value = value;
                const valEl = document.getElementById('masterIntensityVal');
                if (valEl) valEl.textContent = value.toFixed(1) + 'x';
            } else if (target === 'overlay') {
                switch (param) {
                    case 'opacity':
                        this.overlayViz.setOpacity(value);
                        this.overlayViz.applyTransform();
                        break;
                    case 'scaleX':
                        this.overlayViz.setScale(value, this.overlayViz.scaleY);
                        this.overlayViz.applyTransform();
                        break;
                    case 'scaleY':
                        this.overlayViz.setScale(this.overlayViz.scaleX, value);
                        this.overlayViz.applyTransform();
                        break;
                    case 'rotation':
                        this.overlayViz.setRotation(value);
                        this.overlayViz.applyTransform();
                        break;
                }
            } else if (target === 'panner') {
                switch (param) {
                    case 'manualPan': this.panner.setManualPan(value); break;
                    case 'speed':     this.panner.setSpeed(value); break;
                    case 'intensity': this.panner.setIntensity(value); break;
                }
            } else {
                // Effect parameter (e.g. jitter.intensity)
                this.reactor.setEffectParam(target, param, value);
            }
        }
    }

    _bindKeyframeEvents() {
        // Add Track button
        document.getElementById('addTrackBtn').addEventListener('click', () => {
            document.getElementById('addTrackModal').classList.remove('hidden');
        });

        // Modal confirm/cancel
        document.getElementById('confirmAddTrack').addEventListener('click', () => {
            const select = document.getElementById('kfTargetSelect');
            const [target, param] = select.value.split('.');
            const finalParam = param || 'intensity';
            const trackId = this.keyframes.addTrack(target, finalParam || target);

            // If target has no dot, it's masterIntensity — param is 'value'
            if (!param && target === 'masterIntensity') {
                this.keyframes.tracks.get(trackId).param = 'value';
            }

            document.getElementById('addTrackModal').classList.add('hidden');
            this._rebuildKeyframeUI();
            this._selectTrack(trackId);
            this._triggerSave();
        });

        document.getElementById('cancelAddTrack').addEventListener('click', () => {
            document.getElementById('addTrackModal').classList.add('hidden');
        });

        // Add Keyframe at playhead
        document.getElementById('addKeyframeBtn').addEventListener('click', () => {
            if (!this._activeKfTrack) return;
            const time = this.engine.getCurrentTime();
            const track = this.keyframes.tracks.get(this._activeKfTrack);
            if (!track) return;

            // Get current value of the targeted parameter
            const currentValue = this._getCurrentParamValue(track.target, track.param);
            this.keyframes.addKeyframe(this._activeKfTrack, time, currentValue);
            this._renderKeyframeTimeline();
            this._rebuildTrackList();
            this._triggerSave();
        });

        // Clear all
        document.getElementById('clearKeyframesBtn').addEventListener('click', () => {
            if (!confirm('Clear all keyframe tracks?')) return;
            this.keyframes.tracks.clear();
            this._activeKfTrack = null;
            this._rebuildKeyframeUI();
            this._triggerSave();
        });

        // Enable/disable toggle
        document.getElementById('keyframeEnabled').addEventListener('change', (e) => {
            this.keyframes.enabled = e.target.checked;
            e.target.parentElement.classList.toggle('active', e.target.checked);
            this._triggerSave();
        });

        // Easing change
        document.getElementById('keyframeEasing').addEventListener('change', (e) => {
            if (this._activeKfTrack) {
                this.keyframes.setEasing(this._activeKfTrack, e.target.value);
                this._renderKeyframeTimeline();
                this._triggerSave();
            }
        });

        // Timeline click to add keyframe
        document.getElementById('keyframeTimeline').addEventListener('click', (e) => {
            if (!this._activeKfTrack) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const pct = (e.clientX - rect.left) / rect.width;
            const duration = this.engine.duration || 30;
            const time = pct * duration;

            const track = this.keyframes.tracks.get(this._activeKfTrack);
            if (!track) return;

            const currentValue = this._getCurrentParamValue(track.target, track.param);
            this.keyframes.addKeyframe(this._activeKfTrack, time, currentValue);
            this._renderKeyframeTimeline();
            this._rebuildTrackList();
            this._triggerSave();
        });

        // Register collapsible panel
        const header = document.getElementById('headerKeyframes');
        const content = document.getElementById('contentKeyframes');
        if (header && content) {
            this.panelManager.registerPanel('keyframes', header, content, false);
        }
    }

    _getCurrentParamValue(target, param) {
        if (target === 'masterIntensity') return this.reactor.masterIntensity;
        if (target === 'overlay') {
            switch (param) {
                case 'opacity': return this.overlayViz.opacity;
                case 'scaleX': return this.overlayViz.scaleX;
                case 'scaleY': return this.overlayViz.scaleY;
                case 'rotation': return this.overlayViz.rotation;
            }
        }
        if (target === 'panner') {
            switch (param) {
                case 'manualPan': return this.panner.manualPan;
                case 'speed': return this.panner.speed;
                case 'intensity': return this.panner.intensity;
            }
        }
        const cfg = this.reactor.getConfig(target);
        return cfg ? cfg[param] || 0 : 0;
    }

    _selectTrack(trackId) {
        this._activeKfTrack = trackId;
        document.getElementById('addKeyframeBtn').disabled = !trackId;
        document.getElementById('keyframeTimelineContainer').classList.toggle('hidden', !trackId);

        if (trackId) {
            const track = this.keyframes.tracks.get(trackId);
            document.getElementById('keyframeTrackLabel').textContent = `${track.target}.${track.param}`;
            document.getElementById('keyframeEasing').value = track.easing;
            this._renderKeyframeTimeline();
        }

        // Highlight active track in list
        document.querySelectorAll('.kf-track').forEach(el => {
            el.classList.toggle('active', el.dataset.trackId === trackId);
        });
    }

    _rebuildKeyframeUI() {
        this._rebuildTrackList();
        if (this._activeKfTrack && !this.keyframes.tracks.has(this._activeKfTrack)) {
            this._activeKfTrack = null;
        }
        this._selectTrack(this._activeKfTrack);
    }

    _rebuildTrackList() {
        const container = document.getElementById('keyframeTracks');
        const empty = document.getElementById('keyframeEmpty');

        if (this.keyframes.tracks.size === 0) {
            container.innerHTML = '';
            container.appendChild(empty);
            empty.style.display = 'block';
            return;
        }

        empty.style.display = 'none';
        container.innerHTML = '';

        for (const [id, track] of this.keyframes.tracks) {
            const row = document.createElement('div');
            row.className = `kf-track${id === this._activeKfTrack ? ' active' : ''}`;
            row.dataset.trackId = id;
            row.innerHTML = `
                <span class="kf-track-name">${track.target}.${track.param}</span>
                <span class="kf-track-kf-count">${track.keyframes.length} kf</span>
                <button class="kf-track-delete" data-track-id="${id}">✕</button>
            `;
            row.addEventListener('click', (e) => {
                if (e.target.classList.contains('kf-track-delete')) return;
                this._selectTrack(id);
            });
            row.querySelector('.kf-track-delete').addEventListener('click', () => {
                this.keyframes.removeTrack(id);
                if (this._activeKfTrack === id) this._activeKfTrack = null;
                this._rebuildKeyframeUI();
                this._triggerSave();
            });
            container.appendChild(row);
        }
    }

    _renderKeyframeTimeline() {
        const canvas = document.getElementById('keyframeCanvas');
        const container = document.getElementById('keyframeTimeline');
        if (!canvas || !this._activeKfTrack) return;

        const rect = container.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const w = rect.width, h = rect.height;
        const track = this.keyframes.tracks.get(this._activeKfTrack);
        if (!track) return;

        const duration = this.engine.duration || 30;
        document.getElementById('kfDurationLabel').textContent = this._fmt(duration);

        // Clear
        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(0, 0, w, h);

        // Grid lines
        ctx.strokeStyle = '#1a1a1a';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 10; i++) {
            const x = (i / 10) * w;
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        }
        for (let i = 0; i <= 4; i++) {
            const y = (i / 4) * h;
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        }

        if (track.keyframes.length === 0) return;

        // Determine value range
        const values = track.keyframes.map(kf => kf.value);
        let minVal = Math.min(...values), maxVal = Math.max(...values);
        if (minVal === maxVal) { minVal -= 0.5; maxVal += 0.5; }
        const padding = (maxVal - minVal) * 0.1;
        minVal -= padding; maxVal += padding;

        // Draw curve
        ctx.strokeStyle = '#00d4ff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        const steps = 200;
        for (let i = 0; i <= steps; i++) {
            const t = (i / steps) * duration;
            const val = this.keyframes.getValueAtTime(this._activeKfTrack, t);
            const x = (t / duration) * w;
            const y = h - ((val - minVal) / (maxVal - minVal)) * h;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Draw keyframe diamonds
        // Remove old diamond elements
        container.querySelectorAll('.kf-diamond').forEach(el => el.remove());

        track.keyframes.forEach(kf => {
            const x = (kf.time / duration) * w;
            const y = h - ((kf.value - minVal) / (maxVal - minVal)) * h;

            // Draw on canvas
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(Math.PI / 4);
            ctx.fillStyle = '#00ff88';
            ctx.fillRect(-5, -5, 10, 10);
            ctx.restore();

            // Interactive diamond overlay
            const diamond = document.createElement('div');
            diamond.className = 'kf-diamond';
            diamond.style.left = `${(kf.time / duration) * 100}%`;
            diamond.style.top = `${((kf.value - minVal) / (maxVal - minVal)) * 100}%`;
            diamond.style.transform = `rotate(45deg) translate(-50%, -50%)`;
            diamond.title = `t=${kf.time.toFixed(2)}s val=${kf.value.toFixed(2)}\nRight-click to delete`;
            diamond.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.keyframes.removeKeyframe(this._activeKfTrack, kf.time);
                this._renderKeyframeTimeline();
                this._rebuildTrackList();
                this._triggerSave();
            });
            container.appendChild(diamond);
        });

        // Update playhead position
        this._updateKeyframePlayhead();
    }

    _updateKeyframePlayhead() {
        const playhead = document.getElementById('keyframePlayhead');
        if (!playhead) return;
        const duration = this.engine.duration || 30;
        const ct = this.engine.getCurrentTime();
        const pct = (ct / duration) * 100;
        playhead.style.left = `${pct}%`;
    }

        /* ── Live Spectrum Panel = Media Preview Mirror ──── */
    /* ── Live Preview — mirrors reactive media into spectrum panel ── */
    _renderLivePreview() {
        const vizCanvas = document.getElementById('vizCanvas');
        if (!vizCanvas) return;

        const dpr = window.devicePixelRatio || 1;
        const w = vizCanvas.width / dpr;
        const h = vizCanvas.height / dpr;
        if (w === 0 || h === 0) return;

        const ctx = vizCanvas.getContext('2d');
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // Clear
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#0d0d0d';
        ctx.fillRect(0, 0, w, h);

        // If no media loaded, just show dark background
        if (!this.reactor.loaded || !this.reactor.mediaEl) {
            ctx.restore();
            return;
        }

        // Check if fx-overlay has active canvas effects
        const fxCanvas = this.reactor._fxCanvas;
        const fxVisible = fxCanvas && fxCanvas.style.display !== 'none' && fxCanvas.width > 0 && fxCanvas.height > 0;

        if (fxVisible) {
            // Canvas effects are active — draw the pre-rendered fx canvas
            ctx.drawImage(fxCanvas, 0, 0, w, h);
        } else {
            // No canvas effects — draw media element with CSS transform + filters
            const mediaEl = this.reactor.mediaEl;

            ctx.save();
            ctx.translate(w / 2, h / 2);

            // Apply CSS transform matrix
            const style = getComputedStyle(mediaEl);
            const transform = style.transform;
            if (transform && transform !== 'none') {
                const match = transform.match(/matrix.*\((.+)\)/);
                if (match) {
                    const v = match[1].split(',').map(parseFloat);
                    if (v.length >= 6) {
                        ctx.transform(v[0], v[1], v[2], v[3], v[4], v[5]);
                    }
                }
            }

            // Apply opacity (strobe effect)
            const opacity = parseFloat(mediaEl.style.opacity) || 1;
            ctx.globalAlpha = opacity;

            // Apply CSS filters (brightness, invert, hue-rotate, etc.)
            const filter = mediaEl.style.filter;
            if (filter && filter !== 'none' && filter !== '') {
                try { ctx.filter = filter; } catch (err) {
                    console.warn('[App] Failed to apply filter:', err.message);
                }
            }

            // Draw media centered — maintain aspect ratio
            try {
                if (mediaEl.tagName === 'VIDEO') {
                    const vw = mediaEl.videoWidth || w;
                    const vh = mediaEl.videoHeight || h;
                    const scale = Math.min(w / vw, h / vh);
                    const dw = vw * scale;
                    const dh = vh * scale;
                    ctx.drawImage(mediaEl, -dw / 2, -dh / 2, dw, dh);
                } else if (mediaEl.naturalWidth) {
                    const iw = mediaEl.naturalWidth;
                    const ih = mediaEl.naturalHeight;
                    const scale = Math.min(w / iw, h / ih);
                    const dw = iw * scale;
                    const dh = ih * scale;
                    ctx.drawImage(mediaEl, -dw / 2, -dh / 2, dw, dh);
                }
            } catch (err) {
                console.warn('[App] Failed to draw media:', err.message);
            }

            ctx.filter = 'none';
            ctx.globalAlpha = 1.0;
            ctx.restore();
        }

        // Composite the spectrum overlay on top if it's active
        const overlayCanvas = document.getElementById('overlayCanvas');
        if (overlayCanvas && overlayCanvas.style.display !== 'none' &&
            overlayCanvas.width > 0 && overlayCanvas.height > 0) {
            ctx.save();
            const ovOpacity = parseFloat(overlayCanvas.style.opacity) || 1;
            ctx.globalAlpha = ovOpacity;
            const blend = overlayCanvas.style.mixBlendMode || 'screen';
            ctx.globalCompositeOperation = this._cssBlendToCanvas(blend);
            ctx.drawImage(overlayCanvas, 0, 0, w, h);
            ctx.globalAlpha = 1.0;
            ctx.globalCompositeOperation = 'source-over';
            ctx.restore();
        }

        ctx.restore();
    }

    _cssBlendToCanvas(cssBlend) {
        const map = {
            'normal': 'source-over', 'screen': 'screen', 'multiply': 'multiply',
            'overlay': 'overlay', 'lighten': 'lighten', 'color-dodge': 'color-dodge',
            'hard-light': 'hard-light', 'add': 'lighter',
        };
        return map[cssBlend] || 'screen';
    }

    _fmt(s) { return `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`; }

        /* ── Manual Beat Marker Editing ─────────────────── */

    /**
     * Add a beat marker at the given time.
     * Inserts in sorted order, prevents duplicates within 50ms.
     */
    _addBeatAtTime(time) {
        const duration = this.useMixer ? this.mixer.getDuration() : this.engine.duration;
        if (!duration || time < 0 || time > duration) return;

        const tooClose = this.beats.some(b => Math.abs(b.time - time) < 0.05);
        if (tooClose) return;

        this.undoManager.push(this.beats);  // ✅ Save state before change

        const newBeat = {
            time: parseFloat(time.toFixed(3)),
            strength: 0.7,
            type: 'manual',
        };

        let insertIdx = this.beats.findIndex(b => b.time > time);
        if (insertIdx === -1) insertIdx = this.beats.length;
        this.beats.splice(insertIdx, 0, newBeat);

        this._redrawWaveform();
        this._populateBeatList();
        this._showStats();
        this._triggerSave();
        this._updateUndoRedoUI();
    }

    /**
     * Remove the nearest beat marker within 100ms of the given time.
     * Returns true if a beat was removed.
     */
    _removeBeatNearTime(time) {
        let nearestIdx = -1;
        let nearestDist = Infinity;

        this.beats.forEach((b, i) => {
            const dist = Math.abs(b.time - time);
            if (dist < nearestDist) { nearestDist = dist; nearestIdx = i; }
        });

        if (nearestIdx >= 0 && nearestDist < 0.10) {
            this.undoManager.push(this.beats);  // ✅ Save state before change
            const removed = this.beats.splice(nearestIdx, 1)[0];
            this._redrawWaveform();
            this._populateBeatList();
            this._showStats();
            this._triggerSave();
            this._updateUndoRedoUI();
            console.log(`%c- Beat removed at ${this._fmt(removed.time)}`, 'color:#ff3366');
            return true;
        }
        return false;
    }
}

new App();