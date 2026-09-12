/**
 * Manages collapsible panels and tabbed navigation.
 * Handles expand/collapse state persistence via localStorage.
 */
export class PanelManager {
    constructor() {
        this.panels = new Map();
        this.activeTab = 'media';
        this._loadState();
    }

    /** Register a collapsible panel */
    registerPanel(id, headerEl, contentEl, defaultOpen = true) {
        const isOpen = this._savedStates[id] !== undefined ? this._savedStates[id] : defaultOpen;
        this.panels.set(id, { headerEl, contentEl, isOpen });

        // Apply initial state
        contentEl.style.display = isOpen ? 'block' : 'none';
        headerEl.classList.toggle('collapsed', !isOpen);

        // Bind toggle
        headerEl.addEventListener('click', () => this.togglePanel(id));
    }

    togglePanel(id) {
        const panel = this.panels.get(id);
        if (!panel) return;
        panel.isOpen = !panel.isOpen;
        panel.contentEl.style.display = panel.isOpen ? 'block' : 'none';
        panel.headerEl.classList.toggle('collapsed', !panel.isOpen);
        this._saveState();
    }

    /** Tab navigation */
    initTabs(tabContainerId, contentContainers) {
        const tabBtns = document.querySelectorAll(`#${tabContainerId} .tab-btn`);
        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const target = btn.dataset.tab;
                this.activeTab = target;

                // Update button states
                tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === target));

                    // Show/hide content sections
                    Object.entries(contentContainers).forEach(([key, el]) => {
                        if (!el) return;
                        
                        if (key === target) {
                        // Active tab: fully visible
                        el.style.display = 'block';
                        el.classList.remove('tab-content-offscreen');
                    } else if (key === 'media') {
                        // ✅ Media tab: move offscreen instead of display:none
                        // Keeps canvas rendering alive for export capture
                        el.style.display = '';
                        el.classList.add('tab-content-offscreen');
                    } else {
                        // Other inactive tabs: normal hide
                        el.style.display = 'none';
                        el.classList.remove('tab-content-offscreen');
                    }
                });

                this._saveState();
            });
        });

        // Restore last active tab
        if (this._savedTab && contentContainers[this._savedTab]) {
            const btn = document.querySelector(`#${tabContainerId} .tab-btn[data-tab="${this._savedTab}"]`);
            if (btn) btn.click();
        }
    }

    _loadState() {
        try {
            const raw = localStorage.getItem('beatViz_panels_v1');
            const data = raw ? JSON.parse(raw) : {};
            this._savedStates = data.states || {};
            this._savedTab = data.activeTab || 'media';
        } catch (_) {
            this._savedStates = {};
            this._savedTab = 'media';
        }
    }

    _saveState() {
        try {
            const states = {};
            this.panels.forEach((panel, id) => { states[id] = panel.isOpen; });
            localStorage.setItem('beatViz_panels_v1', JSON.stringify({
                states,
                activeTab: this.activeTab,
            }));
        } catch (_) {}
    }
}