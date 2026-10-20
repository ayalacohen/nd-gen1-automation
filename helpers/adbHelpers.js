// helpers/adbHelpers.js
import { execSync, spawn } from "child_process";
import { logStepMessage } from "./logger.js";
import { buildSelectorById, isElementDisplayedById, waitForVisibleWithRetry } from "./uiHelpers.js";

import config from './config.js';

/* -------------------------
   Low-level host adb exec
   (blocking, sync)
   ------------------------- */
export function adbExec(command, allowFail = false) {
  try {
    const output = execSync(`adb ${command}`, { encoding: "utf8" });
    const out = output ? output.toString().trim() : "";
    logStepMessage(`📱 adb ${command} → ${out}`);
    return out;
  } catch (err) {
    logStepMessage(`❌ adb ${command} failed → ${err.message}`, "error");
    if (!allowFail) throw err;
    return null;
  }
}

/* -------------------------
   Blocking adb shell (host)
   with small timeout (avoid hang)
   ------------------------- */
export function adbShellBlocking(cmd, allowFail = false, timeout = 5000) {
  try {
    const output = execSync(`adb shell "${cmd}"`, {
      encoding: "utf8",
      stdio: "pipe",
      timeout,
    });
    const out = output ? output.toString().trim() : "";
    logStepMessage(`📱 adb shell "${cmd}" → ${out}`);
    return out;
  } catch (err) {
    if (!allowFail) {
      logStepMessage(`❌ adb shell "${cmd}" failed → ${err.message}`, "error");
      throw err;
    }
    logStepMessage(`⚠️ adb shell "${cmd}" (allowFail) → ${err?.message || err}`, "warn");
    return null;
  }
}

/* -------------------------
   Execute "mobile: shell" when Appium session exists
   (preferred because it runs within Appium process)
   ------------------------- */
export async function adbShellMobile(cmd, options = { timeout: 5000 }) {
  try {
    // prefer browser.execute when session exists
    if (typeof browser !== "undefined" && browser?.sessionId) {
      // Appium mobile: shell expects command + args (array) for better portability
      // We'll use "sh -c '...'" so we can run complex strings
      const res = await browser.execute("mobile: shell", {
        command: "sh",
        args: ["-c", cmd],
        includeStderr: true,
        timeout: options.timeout,
      });
      // `res` may be object {stdout, stderr, exitCode} depending on Appium plugin - normalize
      const out =
        typeof res === "string"
          ? res
          : (res?.stdout ?? "") + (res?.stderr ? `\nERR:${res.stderr}` : "");
      logStepMessage(`📱 mobile:shell "${cmd}" → ${String(out).trim()}`);
      return out;
    } else {
      // fallback: host adb shell
      return adbShellBlocking(cmd, false, options.timeout);
    }
  } catch (err) {
    logStepMessage(`❌ mobile:shell "${cmd}" failed → ${err.message || err}`, "error");
    throw err;
  }
}

/* -------------------------
   Async/Detached adb shell (long-running on-device process)
   returns child process (detached) — caller can keep ref to kill()
   ------------------------- */
export async function adbShellAsync(cmd) {
  logStepMessage(`▶️ adb async: ${cmd}`);
  // spawn adb shell as detached process so it survives parent exit when desired
  const proc = spawn("adb", ["shell", cmd], {
    stdio: "ignore",
    detached: true,
    shell: true,
  });

  proc.on("error", (err) => {
    logStepMessage(`❌ adb async failed: ${cmd} → ${err.message}`, "error");
  });

  // Return proc (caller may store & kill later using proc.kill())
  return proc;
}

/* -------------------------
   Device health helpers
   ------------------------- */
function pause(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * waitForDeviceOnline
 * - restarts adb server, waits for device to appear with state 'device',
 * - then waits for Android boot property sys.boot_completed === '1'
 */
export async function waitForDeviceOnline(timeoutMs = 120000) {
  const end = Date.now() + timeoutMs;
  logStepMessage("⏳ Waiting for device to be ONLINE (ADB)...");

  // Restart adb to avoid stale connections
  logStepMessage("🔄 Restarting adb server...");
  try {
    adbExec("kill-server", true);
    adbExec("start-server", true);
  } catch (e) {
    // ignore
  }

  // small delay for adb to restart
  await pause(2000);

  // Wait for a device line with 'device'
  while (Date.now() < end) {
    let devices = "";
    try {
      devices = execSync("adb devices", { encoding: "utf8" });
    } catch (err) {
      await pause(1000);
      continue;
    }
    const lines = devices.split("\n").map((l) => l.trim()).filter(Boolean);
    // skip header
    const deviceLine = lines.slice(1).find((l) => l.match(/\S+\s+\S+/));
    if (!deviceLine) {
      await pause(1000);
      continue;
    }
    const parts = deviceLine.split(/\s+/);
    const state = parts[1] ?? "";
    if (state === "device") {
      logStepMessage("✅ Device ADB state: device");
      break;
    }
    if (state === "offline") {
      logStepMessage("⚠️ Device offline — trying reconnect", "warn");
      try { adbExec("reconnect", true); } catch (_) { }
    }
    await pause(1000);
  }

  // wait for Android to finish booting
  logStepMessage("⏳ Waiting for Android boot...");
  while (Date.now() < end) {
    try {
      const prop = adbShellBlocking('getprop sys.boot_completed', true, 3000);
      if (prop && prop.trim() === "1") {
        logStepMessage("✅ Android boot completed");
        return;
      }
    } catch (_) { }
    await pause(10000); //1000
  }

  throw new Error("❌ waitForDeviceOnline timed out");
}

/**
 * waitForAppReady
 * - waits for tvHeaderSystemClock (your app) to be visible
 * - checks if tvALarmTitle displayed before throwing error
 * - uses uiHelpers: waitForVisibleWithRetry and isElementDisplayedById
 * - timeout 1mn: though takes very less, affects only tm354 with some wasted time
 */
export async function waitForAppReady(timeout = 60000) {
  logStepMessage("⏳ Waiting for app UI ready…");
  try {
    await waitForVisibleWithRetry(buildSelectorById("tvHeaderSystemClock"), buildSelectorById("tvThird"), timeout, 5000);
    logStepMessage("✅ App UI ready");
  } catch (err) {
    if (await isElementDisplayedById('tvAlarmTitle')) {
      logStepMessage("✅ App UI ready (alarm displayed)");
      return;
    }
    logStepMessage("❌ App UI not ready: " + err.message, "error");
    throw err;
  }
}

/* -------------------------
   Reboot flow (improved)
   - reboot device, wait for ADB, wait for Android boot
   - DOES NOT attempt to restart WDIO session; caller must handle session (relaunchActiveApp)
   ------------------------- */
export async function adbReboot() {
  logStepMessage("🔁 Reboot device");
  try {
    adbExec("reboot");
  } catch (err) {
    // ignore if reboot command failed locally - still continue to wait
    logStepMessage(`⚠️ adb reboot returned error: ${err.message}`, "warn");
  }

  // wait for device online + boot complete
  await waitForDeviceOnline(180000); // 3 minutes default
  // caller should relaunch app or restart WDIO session as needed
}

export async function restartUiAutomator2() {
  logStepMessage("🔄 Restarting UiAutomator2 server…");

  await adbShellBlocking("am force-stop io.appium.uiautomator2.server");
  await adbShellBlocking("am force-stop io.appium.uiautomator2.server.test");

  await pause(1500);

  // Force Appium to reconnect/start Uia2 server via a harmless call
  try {
    await driver.getPageSource();   // triggers uia2 bootstrap if needed
  } catch (e) {
    // one retry after timeout
    await pause(1500);
    await driver.getPageSource();
  }

  logStepMessage("✅ UiAutomator2 restarted");
}

async function ensureAppiumSession() {
  if (browser && browser.sessionId) return;

  logStepMessage("♻️ Creating new Appium session...");

  await browser.reloadSession();

  logStepMessage("✅ New Appium session ready");
}
async function waitForUiAutomator2(timeout = 20000) {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    try {
      await browser.getPageSource();   // will fail until UiA2 is alive
      return;
    } catch (_) { }

    await pause(1000);
  }

  throw new Error("❌ UiAutomator2 did not start in time");
}

/* -------------------------
   Mock control (interrupt_script_mock, server_daemon_mock)
   - start/stop with verification
   ------------------------- */
let interruptMockProc = null;
let serverMockProc = null;

/**
 * verifyProcessRunning
 * - checks 'ps | grep name' result for process presence.
 */
export function verifyProcessRunning(processName, allowFail = true) {
  try {
    const res = adbShellBlocking(`ps | grep ${processName}`, allowFail, 3000);
    if (!res) return false;
    return res.includes(processName);
  } catch (err) {
    return false;
  }
}

/**
 * startInterruptScriptMock
 * - spawns process in background via adbShellAsync
 */
export async function startInterruptScriptMock() {
  logStepMessage("▶️ Starting interrupt_script_mock");
  interruptMockProc = await adbShellAsync("/system/bin/sh /data/interrupt_script_mock.sh");
  logStepMessage("✅ interrupt_script_mock started");
}

/**
 * startServerMock
 */
export async function startServerMock() {
  logStepMessage("▶️ Starting server_daemon_mock");
  serverMockProc = await adbShellAsync("/data/server_daemon_mock");
  logStepMessage("✅ server_daemon_mock started");
}

/**
 * startMocks
 */
export async function startMocks() {
  try {
    logStepMessage("▶️ Starting mocks…");

    adbStopService("interrupt_script");
    // adbStopService("server_daemon");

    await startInterruptScriptMock();
    // await startServerMock();

    logStepMessage("✅ Mocks started successfully");
  } catch (err) {
    logStepMessage(`❌ Failed to start mocks: ${err.message}`, "error");
    throw err;
  }
}

/**
 * stopMocks
 * - kill local spa wn references and attempt to stop system services
 */
export function stopMocks() {
  logStepMessage("🛑 Stopping mocks…");
  try {
    if (interruptMockProc && !interruptMockProc.killed) interruptMockProc.kill("SIGINT");
    if (serverMockProc && !serverMockProc.killed) serverMockProc.kill("SIGINT");
  } catch (err) {
    logStepMessage("⚠️ Error stopping local procs: " + err.message, "warn");
  }
  adbStopService("interrupt_script");
  adbStopService("server_daemon");
  logStepMessage("✅ Mocks stopped");
}

/* -------------------------
   Helper: waitForProcess on-device
   ------------------------- */
export async function waitForProcess(processName, timeoutMs = 10000, intervalMs = 1000) {
  const end = Date.now() + timeoutMs;
  const pattern = processName.replace(".sh", "");

  while (Date.now() < end) {
    const out = adbShellBlocking(`ps | grep -E "${pattern}|${pattern}\\.sh"`, true, 3000);

    // If grep finds ANY match mentioning the script name
    if (out && out.match(new RegExp(pattern))) {
      logStepMessage(`✅ ${processName} is active (detected by command line)`);
      return true;
    }

    // Also detect 'sh <script>'
    const out2 = adbShellBlocking(`ps | grep sh`, true, 3000);
    if (out2 && out2.includes(pattern)) {
      logStepMessage(`✅ ${processName} running under sh`);
      return true;
    }

    await pause(intervalMs);
  }

  throw new Error(`${processName} failed to start within ${timeoutMs}ms`);
}

/* -------------------------
   Utility wrappers
   ------------------------- */
export function adbStopService(name) {
  return adbShellBlocking(`stop ${name}`, true, 3000);
}

export function adbPush(local, remote) {
  logStepMessage(`⬆️ Push: ${local} → ${remote}`);
  return adbExec(`push "${local}" "${remote}"`);
}

export function adbPull(remote, local) {
  logStepMessage(`⬇️ Pull: ${remote} → ${local}`);
  return adbExec(`pull "${remote}" "${local}"`);
}

export function adbRemount() {
  return adbExec("remount");
}

export function adbVerify(remote) {
  return adbShellBlocking(`ls -l ${remote}`, true, 3000);
}

/* -------------------------
   Pump simulation helpers (convenience)
   ------------------------- */
export function adbCouplePump() {
  // use tee to ensure atomic write and avoid quoting issues
  return adbShellBlocking(`echo 0 | tee /data/testmock`);
}
export function adbDecouplePump() {
  return adbShellBlocking(`echo 1 | tee /data/testmock`);
}
export function adbReadTestMock() {
  return adbShellBlocking(`cat /data/testmock`, true);
}
export function adbConnectWC() {
  return adbShellBlocking("echo 1 | tee /sys/devices/soc0/filling_station-pm/wpc_stby/value");
}
export function adbDisconnectWC() {
  return adbShellBlocking("echo 0 | tee /sys/devices/soc0/filling_station-pm/wpc_stby/value");
}
export function adbUpdateMainSN(mainSN) {
  return adbShellBlocking(`server_daemon_nonvolotile update main_sn ${mainSN}`, true);
}

/* -------------------------
   Update config files helper (uses relaunchActiveApp)
   - updates files
   - updates main sn
   - restarts app via Appium's relaunchActiveApp when session exists
   ------------------------- */
export async function adbUpdateConfigFilesAndMainSn(apkLocalConfigFile = null, fwLocalConfigFile = null, mainSn = null) {
  const apkRemoteConfigFile = "/system/etc/cs_config.json";
  const fwRemoteConfigFile = "/system/bin/config.file";
  const fwRemoteConfigFile2 = "/data/config.file";

  adbRemount();

  if (apkLocalConfigFile) {
    adbPush(apkLocalConfigFile, apkRemoteConfigFile);
    logStepMessage("✅ APK config file updated");
  }

  if (fwLocalConfigFile) {
    adbPush(fwLocalConfigFile, fwRemoteConfigFile);
    adbPush(fwLocalConfigFile, fwRemoteConfigFile2);
    logStepMessage("✅ FW config files updated");
  }

  if (mainSn) {
    adbUpdateMainSN(mainSn);
    logStepMessage("✅ Main SN updated");
  }

  // Prefer relaunchActiveApp (Appium) to keep same session if possible
  // Relaunch app (Android-6 safe)
  if (typeof browser !== "undefined") {
    await relaunchApp({ mode: "soft" });
  }
}

export async function adbDownloadFile(remoteFile, localFile) {
  adbPull(remoteFile, localFile);
  logStepMessage("✅ File downloaded");
}

export function adbDownloadCSLogs(dbFile) {
  logStepMessage("▶️ Download CS Logs");
  adbDownloadFile(`/data/data/com.neuroderm.station/databases/control_station_logs.db`, dbFile);
}

export function adbGetDeviceDate() {
  const raw = adbShellBlocking(`date +"%Y-%m-%d"`);
  return raw.trim();  // "2025-11-29"
}
export function adbGetDeviceDateTime() {
  const raw = adbShellBlocking(
    "date +%Y-%m-%d\\ %H:%M:%S"
  ).trim();

  // 2025-11-29 09:11:07
  const [datePart, timePart] = raw.split(" ");

  if (!timePart) {
    throw new Error(`❌ adb date returned no time: "${raw}"`);
  }

  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute, second] = timePart.split(":").map(Number);

  return { year, month, day, hour, minute, second };
}

export function adbGetNonvolatileData() {
  const output = adbShellBlocking('server_daemon_nonvolotile print');

  if (!output) {
    throw new Error('❌ No output from nonvolatile print');
  }

  // Extract only relevant lines (ignore zeros/noise)
  const lines = output
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.includes('='));

  const data = {};

  for (const line of lines) {
    const [key, value] = line.split('=');
    if (key && value) {
      data[key.trim()] = value.trim();
    }
  }

  return {
    main_sn: data.main_sn,
    main_pn: data.main_pn,
    som_sn: data.som_sn,
    cradle_sn: data.cradle_sn,
    ftu_date: data.ftu_date,
    crc: data.crc
  };
}

async function softRelaunch() {
  // Android 6: safest "minimal touch"
  await browser.execute('mobile: startActivity', {
    appPackage: config.appPackage,
    appActivity: config.mainActivity,
    intentAction: 'android.intent.action.MAIN',
    intentCategory: 'android.intent.category.LAUNCHER',
    flags: 0x10200000 // FLAG_ACTIVITY_REORDER_TO_FRONT | NEW_TASK
  });

  await waitForAppReady();
}

async function hardRelaunch() {
  await browser.execute('mobile: clearApp', {
    appId: config.appPackage
  });

  await browser.execute('mobile: startActivity', {
    appPackage: config.appPackage,
    appActivity: config.mainActivity
  });

  await waitForAppReady();
}
export async function relaunchApp({ mode = "soft" } = {}) {
  logStepMessage(`▶️ Relaunching app (mode=${mode})...`);

  try {
    if (mode === "soft") {
      await softRelaunch();
      return;
    }

    if (mode === "hard") {
      await hardRelaunch();
      return;
    }
  } catch (err) {
    logStepMessage(`⚠️ ${mode} relaunch failed: ${err.message}`, "warn");
  }

  // Recovery chain
  try {
    await restartUiAutomator2();
    await waitForAppReady();
    return;
  } catch (err) {
    logStepMessage(`UiAutomator2 restart failed: ${err.message}`, "warn");
  }

  try {
    await waitForDeviceOnline();
    await waitForAppReady();
    return;
  } catch (err) {
    logStepMessage(`ADB restart/Connect device failed": ${err.message}`, "warn");
  }

  await browser.reloadSession();
  await waitForAppReady();
}
