/**
 * Undo/Redo manager for beat marker edits.
 * Stores snapshots of the beats array with a max history limit.
 */
export class UndoManager {
    constructor(maxHistory = 50) {
        this.maxHistory = maxHistory;
        this.undoStack = [];   // Past states
        this.redoStack = [];   // Future states (cleared on new action)
        this._locked = false;  // Prevent recording during undo/redo
    }

    /** Save current state before making a change */
    push(beats) {
        if (this._locked) return;
        this.undoStack.push(JSON.parse(JSON.stringify(beats)));
        if (this.undoStack.length > this.maxHistory) this.undoStack.shift();
        this.redoStack = [];  // Clear redo — new branch
    }

    /** Undo — returns the previous beats array, or null if nothing to undo */
    undo(currentBeats) {
        if (this.undoStack.length === 0) return null;
        this._locked = true;
        this.redoStack.push(JSON.parse(JSON.stringify(currentBeats)));
        const previous = this.undoStack.pop();
        this._locked = false;
        return previous;
    }

    /** Redo — returns the next beats array, or null if nothing to redo */
    redo(currentBeats) {
        if (this.redoStack.length === 0) return null;
        this._locked = true;
        this.undoStack.push(JSON.parse(JSON.stringify(currentBeats)));
        const next = this.redoStack.pop();
        this._locked = false;
        return next;
    }

    get canUndo() { return this.undoStack.length > 0; }
    get canRedo() { return this.redoStack.length > 0; }

    clear() {
        this.undoStack = [];
        this.redoStack = [];
    }
}