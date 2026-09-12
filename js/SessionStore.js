/**
 * Persists session state across page refreshes.
 * - Settings + beats → localStorage (small, synchronous)
 * - Audio + image files → IndexedDB (large binary blobs)
 */

const LS_KEY = 'beatViz_session_v1';
const DB_NAME = 'beatViz_files_v1';
const DB_VERSION = 1;

export class SessionStore {
    /* ── IndexedDB helpers (for binary files) ─────── */
    static _openDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('files')) {
                    db.createObjectStore('files');
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    static async saveBlob(key, blob) {
        try {
            const db = await this._openDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction('files', 'readwrite');
                tx.objectStore('files').put(blob, key);
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => reject(tx.error);
            });
        } catch (err) {
            console.warn('⚠️ IndexedDB save failed:', err);
            return false;
        }
    }

    static async loadBlob(key) {
        try {
            const db = await this._openDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction('files', 'readonly');
                const req = tx.objectStore('files').get(key);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => reject(req.error);
            });
        } catch (err) {
            console.warn('⚠️ IndexedDB load failed:', err);
            return null;
        }
    }

    static async clearFiles() {
        try {
            const db = await this._openDB();
            const tx = db.transaction('files', 'readwrite');
            tx.objectStore('files').clear();
        } catch (_) {}
    }

    /* ── localStorage helpers (for settings/beats) ── */
    static saveSession(data) {
        try {
            const payload = {
                timestamp: Date.now(),
                freqBand: data.freqBand,
                threshold: data.threshold,
                minGap: data.minGap,
                smoothWindow: data.smoothWindow,
                vizMode: data.vizMode,
                reactorEffects: data.reactorEffects,
                reactorIntensity: data.reactorIntensity,
                beats: data.beats,
                bpm: data.bpm,
                duration: data.duration,
                audioFileName: data.audioFileName,
                imageFileName: data.imageFileName,
                playbackPosition: data.playbackPosition,
            };
            localStorage.setItem(LS_KEY, JSON.stringify(payload));
            return true;
        } catch (err) {
            console.warn('⚠️ localStorage save failed:', err);
            return false;
        }
    }

    static loadSession() {
        try {
            const raw = localStorage.getItem(LS_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (err) {
            console.warn('⚠️ localStorage load failed:', err);
            return null;
        }
    }

    static clearSession() {
        localStorage.removeItem(LS_KEY);
        this.clearFiles();
    }

    /** Auto-save debounce helper */
    static createDebouncedSave(delayMs = 800) {
        let timer = null;
        return (data) => {
            clearTimeout(timer);
            timer = setTimeout(() => this.saveSession(data), delayMs);
        };
    }
}