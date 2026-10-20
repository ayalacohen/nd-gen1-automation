import fs from 'fs';
import path from 'path';
import config from "../helpers/config.js";
import { logStepMessage } from './logger.js';
import { clearStringCache } from './uiHelpers.js';

let strings = {};

// load JSON file according to current language
export function loadStrings() {
    const langFile = path.join('strings', `strings_${config.language}.json`);
    if (!fs.existsSync(langFile)) {
        throw new Error(`Language file not found: ${langFile}`);
    }
    strings = JSON.parse(fs.readFileSync(langFile, 'utf-8'));
    clearStringCache();
    logStepMessage(`🌐 Loaded strings for language: ${config.language}`);
}

// get nested property by path: "screens.LANGUAGE.title_select_language"
export function getString(pathStr) {
    if (!strings) loadStrings();
    return pathStr.split('.').reduce((obj, key) => obj?.[key], strings)?.trim();
}
