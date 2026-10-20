import Database from 'better-sqlite3';
import { logStepMessage } from './logger.js';

export function openDb(dbFile) {
    return new Database(dbFile);
}

export function verifyRegimenPassed(dbFile, expectedRegimen) {
    logStepMessage(`▶️ Verifying CS logs for regimen ${JSON.stringify(expectedRegimen)}`);
    const db = new Database(dbFile, { readonly: true });

    const rows = /** @type {DbRow[]} */ (db.prepare(`
        SELECT type_id, field_a, field_c
        FROM log_event
        WHERE type_id IN (300, 301, 500)
    `).all());

    let failures = [];

    // Helper to compare JSON objects
    const isEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

    // -------------------------
    // Check all entries of type 300 (download)
    // -------------------------
    const type300Rows = rows.filter(r => r.type_id === 300);

    if (type300Rows.length === 0) {
        failures.push("❌ No type 300 entries found");
    } else {
        const found = type300Rows.some(r => {
            try {
                const parsed = JSON.parse(r.field_c);
                return isEqual(parsed, expectedRegimen);
            } catch {
                return false;
            }
        });

        if (found) {
            logStepMessage("✅ Found at least one type 300 entry with expected regimen");
        } else {
            failures.push("❌ No type 300 entry matches expected regimen");
        }
    }

    // -------------------------
    // Check all entries of type 301 (upload)
    // -------------------------
    const type301Rows = rows.filter(r => r.type_id === 301);

    if (type301Rows.length === 0) {
        failures.push("❌ No type 301 entries found");
    } else {
        const found = type301Rows.some(r => {
            try {
                const parsed = JSON.parse(r.field_c);
                return isEqual(parsed, expectedRegimen);
            } catch {
                return false;
            }
        });

        if (found) {
            logStepMessage("✅ Found at least one type 301 entry with expected regimen");
        } else {
            failures.push("❌ No type 301 entry matches expected regimen");
        }
    }

    // -----------------------------
    // Check 500 (dev)
    // -----------------------------
    const row500 = rows.find(r => r.type_id === 500 && r.field_a === "Regimen Verification Passed");
    if (row500) {
        logStepMessage("✅ Found type 500 'Regimen Verification Passed'");
    } else {
        failures.push("❌ No type 500 'Regimen Verification Passed' entry");
    }

    // -----------------------------
    // Final decision
    // -----------------------------
    if (failures.length > 0) {
        logStepMessage("❌ CS Logs 'regimen verification passed' failed:\n" + failures.join("\n"));
        throw new Error("❌ CS Logs 'regimen verification passed' failed");
    } else {
        logStepMessage("✅ CS Logs 'regimen verification passed' passed");
    }
}
export function verifyRegimenFailed(dbFile, expectedJsonFor300, expectedJsonFor301, expectedTextFor206) {
    logStepMessage(`▶️ Veryifying CS logs for failed regimen`);
    const db = new Database(dbFile, { readonly: true });

    const rows = /** @type {DbRow[]} */ (db.prepare(`
        SELECT type_id, field_a, field_c
        FROM log_event
        WHERE type_id IN (206, 300, 301, 500)
    `).all());

    let failures = [];

    // Helper to compare JSON objects
    const isEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

    // -------------------------
    // Check all entries of type 300 (download)
    // -------------------------
    const type300Rows = rows.filter(r => r.type_id === 300);

    if (type300Rows.length === 0) {
        failures.push("❌ No type 300 entries found");
    } else {
        const found = type300Rows.some(r => {
            try {
                const parsed = JSON.parse(r.field_c);
                return isEqual(parsed, expectedJsonFor300);
            } catch {
                return false;
            }
        });

        if (found) {
            logStepMessage(`✅ Found at least one type 300 entry with expected ${JSON.stringify(expectedJsonFor300)}`);
        } else {
            failures.push(`❌ No type 300 entry matches expected ${JSON.stringify(expectedJsonFor300)}`);
        }
    }

    // -------------------------
    // Check all entries of type 301 (upload)
    // -------------------------
    const type301Rows = rows.filter(r => r.type_id === 301);

    if (type301Rows.length === 0) {
        failures.push("❌ No type 301 entries found");
    } else {
        const found = type301Rows.some(r => {
            try {
                const parsed = JSON.parse(r.field_c);
                return isEqual(parsed, expectedJsonFor301);
            } catch {
                return false;
            }
        });

        if (found) {
            logStepMessage(`✅ Found at least one type 301 entry with expected ${JSON.stringify(expectedJsonFor301)}`);
        } else {
            failures.push(`❌ No type 301 entry matches expected ${JSON.stringify(expectedJsonFor301)}`);
        }
    }

    // -----------------------------
    // Check 500 (dev)
    // -----------------------------
    const row500 = rows.find(r => r.type_id === 500 && r.field_a === "Regimen Verification Failed");
    if (row500) {
        logStepMessage("✅ Found type 500 'Regimen Verification Failed'");
    } else {
        failures.push("❌ No type 500 'Regimen Verification Failed' entry");
    }

    // -------------------------
    // Check all entries of type 206 (application)
    // -------------------------
    const type206Rows = rows.filter(r => r.type_id === 206);

    if (type206Rows.length === 0) {
        failures.push("❌ No type 206 entries found");
    } else {
        const found = type206Rows.some(r => {
            try {
                return isEqual(r.field_a, expectedTextFor206);
            } catch {
                return false;
            }
        });

        if (found) {
            logStepMessage(`✅ Found at least one type 206 entry with expected '${expectedTextFor206}'`);
        } else {
            failures.push(`❌ No type 206 entry matches expected '${expectedTextFor206}'`);
        }
    }

    // -----------------------------
    // Final decision
    // -----------------------------
    if (failures.length > 0) {
        logStepMessage("❌ CS Logs 'regimen verification failed' failed:\n" + failures.join("\n"));
        throw new Error("❌ CS Logs 'regimen verification failed' failed");
    } else {
        logStepMessage("✅ CS Logs 'regimen verification failed' passed");
    }
}

export function verifyStartFilling(dbFile) {
    logStepMessage(`▶️ Veryifying CS logs for start filling`);
    const db = new Database(dbFile, { readonly: true });

    const expectedSequence = [
        {
            label: "Start WD Test command",
            match: r =>
                r.type_id === 502 &&
                r.field_c?.includes("Pump Command: Start WD Test")
        },
        {
            label: "WD Test Started",
            match: r =>
                r.type_id === 316 &&
                r.field_a === "Started"
        },
        {
            label: "WD Test Passed",
            match: r =>
                r.type_id === 316 &&
                r.field_a === "Passed"
        },
        {
            label: "Start Filling Medication command",
            match: r =>
                r.type_id === 502 &&
                r.field_c?.includes("Pump Command: Start Filling Medication")
        }
    ];

    const rows = /** @type {DbRow[]} */ (db.prepare(`
            SELECT id, type_id, field_a, field_c
            FROM log_event
            WHERE (
                type_id = 316
                OR (
                    type_id = 502
                    AND (
                        field_c LIKE '%Pump Command: Start WD Test%'
                        OR field_c LIKE '%Pump Command: Start Filling Medication%'
                    )
                )
            )
            ORDER BY id
    `).all());
//     id	type_id	field_a	field_c
// 55409	502	Writes	Pump Command: Start WD Test; Command Data: {0x00} Raw: {0x0C, 0x00}
// 55410	316	Started	-
// 55507	316	Passed	-
// 55527	502	Writes	Pump Command: Start Filling Medication; Command Data: {0x00} Raw: {0x0A, 0x00}

    logStepMessage("CS log rows:\n" + JSON.stringify(rows, null, 2));

    let ok = true;
    let errors = [];

    // --------------------
    // 1️⃣ Detect missing logical entries
    // --------------------
    expectedSequence.forEach(step => {
        const exists = rows.some(step.match);
        if (!exists) {
            ok = false;
            errors.push(`Missing log entry: ${step.label}`);
        }
    });

    // --------------------
    // 2️⃣ Count mismatch hint
    // --------------------
    if (rows.length !== 4) {
        ok = false;
        errors.push(`Expected 4 CS log entries, found ${rows.length}`);
    }

    // --------------------
    // 3️⃣ Order check (only if we have enough rows)
    // --------------------
    const minLen = Math.min(rows.length, expectedSequence.length);

    for (let i = 0; i < minLen; i++) {
        if (!expectedSequence[i].match(rows[i])) {
            ok = false;
            errors.push(
                `Order mismatch at position ${i + 1}. ` +
                `Expected "${expectedSequence[i].label}", got ` +
                `type_id=${rows[i].type_id}, field_a=${rows[i].field_a}, field_c=${rows[i].field_c}`
            );
        }
    }

    // --------------------
    // 4️⃣ Final decision
    // --------------------
    if (ok) {
        logStepMessage("✅ CS start filling log sequence verified successfully");
    } else {
        errors.forEach(e => logStepMessage("❌ " + e));
        throw new Error("CS start filling log verification failed");
    }

}

export function verifyStartFillingAfterNoResetOfLastFillingPercentage(dbFile) {
    logStepMessage(`▶️ Veryifying CS logs for start filling after no reset of last filling percentage`);
    const db = new Database(dbFile, { readonly: true });

    const expectedSequence = [
        {
            label: "Start WD Test command",
            match: r =>
                r.type_id === 502 &&
                r.field_a === "Reads" &&
                r.field_c?.includes("100% Raw")
        },
        {
            label: "WD Test Started",
            match: r =>
                r.type_id === 316 &&
                r.field_a === "Started"
        },
        {
            label: "WD Test Passed",
            match: r =>
                r.type_id === 316 &&
                r.field_a === "Passed"
        },
        {
            label: "Start Filling Medication command",
            match: r =>
                r.type_id === 502 &&
                r.field_a === "Writes" &&
                r.field_c?.includes("Pump Command: Start Filling Medication")
        }
    ];

    const rows = /** @type {DbRow[]} */ (db.prepare(`
            SELECT id, type_id, field_a, field_c
            FROM log_event
            WHERE (
                type_id = 316
                OR (
                    type_id = 502
                    AND (
                            (field_a = 'Reads' AND field_b = 'Medicine Filling Status' AND field_c LIKE '100% Raw: %')
                        OR 
                            (field_a = 'Writes' AND field_b = 'Pump Command' AND field_c LIKE 'Pump Command: Start Filling Medication%')
                    )
                )
            )
            ORDER BY id
    `).all());
//     id	type_id	field_a	field_b	field_c
// 1050132	502	Reads	Medicine Filling Status	100% Raw: {0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03, 0x64}	
// 1050146	316	Started	-	-
// 1050234	316	Passed	-	-
// 1050251	502 Writes	Pump Command	Pump Command: Start Filling Medication; Command Data: {0x00} Raw: {0x0A, 0x00}

    logStepMessage("CS log rows:\n" + JSON.stringify(rows, null, 2));

    let ok = true;
    let errors = [];

    // --------------------
    // 1️⃣ Detect missing logical entries
    // --------------------
    expectedSequence.forEach(step => {
        const exists = rows.some(step.match);
        if (!exists) {
            ok = false;
            errors.push(`Missing log entry: ${step.label}`);
        }
    });

    // --------------------
    // 2️⃣ Count mismatch hint
    // --------------------
    if (rows.length !== 4) {
        ok = false;
        errors.push(`Expected 4 CS log entries, found ${rows.length}`);
    }

    // --------------------
    // 3️⃣ Order check (only if we have enough rows)
    // --------------------
    const minLen = Math.min(rows.length, expectedSequence.length);

    for (let i = 0; i < minLen; i++) {
        if (!expectedSequence[i].match(rows[i])) {
            ok = false;
            errors.push(
                `Order mismatch at position ${i + 1}. ` +
                `Expected "${expectedSequence[i].label}", got ` +
                `type_id=${rows[i].type_id}, field_a=${rows[i].field_a}, field_c=${rows[i].field_c}`
            );
        }
    }

    // --------------------
    // 4️⃣ Final decision
    // --------------------
    if (ok) {
        logStepMessage("✅ CS start filling log sequence verified successfully");
    } else {
        errors.forEach(e => logStepMessage("❌ " + e));
        throw new Error("CS start filling log verification failed");
    }

}

export function verifyDbEntry(dbFile, criteria) {
    const db = new Database(dbFile, { readonly: true });

    if (criteria.type_id === undefined) {
        throw new Error("verifyDbEntry requires type_id");
    }

    let query = `
        SELECT id, type_id, field_a, field_b, field_c, field_d, log_where
        FROM log_event
        WHERE type_id = ?
    `;

    const params = [criteria.type_id];

    const addCondition = (fieldName, value) => {
        if (value === undefined) return;

        // LIKE with multiple values
        if (typeof value === "object" && value.like !== undefined) {
            const likes = Array.isArray(value.like)
                ? value.like
                : [value.like];

            for (const likeValue of likes) {
                query += ` AND ${fieldName} LIKE ?`;
                params.push(`%${likeValue}%`);
            }
        } else {
            // Exact match
            query += ` AND ${fieldName} = ?`;
            params.push(value);
        }
    };

    addCondition("field_a", criteria.field_a);
    addCondition("field_b", criteria.field_b);
    addCondition("field_c", criteria.field_c);
    addCondition("field_d", criteria.field_d);
    addCondition("log_where", criteria.log_where);

    const row = db.prepare(query).get(...params);

    const exists = !!row;

    const formatCriteria = (c) =>
        Object.entries(c)
            .map(([k, v]) => {
                if (typeof v === "object" && v !== null && v.like !== undefined) {
                    const likes = Array.isArray(v.like) ? v.like : [v.like];

                    return likes
                        .map(likeVal => `${k} LIKE "%${likeVal}%"`)
                        .join(" AND ");
                }

                return `${k}="${v}"`;
            })
            .join(", ");

    if (exists) {
        logStepMessage(`✅ Found entry (${formatCriteria(criteria)})`);
    } else {
        logStepMessage(`❌ Missing entry (${formatCriteria(criteria)})`);
    }

    return exists;
}