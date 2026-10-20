import allureReporter from '@wdio/allure-reporter';
import { attachScreenshotFn, attachText } from './screenshot.js';

export function logStepMessage(message, level = "info") {
    const now = new Date();
    const ms = String(now.getMilliseconds()).padStart(3, "0"); // always 3 digits
    const timeStr = now.toLocaleTimeString('en-US', { hour12: false }) + '.' + ms; // "15:20:48.725"
    message = `[${timeStr}] ${message}`;
    // Console logging (with colors)
    switch (level) {
        case "warn":
            console.warn(message);
            break;
        case "error":
            console.error(message);
            break;
        default:
            console.log(message);
    }

    
    // ✅ Call Allure reporter ONLY if browser session exists
    if (typeof browser !== 'undefined' && browser.sessionId) {
        // Allure sub-step
        let status = "passed"; // default
        if (level === "error") {
            status = "failed";
        }
        try {
            allureReporter.addStep(message, undefined, /** @type {any} */ (status));
        } catch (_) {
            // Silent fail – Allure not available outside WDIO
        }
    }
}

export async function logStep(stepName, stepFn, options = {}) {
    const { softFail = false } = options;

    await allureReporter.startStep(stepName);
    console.log(stepName);

    try {
        const result = await stepFn();

        // if a subStep returned failure info, propagate it
        if (softFail && result && result.success === false) {
            await allureReporter.endStep(/** @type {any} */ ('failed'));
            return result;
        }

        await allureReporter.endStep(/** @type {any} */ ('passed'));
        return result;
    } catch (error) {
        logStepMessage(error.stack || error.message, "error");

        // Attach screenshot on step failure
        await attachScreenshotFn(`${stepName} - Failed`);

        const status = error.isInfra ? "broken" : "failed";
        await allureReporter.endStep(/** @type {any} */ (status));

        if (softFail) {
            // swallow but report failure upward
            return { success: false, error };
        }

        throw error;
    }
}

export async function logSubStep(stepName, stepFn, options = {}) {
  const { softFail = false } = options;
    // Start nested step
    await allureReporter.startStep(stepName);
    console.log(stepName);

    try {
        const result = stepFn ? await stepFn() : null;

        await allureReporter.endStep(/** @type {any} */ ('passed'));
        return result;

    } catch (error) {
        logStepMessage(error.stack || error.message, "error");

        await attachScreenshotFn(`${stepName} - Failed`);

        const status = error.isInfra ? "broken" : "failed";
        await allureReporter.endStep(/** @type {any} */ (status));

        if (softFail) {
        // 👉 mark but DO NOT break flow
        return { success: false, error };
        }

        throw error;
    }
}

export function logPretty(title, obj) {
    function format(value, indent = 2) {
        if (value === null || value === undefined) return "null";
        if (typeof value !== "object") return String(value);

        const pad = " ".repeat(indent);
        const entries = Object.entries(value)
            .map(([key, val]) => {
                if (typeof val === "object" && val !== null) {
                    return `${pad}${key}:\n${format(val, indent + 2)}`;
                }
                return `${pad}${key}: ${val}`;
            })
            .join("\n");

        return entries;
    }

    logStepMessage(
        `📌 ${title}:\n${format(obj)}`
    );
}