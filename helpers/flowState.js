import fs from "fs";
import path from "path";

// File where the state will be stored
const stateFile = path.resolve("./flowState.json");

// Default state
const defaultState = {
    lastTest: null,
    lastSuccess: false,
    lastCategory: null
};

// Load previous state (if exists)
export function loadState() {
    try {
        if (fs.existsSync(stateFile)) {
            const content = fs.readFileSync(stateFile, "utf8");
            return JSON.parse(content);
        }
    } catch (err) {
        console.error("Failed to load flowState:", err);
    }
    return { ...defaultState };
}

// Save state to disk
export function saveState(state) {
    try {
        fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
    } catch (err) {
        console.error("Failed to save flowState:", err);
    }
}

// Mutable state used by tests
export const flowState = loadState();

// Reset state when called manually (from PowerShell)
export function resetState() {
    saveState({ ...defaultState });
}
