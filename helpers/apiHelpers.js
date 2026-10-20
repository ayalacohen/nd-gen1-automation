import http from 'http';
import https from 'https';
import { adbGetDeviceDateTime } from './adbHelpers.js';
import { calculateCRC8, parseRtcLine } from './generalHelpers.js'
import { logStepMessage } from './logger.js';

export async function apiGet(baseUrl, path) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(path, baseUrl);
    const client = urlObj.protocol === "https:" ? https : http;

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === "https:" ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: "GET"
    };

    // @ts-ignore
    const req = client.request(options, res => {
      let response = "";
      res.on("data", chunk => (response += chunk));
      res.on("end", () => {
        logStepMessage(`🌐 API GET ${path} → ${res.statusCode}`);
        if (res.statusCode !== 200) {
          const error = new Error(
            `❌ API GET ${urlObj.href} failed: expected 200, got ${res.statusCode}`
          );
          // test/app issue, no isInfra flag
          return reject(error);
        }

        try {
          resolve({
            status: res.statusCode,
            body: response ? JSON.parse(response) : {}
          });
        } catch (e) {
          const error = new Error(
            `❌ Failed to parse JSON from GET ${urlObj.href}: ${e.message}`
          );
          // parsing failure = test/app issue
          reject(error);
        }
      });
    });

    req.on("error", err => {
      let customError;
      if (err.code === "ECONNREFUSED") {
        customError = new Error(
          `❌ API GET ${urlObj.href} → connection refused (server down?)`
        );
        // @ts-ignore
        customError.isInfra = true;
      } else if (err.code === "ENOTFOUND") {
        customError = new Error(
          `❌ API GET ${urlObj.href} → host not found`
        );
        // @ts-ignore
        customError.isInfra = true;
      } else if (err.code === "ETIMEDOUT") {
        customError = new Error(
          `❌ API GET ${urlObj.href} → request timed out`
        );
        // @ts-ignore
        customError.isInfra = true;
      } else {
        customError = new Error(
          `❌ API GET ${urlObj.href} → ${err.message}`
        );
        // no isInfra → considered test failure
      }
      reject(customError);
    });

    req.end();
  });
}

export async function apiPost(baseUrl, path, body = null) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : "";
    const urlObj = new URL(path, baseUrl);
    const client = urlObj.protocol === "https:" ? https : http;

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === "https:" ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: "POST",
      headers: {}
    };

    if (data) {
      options.headers["Content-Type"] = "application/json";
      options.headers["Content-Length"] = Buffer.byteLength(data);
    }

    // @ts-ignore
    const req = client.request(options, res => {
      let response = "";
      res.on("data", chunk => (response += chunk));
      res.on("end", () => {
        logStepMessage(`🌐 API POST ${path} → ${res.statusCode}`);
        if (res.statusCode !== 200) {
          const error = new Error(
            `❌ API POST ${urlObj.href} failed: expected 200, got ${res.statusCode}`
          );
          // test/app issue, no isInfra flag
          return reject(error);
        }

        try {
          resolve({
            status: res.statusCode,
            body: response ? JSON.parse(response) : {}
          });
        } catch (e) {
          const error = new Error(
            `❌ Failed to parse JSON from POST ${urlObj.href}: ${e.message}`
          );
          // parsing failure = test/app issue
          reject(error);
        }
      });
    });

    req.on("error", err => {
      let customError;
      if (err.code === "ECONNREFUSED") {
        customError = new Error(
          `❌ API POST ${urlObj.href} → connection refused (server down?)`
        );
        // @ts-ignore
        customError.isInfra = true;
      } else if (err.code === "ENOTFOUND") {
        customError = new Error(
          `❌ API POST ${urlObj.href} → host not found`
        );
        // @ts-ignore
        customError.isInfra = true;
      } else if (err.code === "ETIMEDOUT") {
        customError = new Error(
          `❌ API POST ${urlObj.href} → request timed out`
        );
        // @ts-ignore
        customError.isInfra = true;
      } else {
        customError = new Error(
          `❌ API POST ${urlObj.href} → ${err.message}`
        );
        // no isInfra → considered test failure
      }
      reject(customError);
    });

    if (data) req.write(data);
    req.end();
  });
}

export async function connectTwico(apiBaseUrl, portName) {
  logStepMessage("▶️ Connect TWICO");
  await apiPost(apiBaseUrl, "/api/serialPort/connect", { portName });
  logStepMessage("✅ TWICO connected");
}

export async function disconnectTwico(apiBaseUrl, portName) {
  logStepMessage("▶️ Disconnect TWICO");
  await apiPost(apiBaseUrl, "/api/serialPort/disconnect", { portName });
  logStepMessage("✅ TWICO disconnected");
}

export async function writeCommand(apiBaseUrl, commandParams) {
  logStepMessage(`▶️ Write command to TWICO - ${commandParams}`);
  await apiPost(apiBaseUrl, "/api/serialPort/writeCommand", { command: commandParams });
  logStepMessage("✅ Command sent");
}

export async function readLogs(apiBaseUrl) {
  logStepMessage("▶️ Read logs from TWICO");
  const logs = await apiGet(apiBaseUrl, "/api/serialPort/readLogs");
  logStepMessage("✅ Read logs sent");
  return logs;
}

export async function clearPumpLogs(apiBaseUrl) {
  logStepMessage("▶️ Clear pump logs from TWICO");
  await apiPost(apiBaseUrl, "/api/serialPort/clearLogs");
  logStepMessage("✅ Clear pump logs sent");
}

let LOG_DEBUG_DUMP = false;

export function setLogDebugDump(enabled) {
  LOG_DEBUG_DUMP = enabled;
}

export function buildFullLogDumpFromString(logMessage) {
  return (
    `\n\n========== FULL LOG DUMP ==========\n` +
    logMessage +
    `\n========== END LOG DUMP ==========\n`
  );
}

export function buildFullLogDumpFromLogs(logs) {
  return (
    `\n\n========== FULL LOG DUMP ==========\n` +
    logs
      .map(l => {
        const time = formatLogDeviceTime(l.deviceTime);
        return `[${time}] ${l.line}`;
      })
      .join("\n") +
    `\n========== END LOG DUMP ==========\n`
  );
}


function createDumpContext(severity, buildDump) {
  let dumpPrinted = false;
  const failures = [];

  function log(message, level = severity, { withDump = false } = {}) {
    if (withDump && !dumpPrinted) {
      logStepMessage(message + buildDump(), level);
      dumpPrinted = true;
    } else {
      logStepMessage(message, level);
    }
  }

  function recordFailure(message) {
    failures.push(message);
    log(message, severity, { withDump: true });
  }

  function finalize(shouldThrow) {
    if (!shouldThrow) {
      if (failures.length > 0) {
        logStepMessage(
          `⚠️ ${failures.length} issues detected (warn mode, no throw)`,
          "info"
        );
      }
      return;
    }

    if (failures.length === 1) {
      throw new Error(failures[0]);
    }

    if (failures.length > 1) {
      throw new Error(
        `❌ Multiple verification failures:\n${failures.join("\n")}`
      );
    }
  }

  return { log, recordFailure, finalize };
}

export function createLogDumpContext(logs, severity) {
  return createDumpContext(
    severity,
    () => buildFullLogDumpFromLogs(logs)
  );
}

export function createLogStringContext(logs, severity) {
  return createDumpContext(
    severity,
    () => buildFullLogDumpFromString(logs)
  );
}

function checkContains(logs, value) {
  if (!logs.includes(value)) {
    return {
      ok: false,
      message: `❌ Missing log: "${value}"`
    };
  }

  return {
    ok: true,
    info: `✅ Found: "${value}"`
  };
}

function checkNotContains(logs, value) {
  if (logs.includes(value)) {
    return {
      ok: false,
      message: `❌ Unexpected log FOUND: "${value}"`
    };
  }

  return {
    ok: true,
    info: `✅ Not found (as expected): "${value}"`
  };
}

function checkOrderSafe(logs, a, b) {
  const lines = logs.split("\n");

  const ai = lines.findIndex(l => l.includes(a));
  if (ai === -1) {
    return {
      ok: false,
      message: `❌ "${a}" not found`
    };
  }

  const ok = lines.slice(ai + 1).some(l => l.includes(b));

  if (!ok) {
    return {
      ok: false,
      message: `❌ Order incorrect: "${a}" → "${b}"`
    };
  }

  return {
    ok: true,
    info: `✅ Order OK: "${a}" → "${b}"`
  };
}

function validateSpecialCases(logs, value) {
  if (value === "BLE: CLOCK_SYNC") {
    return checkClockSync(logs);
  }

  if (value === "decoupled evnt:") {
    return checkDecoupled(logs);
  }

  return { ok: true };
}

function checkClockSync(logs) {
  const lines = logs.split("\n");
  const index = lines.findIndex(l => l.includes("BLE: CLOCK_SYNC"));

  let rtcLine = null;

  for (let i = 1; i <= 5 && index - i >= 0; i++) {
    if (lines[index - i].startsWith("Cnsl RTC ")) {
      rtcLine = lines[index - i];
      break;
    }
  }

  if (!rtcLine) {
    return {
      ok: false,
      message: `❌ CLOCK_SYNC found but no 'Cnsl RTC' line above`
    };
  }

  const adbDateTime = adbGetDeviceDateTime();
  const rtcDateTime = parseRtcLine(rtcLine);

  const sync = checkSyncRTC(rtcDateTime, adbDateTime);

  if (!sync.ok) return sync;

  return {
    ok: true,
    info: `🕒 CLOCK_SYNC RTC line: ${rtcLine}\n${sync.info}`
  };
}

function checkSyncRTC(
  rtcDateTime,
  adbDateTime,
  toleranceSeconds = 180
) {
  const rtcDate = new Date(
    rtcDateTime.year,
    rtcDateTime.month - 1,
    rtcDateTime.day,
    rtcDateTime.hour,
    rtcDateTime.minute,
    rtcDateTime.second
  );

  const adbDate = new Date(
    adbDateTime.year,
    adbDateTime.month - 1,
    adbDateTime.day,
    adbDateTime.hour,
    adbDateTime.minute,
    adbDateTime.second
  );

  const diffSec = Math.abs(rtcDate.getTime() - adbDate.getTime()) / 1000;

  if (diffSec > toleranceSeconds) {
    return {
      ok: false,
      message:
        `❌ RTC CLOCK_SYNC mismatch\n` +
        `RTC (Pump): ${JSON.stringify(rtcDateTime)}\n` +
        `ADB (CS): ${JSON.stringify(adbDateTime)}\n` +
        `Diff: ${diffSec.toFixed(1)}s (allowed ±${toleranceSeconds}s)`
    };
  }

  return {
    ok: true,
    info: `✅ RTC CLOCK_SYNC OK (Δ ${diffSec.toFixed(1)}s ≤ ${toleranceSeconds}s)`
  };
}

function checkDecoupled(logs) {
  const lines = logs.split("\n");
  const index = lines.findIndex(l => l.includes("decoupled evnt:"));

  const start = Math.max(0, index - 5);
  const end = Math.min(lines.length - 1, index + 5);

  let beforeMCurr = false;
  let beforeMEncd = false;
  let afterMCurr = false;
  let afterMEncd = false;

  for (let i = start; i <= end; i++) {
    if (i === index) continue;

    const line = lines[i];

    if (i < index) {
      if (line.startsWith("mCurr:")) beforeMCurr = true;
      if (line.startsWith("mEncd:")) beforeMEncd = true;
    } else {
      if (line.startsWith("mCurr:")) afterMCurr = true;
      if (line.startsWith("mEncd:")) afterMEncd = true;
    }
  }

  const ok =
    beforeMCurr &&
    beforeMEncd &&
    afterMCurr &&
    afterMEncd;

  if (!ok) {
    return {
      ok: false,
      message:
        `❌ Motor didn't work properly - decoupled evnt invalid\n` +
        `Before -> mCurr:${beforeMCurr}, mEncd:${beforeMEncd}\n` +
        `After  -> mCurr:${afterMCurr}, mEncd:${afterMEncd}`
    };
  }

  return {
    ok: true,
    info:
      `✅ Motor didn’t stop - decoupled evnt has required mCurr/mEncd lines before and after it`
  };
}

export async function delay(time) {
  return new Promise(resolve => setTimeout(resolve, time));
}

export async function verifyLogsContain(
  apiBaseUrl,
  values = "",
  waitMs = 5000,
  severity = "error",
  checkOrder = false,
  notValues = ""
) {
  const normalizedSeverity = String(severity).toLowerCase();
  const shouldThrow = normalizedSeverity === "error";

  logStepMessage(
    `⏳ Waiting ${waitMs / 1000}s for logs` +
    (values ? ` to contain: ${values}` : "") +
    (checkOrder ? " (with order check)" : "") +
    (notValues ? ` and NOT contain: ${notValues}` : "")
  );

  await delay(waitMs);

  const logs = await apiGet(apiBaseUrl, "/api/serialPort/readLogs");

  const rawLogs = (logs.body?.lines || [])
    .map(l => typeof l === "string" ? l : l.line)
    .join("\n");

  const cleanLogs = rawLogs.replace(/### \[APP\] WD KICKED ###\s*/g, "");

  const ctx = createDumpContext(
    normalizedSeverity,
    () => buildFullLogDumpFromString(cleanLogs)
  );

  const valuesArr = parseValues(values);
  const notValuesArr = parseValues(notValues);

  const foundValues = [];

  // ---- contains
  for (const v of valuesArr) {
    const res = checkContains(cleanLogs, v);

    if (!res.ok) {
      ctx.recordFailure(res.message);
      continue;
    }

    ctx.log(res.info, "info");
    foundValues.push(v);

    // ---- special cases
    const special = validateSpecialCases(cleanLogs, v);

    if (!special.ok) {
      ctx.recordFailure(special.message);
    } else if (special.info) {
      ctx.log(special.info, "info");
    }
  }

  // ---- not contains
  for (const v of notValuesArr) {
    const res = checkNotContains(cleanLogs, v);

    if (!res.ok) {
      ctx.recordFailure(res.message);
    } else {
      ctx.log(res.info, "info");
    }
  }

  // ---- order (only if ALL found)
  const allValuesFound = foundValues.length === valuesArr.length;

  if (checkOrder && allValuesFound) {
    for (let i = 1; i < foundValues.length; i++) {
      const res = checkOrderSafe(cleanLogs, foundValues[i - 1], foundValues[i]);

      if (!res.ok) {
        ctx.recordFailure(res.message);
      } else {
        ctx.log(res.info, "info");
      }
    }
  } else if (checkOrder && !allValuesFound) {
    ctx.log("ℹ️ Skipping order check due to missing values", "info");
  }

  ctx.finalize(shouldThrow);
}

export function normalizeLogs(logs, severity = "info") {
  const normalized = (logs.body?.lines || []).map(l => {
    const rawLine = typeof l === "string" ? l : l.line;

    // // ✅ remove WD KICKED
    // const cleanLine = rawLine.replace(/### \[APP\] WD KICKED ###\s*/g, "");

    return {
      line: rawLine,
      deviceTime: l?.deviceTime ?? null // 👈 KEEP RAW STRING
    };
  });

  // print once
  if (LOG_DEBUG_DUMP) {
    logStepMessage("🐞 DEBUG MODE ENABLED", severity);
    logStepMessage(buildFullLogDumpFromLogs(normalized), severity);
  }

  return normalized;
}

export function formatLogDeviceTime(raw) {
  if (!raw) return null;

  // 1. Remove timezone (+03:00 / Z)
  const noTz = raw.replace(/([+-]\d{2}:\d{2}|Z)$/, '');

  // 2. Trim/round to milliseconds (3 digits)
  return noTz.replace(/\.(\d{3})\d+$/, '.$1');
}

export function verifyLogsNormalized(
  logs,
  values = "",
  severity = "error",
  checkOrder = false,
  notValues = ""
) {
  const normalizedSeverity = String(severity).toLowerCase();
  const shouldThrow = normalizedSeverity === "error";

  const valuesArr = parseValues(values);
  const notValuesArr = parseValues(notValues);

  const ctx = createDumpContext(
    normalizedSeverity,
    () => buildFullLogDumpFromLogs(logs)
  );

  const logString = logs.map(l => l.line).join("\n");

  const foundValues = [];

  // ---- contains
  for (const v of valuesArr) {
    const res = checkContains(logString, v);

    if (!res.ok) {
      ctx.recordFailure(res.message);
      continue;
    }

    ctx.log(res.info, "info");
    foundValues.push(v);
  }

  // ---- not contains
  for (const v of notValuesArr) {
    const res = checkNotContains(logString, v);

    if (!res.ok) {
      ctx.recordFailure(res.message);
    } else {
      ctx.log(res.info, "info");
    }
  }

  // ---- order (only if ALL found)
  const allValuesFound = foundValues.length === valuesArr.length;

  if (checkOrder && allValuesFound) {
    for (let i = 1; i < foundValues.length; i++) {
      const res = checkOrderSafe(logString, foundValues[i - 1], foundValues[i]);

      if (!res.ok) {
        ctx.recordFailure(res.message);
      } else {
        ctx.log(res.info, "info");
      }
    }
  } else if (checkOrder && !allValuesFound) {
    ctx.log("ℹ️ Skipping order check due to missing values", "info");
  }

  // ---- final decision
  ctx.finalize(shouldThrow);
}

export function checkPbTimestampSeconds(logs, severity = "error") {
  const normalizedSeverity = String(severity).toLowerCase();
  const shouldThrow = normalizedSeverity === "error";

  const failures = [];

  const log = (msg, level = normalizedSeverity) =>
    logStepMessage(msg, level);

  const fail = (msg) => {
    failures.push(msg);
    log(msg);
  };

  const abort = (msg) => {
    fail(msg);
    return finalize();
  };

  // ---- find PB entry (blocking)
  const pbEntry = logs.find(l => l.line.includes('[PB] 0,'));

  if (!pbEntry) {
    return abort('❌ PB line not found');
  }

  // ---- deviceTime (blocking)
  if (!pbEntry.deviceTime) {
    return abort(
      `❌ deviceTime missing for PB line:\n${pbEntry.line}`
    );
  }

  const date = new Date(pbEntry.deviceTime);

  const expectedSeconds =
    date.getHours() * 3600 +
    date.getMinutes() * 60 +
    date.getSeconds();

  // ---- extract payload (blocking)
  const pbMatch = pbEntry.line.match(/\[PB\]\s+(.+?)`/);

  if (!pbMatch) {
    return abort(
      `❌ PB payload not found in line:\n${pbEntry.line}`
    );
  }

  const parts = pbMatch[1].split(',');
  const actualSeconds = Number(parts[parts.length - 1]);

  // ---- validation (non-blocking)
  if (actualSeconds !== expectedSeconds) {
    fail(
      [
        '❌ PB seconds mismatch',
        `expected: ${expectedSeconds}`,
        `actual:   ${actualSeconds}`,
        `deviceTime: ${pbEntry.deviceTime}`,
        `line: ${pbEntry.line}`
      ].join('\n')
    );
  } else {
    const timeStr =
      `${date.getHours().toString().padStart(2,'0')}:` +
      `${date.getMinutes().toString().padStart(2,'0')}:` +
      `${date.getSeconds().toString().padStart(2,'0')}`;


    logStepMessage(`✅ PB line "[${formatLogDeviceTime(pbEntry.deviceTime)}] ${pbEntry.line}" OK: last field (number of seconds) ${actualSeconds} matches deviceTime ${timeStr}`);
  }

  return finalize();

  function finalize() {
    if (!shouldThrow) return;

    if (failures.length === 1) {
      throw new Error(failures[0]);
    }

    if (failures.length > 1) {
      throw new Error(
        `❌ PB validation failures:\n${failures.join("\n\n")}`
      );
    }
  }
}

export function extractMicroStepsBySegment(
  logs,
  requireNightSegment = false
) {
  const segmentIndex = logs.findIndex(l =>
    l.line.includes("[DLV] Segment changed. New end time")
  );

  let segmentTime = null;

  if (segmentIndex !== -1) {
    segmentTime = logs[segmentIndex].deviceTime;
  }

  const steps = logs
    .map((l, index) => {
      const m = l.line.match(/Micro step start:\s*(\d+)/);
      if (!m) return null;

      return {
        step: Number(m[1]),
        time: l.deviceTime,
        index
      };
    })
    .filter(Boolean);

  if (segmentIndex === -1) {
    if (requireNightSegment) {
      throw new Error("❌ Segment change required but not found");
    }

    logStepMessage("⚠️ No segment change → only DAY steps", "warn");

    return {
      daySteps: steps,
      nightSteps: []
    };
  }

  const daySteps = steps.filter(s => s.index < segmentIndex);
  let nightSteps = steps.filter(s => s.index > segmentIndex);

  logStepMessage(
    `🌞 Day steps: ${daySteps.length}, 🌙 Night steps: ${nightSteps.length}`
  );

  return { daySteps, nightSteps };
}

function parseValues(input) {
  return input
    ? input.split("||").map(v => v.trim()).filter(Boolean)
    : [];
}

export async function disconnectCartridgeFromPump(apiBaseUrl) {
  logStepMessage(`▶️ Disconnect cartridge from pump`);
  await runCommands(apiBaseUrl,
    "start 60 0 end,start 61 80 100 1 end,start 62 17 end|1000"
  );
  logStepMessage(`✅ Cartridge disconnected from pump`);
}

export async function connectCartridgeToPump(apiBaseUrl) {
  logStepMessage(`▶️ Connect cartridge to pump`);
  await runCommands(apiBaseUrl,
    "start 60 0 end,start 61 80 900 1 end,start 62 76 end|1000"
  );
  logStepMessage(`✅ Cartridge connected to pump`);
}

export async function vibratorOnOff(apiBaseUrl, value) {
  logStepMessage(`▶️ Vibrator ${value == 1 ? "ON" : "OFF"}`);
  await runCommands(apiBaseUrl,
    `start 5 ${value} end|1000`
  );
  logStepMessage(`✅ Vibrator`);
}

export async function pressPumpButton(apiBaseUrl) {
  logStepMessage(`▶️ Press pump button - push`);
  await runCommands(apiBaseUrl,
    "start 58 end|7000"
  );
  logStepMessage(`✅ Pump button pressed`);
}

export async function resetPump(apiBaseUrl) {
  logStepMessage(`▶️ Reset pump - SW reset`);
  await runCommands(apiBaseUrl,
    "start 52 end|1000"
  );
  logStepMessage(`✅ Pump reset`);
}

export async function resetPumpToFTU(apiBaseUrl) {
  logStepMessage(`▶️ Reset pump to FTU - Factory reset`); //40000
  await runCommands(apiBaseUrl,
    "start 38 3 end|20000"
  );
  logStepMessage(`✅ Reset pump to FTU`);
}

export async function disconnectBle(apiBaseUrl) {
  logStepMessage(`▶️ Disconnect BLE`);
  await runCommands(apiBaseUrl,
    "start 63 end|0"
  );
  // logs
  // [BLE] Device Disconnected C:22
  // [BLE] Pump disconnected from CS
}

export async function blePumpCommand(apiBaseUrl, values) {
  logStepMessage(`▶️ BLE Pump command`);
  await runCommands(apiBaseUrl,
    `start 97 ${values} end|10000`
  );
  logStepMessage(`✅ BLE Pump command`);
}

export async function setEncoderDrugValue(apiBaseUrl, value) {
  logStepMessage(`▶️ Set Encoder Drug Value to ${value}`);
  await runCommands(apiBaseUrl,
    `start 75 ${value} end|1000`
  );
  logStepMessage(`✅ Set Encoder Drug Value`);
}

export async function setRegimenValue(apiBaseUrl, segment1Time, segment1Value, segment2Time, segment2Value) {
  logStepMessage(`▶️ Set Regimen Value`);
  await runCommands(apiBaseUrl,
    `start 56 ${segment1Time} ${segment1Value} ${segment2Time} ${segment2Value} end|5000`
  );
  logStepMessage(`✅ Set Regimen Value`);
}

export async function writeSflashParam(apiBaseUrl, paramID, writeData) {
  logStepMessage(`▶️ Write SFlash Param ${paramID} ${writeData}`);
  await runCommands(apiBaseUrl,
    `start 26 ${paramID} ${writeData} end|2000`
  );
  logStepMessage(`✅ Write SFlash Param`);
}

export async function sFlash(apiBaseUrl, mode, addrRow, paramID, writeData, addrOffset, bytesToWrite) {
  logStepMessage(`▶️ SFlash ${mode} ${addrRow} ${paramID} ${writeData} ${addrOffset} ${bytesToWrite}`);
  await runCommands(apiBaseUrl,
    `start 24 ${mode} ${addrRow} ${paramID} ${writeData} ${addrOffset} ${bytesToWrite} end|2000`
  );
  logStepMessage(`✅ SFlash ${mode} ${writeData}`);
}

export async function clockSyncronization(apiBaseUrl, value) {
  logStepMessage(`▶️ Clock Syncronization Value to ${value}`);
  await runCommands(apiBaseUrl,
    `start 50 ${value} end|3000`
  );
  logStepMessage(`✅ Clock Syncronization Value`);
}

export async function readLogsCommand(apiBaseUrl) {
  logStepMessage(`▶️ Read logs command`);
  await runCommands(apiBaseUrl,
    "start 72 1 end|1000"
  );
  logStepMessage(`✅ Read logs command`);
}

export async function updatePumpParameters(apiBaseUrl) {
  await updateParameters(apiBaseUrl);
  await updateFillingParameters(apiBaseUrl);
  await updateSDCAlarmsParameters(apiBaseUrl);
}

export async function updateParameters(apiBaseUrl) {
  logStepMessage(`▶️ Update Parameters`);
  await updateParameterValue(apiBaseUrl, "MAX_ALLOWED_CHARGING_TEMPERATURE_DEFAULT", 87, 60);
  logStepMessage(`✅ Parameters updated`);
}

export async function updateFillingParameters(apiBaseUrl) {
  logStepMessage(`▶️ Update Filling Parameters`);
  await updateParameterValue(apiBaseUrl, "VIAL_DETECT_MIN_CURRENT_DIFF_FOR_SUCCESS_DEFAULT", 8, 0);

  await updateParameterValue(apiBaseUrl, "VIAL_DETECT_MIN_CURRENT_SAMPLES_PER_MOTOR_BURST_DEFAULT", 9, 100);

  await updateParameterValue(apiBaseUrl, "FILLING_STEP_2_MIN_DRUG_VOLUME_ENC", 4, 0);
  logStepMessage(`✅ Filling Parameters updated`);
}

export async function updateSDCAlarmsParameters(apiBaseUrl) {
  logStepMessage(`▶️ Update SDC Alarms Parameters`);
  await updateParameterValue(apiBaseUrl, "PERIOD_ALARMS_HIGH_ACK", 17, 32400);
  logStepMessage(`✅ SDC Alarms Parameters updated`);
}

export async function updateParameterValue(apiBaseUrl, parameterName, parameterId, parameterValue) {
  const crcValue = calculateCRC8(`start 60 0 endstart 61 ${parameterId} ${parameterValue} 1 end`);

  logStepMessage(`▶️ Set ${parameterName} (${parameterId}) with value ${parameterValue} and crc ${crcValue}`);
  await runCommands(apiBaseUrl,
    `start 60 0 end,start 61 ${parameterId} ${parameterValue} 1 end,start 62 ${crcValue} end|1000`
  );
  logStepMessage(`✅ ${parameterName} parameter updated`);
}

export async function runCommands(apiBaseUrl, commandsInput) {
  const commandsWithPause = Array.isArray(commandsInput)
    ? commandsInput
    : commandsInput.split(",");

  for (const item of commandsWithPause) {
    const [command, pauseStr] = item.split("|");
    const pause = pauseStr ? parseInt(pauseStr, 10) : 100;

    await writeCommand(apiBaseUrl, command.trim());
    await browser.pause(pause);
  }
}
