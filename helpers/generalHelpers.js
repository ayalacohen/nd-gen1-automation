import config from "./config.js"
import { logPretty, logStepMessage } from "./logger.js";

export function calculateCRC8(command) {
    const values = Buffer.from(command, "utf8"); // Encoding.UTF8.GetBytes
    let crc = 0;

    for (let i = 0; i < values.length; i++) {
        let inbyte = values[i];
        if (inbyte < 0) {
            inbyte += 256;
        }

        for (let j = 0; j < 8; j++) {
            const mix = (crc ^ inbyte) & 0x01;
            crc >>= 1;
            if (mix !== 0) {
                crc ^= 0x8C;
            }
            inbyte >>= 1;
        }
    }

    return crc & 0xff;
}

export function getRealDateTime() {
    const now = new Date();

    return {
        year: now.getFullYear(),          // 2026
        month: now.getMonth() + 1,        // 1–12
        day: now.getDate(),               // 1–31
        hour: now.getHours(),             // 0–23
        minute: now.getMinutes(),
        second: now.getSeconds()
    };
}

export function formatDay(day) {
    return day.toString().padStart(2, '0');
}

export function getMonthNameByLanguage(monthNumber) {
    const months = getMonthsByLanguage();
    return months[monthNumber - 1];
}

export function getMonthsByLanguage() {
    const monthsMap = {
        en_US: [
            'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'
        ],
        en_150: [
            'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'
        ],
        de_DE: [
            'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
            'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'
        ]
    };

    return monthsMap[config.language] || monthsMap['en_US'];
}

export function getNumberClicks(actual, target) {
    const diff = target - actual;

    return {
        nbPlus: diff > 0 ? diff : 0,
        nbMinus: diff < 0 ? Math.abs(diff) : 0
    };
}

export function getCircularClicks(actualIndex, newIndex, length) {
    const forward = (newIndex - actualIndex + length) % length;
    const backward = (actualIndex - newIndex + length) % length;

    return forward <= backward
        ? { nbPlus: forward, nbMinus: 0 }
        : { nbPlus: 0, nbMinus: backward };
}

export function getPeriodFromHour(hour24) {
    return hour24 >= 12 ? 'PM' : 'AM';
}

export function parseHour(timeStr) {
    let [hour, meridiem] = timeStr.split(" ");
    hour = parseInt(hour.split(":")[0], 10);
    if (meridiem?.toUpperCase() === "PM" && hour !== 12) hour += 12;
    if (meridiem?.toUpperCase() === "AM" && hour === 12) hour = 0;
    return hour;
}

export function formatHourToAmPm(time24) {
    let hour = parseInt(time24.split(":")[0], 10);

    const meridiem = hour >= 12 ? "PM" : "AM";
    hour = hour % 12;
    if (hour === 0) hour = 12;

    return `${hour}:00 ${meridiem}`;
}


export function getHourDiffClicks(sourceHour, targetHour) {
    let diff = targetHour - sourceHour;

    if (diff > 12) diff -= 24;
    if (diff < -12) diff += 24;

    return {
        nbPlus: diff > 0 ? diff : 0,
        nbMinus: diff < 0 ? -diff : 0
    };
}

export function getHourClicks(sourceStartDay, targetStartDay) {
    const sourceHour = parseHour(sourceStartDay);
    const targetHour = parseHour(targetStartDay);

    return getHourDiffClicks(sourceHour, targetHour);
}

export function getDoseClicks(sourceDose, targetDose) {
    const source = parseInt(sourceDose, 10);
    const target = parseInt(targetDose, 10);
    const diff = target - source;
    const clicks = diff / 50;

    return {
        nbPlus: clicks > 0 ? clicks : 0,
        nbMinus: clicks < 0 ? -clicks : 0
    };
}

export function convertHoursToSeconds(hour) {
    return hour * 3600;
}

export function convertHoursToMs(hour) {
    // 3600 * 1000
    return hour * 3600000;
}

export function changeHour(timeStr, nbChanges) {
    // Convert "4:00 AM" → 4, "10:00 PM" → 22, etc.
    let hour24 = parseHour(timeStr);

    // Add/sub hours
    hour24 = (hour24 + nbChanges) % 24;
    if (hour24 < 0) hour24 += 24;

    // Convert back to 12-hour time
    const meridiem = hour24 >= 12 ? "PM" : "AM";
    let hour12 = hour24 % 12;
    if (hour12 === 0) hour12 = 12;

    return `${hour12}:00 ${meridiem}`;
}
export function changeDose(currentValue, nbChanges) {
    const DOSE_STEPS = Object.keys(config.globalParams.doseMapping)
        .map(Number)
        .sort((a, b) => b - a);   // descending: 720→370

    const minDose = Math.min(...DOSE_STEPS);
    const maxDose = Math.max(...DOSE_STEPS);

    const newValue = Number(currentValue) + nbChanges * 50;

    // Check range
    if (newValue < minDose || newValue > maxDose) {
        throw new Error(
            `Dose change out of range: ${currentValue} + (${nbChanges * 50}) = ${newValue} not allowed`
        );
    }

    // New dose must exist in mapping
    if (!DOSE_STEPS.includes(newValue)) {
        throw new Error(
            `Invalid resulting dose: ${newValue}. Allowed: ${DOSE_STEPS.join(", ")}`
        );
    }

    return newValue.toString();
}

export function compareObjectsBeforeAfter(before, after, context = "Object") {
    logPretty(`🔎 BEFORE ${context}`, before);
    logPretty(`🔎 AFTER  ${context}`, after);

    const diffs = [];

    function compare(a, b, path = "") {
        const aType = typeof a;
        const bType = typeof b;

        if (aType !== bType) {
            diffs.push(`Type mismatch at "${path}": BEFORE(${aType}) vs AFTER(${bType})`);
            return;
        }

        if (aType !== "object" || a === null || b === null) {
            if (a !== b) {
                diffs.push(`Value mismatch at "${path}": BEFORE="${a}" vs AFTER="${b}"`);
            }
            return;
        }

        const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
        keys.forEach(key => {
            const newPath = path ? `${path}.${key}` : key;
            compare(a[key], b[key], newPath);
        });
    }

    compare(before, after);

    const hasDiffs = diffs.length > 0;

    if (hasDiffs) {
        logStepMessage(`Differences detected in ${context}:`, "warn");
        diffs.forEach(d => logStepMessage(" - " + d, "warn"));
        logStepMessage(`${context} comparison result: NOT MATCHING`);
    } else {
        logStepMessage(`${context} values match perfectly`);
    }

    return !hasDiffs; // true = same, false = different
}

export function assertComparison(before, after, expectedEqual, context = "Object") {
    const areEqual = compareObjectsBeforeAfter(before, after, context);

    if (areEqual !== expectedEqual) {
        throw new Error(
            expectedEqual
                ? `❌ ${context} differs but was expected to be the SAME`
                : `❌ ${context} is the SAME but was expected to be DIFFERENT`
        );
    }

    // Success log
    logStepMessage(
        `✅ ${context} is ${expectedEqual ? "the SAME" : "DIFFERENT"
        } as expected`
    );
}


export function getDoseConfig(totalDose) {
    // const key = String(totalDose);
    // return config.globalParams.doseMapping[key] || null;
    const key = String(totalDose);

    const dose = config.globalParams.doseMapping[key];

    if (!dose) {
        logStepMessage(`⚠️ Requested total dose ${totalDose} not found in doseMapping. Returning null.`);
        return null;
    }

    logPretty(`getDoseConfig result of ${totalDose} key`, dose);
    return dose;
}

export function isStrictValidDate(dateStr) {
    let regex, day, month, year;

    switch (config.language) {
        case "en_US": {
            // M/D/YY
            regex = /^(0?[1-9]|1[0-2])\/(0?[1-9]|[12][0-9]|3[01])\/(\d{2})$/;
            const match = dateStr.match(regex);
            if (!match) return false;

            [, month, day, year] = match;
            break;
        }

        case "en_150": {
            // DD/MM/YY  (European English)
            regex = /^(0?[1-9]|[12][0-9]|3[01])\/(0?[1-9]|1[0-2])\/(\d{2})$/;
            const match = dateStr.match(regex);
            if (!match) return false;

            [, day, month, year] = match;
            break;
        }

        case "de_DE": {
            // DD.MM.YY
            regex = /^(0?[1-9]|[12][0-9]|3[01])\.(0?[1-9]|1[0-2])\.(\d{2})$/;
            const match = dateStr.match(regex);
            if (!match) return false;

            [, day, month, year] = match;
            break;
        }

        default:
            return false;
    }

    day = Number(day);
    month = Number(month);
    year = Number(year) + 2000; // YY → 20YY

    const date = new Date(year, month - 1, day);

    // Strict validation: Date must match input values
    return (
        date.getFullYear() === year &&
        date.getMonth() === month - 1 &&
        date.getDate() === day
    );
}

export function isStrictValidTime(input) {
    const regex = /^(0?[1-9]|1[0-2]):([0-5][0-9])\s?(AM|PM)$/i;
    const match = input.match(regex);
    if (!match) return false;

    // Optional: strict normalization check (ensures single space before AM/PM)
    const normalized = `${parseInt(match[1], 10)}:${match[2]} ${match[3].toUpperCase()}`;
    return normalized === input.toUpperCase();
}

const MONTHS = {
    en_US: ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],

    en_150: ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],

    de_DE: ["Jan","Feb","Mär","Apr","Mai","Jun","Jul","Aug","Sep","Okt","Nov","Dez"],
};

const DATE_TIME_CONFIG = {

    pumpFtuDate: {

        en_US: {
            expectedFormat: 'hh:mm AM/PM ddd, DD MMM YYYY (e.g. 11:23 AM Thu, 12 Feb 2026)',
            regex: /^(0?[1-9]|1[0-2]):([0-5][0-9])\s(AM|PM)\s[A-Za-z]{3},\s(0?[1-9]|[12][0-9]|3[01])\s([A-Za-z]{3})\s(\d{4})$/,
            validator: (m, lang) => {
                const day = Number(m[4]);
                const monthIndex = getMonthIndex(m[5], lang);
                const year = Number(m[6]);
                return monthIndex !== -1 && validateDate(year, monthIndex, day);
            }
        },

        en_150: {
            expectedFormat: 'HH:mm ddd, DD MMM YYYY (e.g. 18:22 Wed, 25 Feb 2026)',
            regex: /^([01]?[0-9]|2[0-3]):([0-5][0-9])\s[A-Za-z]{3},\s(0?[1-9]|[12][0-9]|3[01])\s([A-Za-z]{3})\s(\d{4})$/,
            validator: (m, lang) => {
                const day = Number(m[3]);
                const monthIndex = getMonthIndex(m[4], lang);
                const year = Number(m[5]);
                return monthIndex !== -1 && validateDate(year, monthIndex, day);
            }
        },

        de_DE: {
            expectedFormat: 'HH:mm ddd., DD MMM. YYYY (e.g. 18:22 Mi., 25 Feb. 2026)',
            regex: /^([01]?[0-9]|2[0-3]):([0-5][0-9])\s[A-Za-zÄÖÜäöü]{2,3}\.,\s(0?[1-9]|[12][0-9]|3[01])\s([A-Za-zÄÖÜäöü]{3,5})\.?\s(\d{4})$/,
            validator: (m, lang) => {
                const day = Number(m[3]);
                const monthIndex = getMonthIndex(m[4], lang);
                const year = Number(m[5]);
                return monthIndex !== -1 && validateDate(year, monthIndex, day);
            }
        }
    },

    treatmentStarted: {

        en_US: {
            expectedFormat: 'h:mm AM/PM, M/D/YY (e.g. 1:49 PM, 2/26/26)',
            regex: /^(0?[1-9]|1[0-2]):([0-5][0-9])\s(AM|PM),\s(0?[1-9]|1[0-2])\/(0?[1-9]|[12][0-9]|3[01])\/(\d{2})$/,
            validator: (m) => {
                const month = Number(m[4]);
                const day = Number(m[5]);
                const year = Number(m[6]) + 2000;
                return validateDate(year, month - 1, day);
            }
        },

        en_150: {
            expectedFormat: 'HH:mm, DD/MM/YY (e.g. 13:49, 26/02/26)',
            regex: /^([01]?[0-9]|2[0-3]):([0-5][0-9]),\s(0?[1-9]|[12][0-9]|3[01])\/(0?[1-9]|1[0-2])\/(\d{2})$/,
            validator: (m) => {
                const day = Number(m[3]);
                const month = Number(m[4]);
                const year = Number(m[5]) + 2000;
                return validateDate(year, month - 1, day);
            }
        },

        de_DE: {
            expectedFormat: 'HH:mm, DD.MM.YY (e.g. 13:49, 26.02.26)',
            regex: /^([01]?[0-9]|2[0-3]):([0-5][0-9]),\s(0?[1-9]|[12][0-9]|3[01])\.(0?[1-9]|1[0-2])\.(\d{2})$/,
            validator: (m) => {
                const day = Number(m[3]);
                const month = Number(m[4]);
                const year = Number(m[5]) + 2000;
                return validateDate(year, month - 1, day);
            }
        }
    }
};
export function parseStrictDateTime(input, type) {
    const language = config.language;

    const typeConfig = DATE_TIME_CONFIG[type];
    if (!typeConfig) return null;

    const localeConfig = typeConfig[language];
    if (!localeConfig) return null;

    const { regex, validator } = localeConfig;

    const match = input.match(regex);
    if (!match || !validator(match, language)) {
        return null;
    }

    if (type === "pumpFtuDate") {

        let hour = Number(match[1]);
        const minute = Number(match[2]);

        if (language === "en_US") {
            const ampm = match[3];
            if (ampm === "PM" && hour !== 12) hour += 12;
            if (ampm === "AM" && hour === 12) hour = 0;
        }

        const dayIndex = language === "en_US" ? 4 : 3;
        const monthIndexPos = language === "en_US" ? 5 : 4;
        const yearIndex = language === "en_US" ? 6 : 5;

        const day = Number(match[dayIndex]);
        const monthIndex = getMonthIndex(match[monthIndexPos], language);
        const year = Number(match[yearIndex]);

        return new Date(year, monthIndex, day, hour, minute);
    }

    return null;
}

export function formatPumpRtc(date) {
    return `Y${date.getFullYear()}-M${date.getMonth()+1}-D${date.getDate()} ` +
           `H${date.getHours()}:M${date.getMinutes()}`;
}

export function isStrictValidDateTime(input, type) {
    const language = config.language;

    const typeConfig = DATE_TIME_CONFIG[type];
    if (!typeConfig) {
        logStepMessage(`❌ Unsupported type "${type}"`, "error");
        return false;
    }

    const localeConfig = typeConfig[language];
    if (!localeConfig) {
        logStepMessage(
            `❌ Unsupported language "${language}" for type "${type}"`,
            "error"
        );
        return false;
    }

    const { regex, expectedFormat, validator } = localeConfig;

    const match = input.match(regex);
    if (!match) {
        logStepMessage(
            `❌ Format mismatch. Expected: ${expectedFormat}. Actual: "${input}"`,
            "error"
        );
        return false;
    }

    const valid = validator(match, language);

    if (!valid) {
        logStepMessage(
            `❌ Logical date validation failed. Expected: ${expectedFormat}. Actual: "${input}"`,
            "error"
        );
        return false;
    }

    logStepMessage(
        `✅ OK ${type} valid (${language}): "${input}"`
    );

    return true;
}

function getMonthIndex(monthStr, language) {
    const months = MONTHS[language];
    if (!months) return -1;

    // Remove trailing dot if exists
    const normalized = monthStr.replace(/\.$/, '');

    // Match by prefix (first 3 letters)
    return months.findIndex(m => 
        normalized.toLowerCase().startsWith(m.toLowerCase())
    );
}

function validateDate(year, monthIndex, day) {
    const date = new Date(year, monthIndex, day);

    return (
        date.getFullYear() === year &&
        date.getMonth() === monthIndex &&
        date.getDate() === day
    );
}

export function matchLocalizedTemplate(alertStr, template, alertId) {
    // Escape regex special chars except %s
    const escaped = template.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');

    let firstDone = false;

    const replaced = escaped.replace(/%s/g, () => {
        if (!firstDone) {
            firstDone = true;
            return alertId;      // strict ID match
        }
        return '(.+?)';          // flexible match
    });

    // Split after the first ID and make the rest optional
    const idIndex = replaced.indexOf(alertId) + String(alertId).length;
    const head = replaced.slice(0, idIndex);
    const tail = replaced.slice(idIndex);

    const patternStr = `^${head}(${tail})?$`;

    return new RegExp(patternStr).test(alertStr);
}

export function fillTemplate(template, value1, value2 = null) {
    let replaced = template;

    // Replace first %s
    replaced = replaced.replace('%s', value1);

    // Replace second %s only if provided & template has another %s
    if (value2 !== null && replaced.includes('%s')) {
        replaced = replaced.replace('%s', value2);
    }

    return replaced;
}

export function formatSigned(n) {
    return (n >= 0 ? `+${n}` : `${n}`);
}

export function formatToDateObj(dateStr) {
    return new Date(dateStr + "T00:00:00Z");
}

export function shiftDays(dateObj, delta) {
    const d = new Date(dateObj);
    d.setUTCDate(d.getUTCDate() + delta);
    return d;
}

export function getDayDD(dateObj) {
    return String(dateObj.getUTCDate()).padStart(2, "0");
}

export function formatFlowRate(value, decimals = 3) {
    const numberValue = Number(value);
    const locale = getLocaleFromLanguage(config.language);

    return numberValue.toLocaleString(locale, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    });
}

// getLocaleFromLanguage only used to format numbers according to language
// en_150 → de-DE to get comma decimal separator
export function getLocaleFromLanguage(language) {
    if (language === "en_150") {
        return "de-DE";   // forces comma decimal
    }
    return language.replace("_", "-");
}

export function parseRtcLine(line) {
   const match = line.match(
    /H(\d+)\s+M(\d+)\s+S(\d+)\s+D(\d+)\s+M(\d+)\s+Y(\d+)/
  );

  if (!match) {
    throw new Error(`❌ Invalid RTC format: "${line}"`);
  }

  const [, hour, minute, second, day, month, year] = match.map(Number);
  return { year, month, day, hour, minute, second };
}

export function parseFtuDate(ftuDateStr) {
  const match = ftuDateStr.match(
    /^(\d{4})-(\d{2})-(\d{2}):(\d{2}):(\d{2}):(\d{2})$/
  );

  if (!match) {
    throw new Error(`❌ Invalid NV FTU date format: ${ftuDateStr}`);
  }

  const [, y, m, d, h, min, s] = match.map(Number);
  return new Date(y, m - 1, d, h, min, s);
}

export function toDate(dt) {
  return new Date(
    dt.year,
    dt.month - 1, // JS Date month is 0-based
    dt.day,
    dt.hour,
    dt.minute,
    dt.second
  );
}

export function formatDateTimeByLocale(
  { year, month, day, hour, minute },
  locale
) {
  const yy = String(year).slice(-2);
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  const min = String(minute).padStart(2, '0');

  switch (locale) {

    // 🇺🇸 English (United States)
    case 'en_US': {
      const hour12 = hour % 12 || 12;
      const ampm = hour < 12 ? 'AM' : 'PM';
      return `${month}/${day}/${yy} | ${hour12}:${min} ${ampm}`;
    }

    // 🇪🇺 English (Europe)
    case 'en_150': {
      return `${dd}/${mm}/${yy} | ${String(hour).padStart(2, '0')}:${min}`;
    }

    // 🇩🇪 German
    case 'de_DE': {
      return `${dd}.${mm}.${yy} | ${String(hour).padStart(2, '0')}:${min}`;
    }

    default:
      throw new Error(`❌ Unsupported locale for date formatting: ${locale}`);
  }
}

export function isWithinMinuteTolerance(actual, expected, toleranceMinutes) {

    const extractTime = str => {
        const m = str.match(/(\d{1,2}):(\d{2})/);
        if (!m) return null;
        return Number(m[1]) * 60 + Number(m[2]);
    };

    const actualMin = extractTime(actual);
    const expectedMin = extractTime(expected);

    if (actualMin === null || expectedMin === null) {
        return false;
    }

    return Math.abs(actualMin - expectedMin) <= toleranceMinutes;
}