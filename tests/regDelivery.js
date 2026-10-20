// helpers
import { apiGet, checkPbTimestampSeconds, clearPumpLogs, connectTwico, disconnectCartridgeFromPump, disconnectTwico, extractMicroStepsBySegment, formatLogDeviceTime, normalizeLogs, pressPumpButton, setLogDebugDump, updateParameterValue, verifyLogsNormalized } from '../helpers/apiHelpers.js';
import { activateRegimenAndStart, pairPump, prepareTreatmentUntilPumpReady, resetToFTU } from '../helpers/preConditionsHelpers.js';
import { buildSelectorById, enterPinCode, getElementById, getElementByIdAndText, scrollToItem, updateTimeValueWithPlusMinusClicks, updateValueWithPlusMinusClicks, waitForVisible, waitWithHeartbeat } from '../helpers/uiHelpers.js';

import { loadStrings } from '../helpers/i18n.js';
import { logStep, logStepMessage, logSubStep } from '../helpers/logger.js';

// config
import config from '../helpers/config.js';
import { flowState, saveState } from '../helpers/flowState.js';

import allureReporter from '@wdio/allure-reporter';
import { adbCouplePump, adbGetDeviceDateTime } from '../helpers/adbHelpers.js';
import { convertHoursToSeconds, getPeriodFromHour, parseHour } from '../helpers/generalHelpers.js';

/*
Precondition:
reset to FTU
pair pump
activate regimen

Loop on doseMapping regimens
    skip regimen 620 with 2 day cycles of 20 intervals (too long...)
    update regimen
    prepare treatment until push button
    update date time to be quite before day / night segment change
    start delivery
    wait and check logs flow rate, micro steps

reset to FTU to prevent treatment paused too long alarm
*/

const testKey = "regDelivery";
let preconditionsPassed = false;

describe(`loop on regimen delivery`, () => {
  const { apiBaseUrl, globalParams } = config;
  const { pumpName, portName, doseMapping } = { ...globalParams };

  const startDay = "3:00 AM";
  const startNight = "9:00 PM";

  const startDayInSeconds = convertHoursToSeconds(parseHour(startDay));
  const startNightInSeconds = convertHoursToSeconds(parseHour(startNight));

  afterEach(function () {
    const test = this.currentTest;

    if (!test || test.title === "PRECONDITIONS") return;

    flowState.lastTest = test.title;

    switch (test.state) {
      case 'passed':
        flowState.lastSuccess = true;
        break;
      case 'failed':
      case 'pending':
      default:
        flowState.lastSuccess = false;
        break;
    }

    saveState(flowState);

    logStepMessage("flowState: " + JSON.stringify(flowState, null, 2));
  });

  after(function () {
    // If at least one real test was recorded, do nothing
    if (flowState.lastTest) return;

    // Runner crashed before afterEach
    flowState.lastTest = "UNKNOWN";
    flowState.lastSuccess = false;

    saveState(flowState);

    logStepMessage("flowState: " + JSON.stringify(flowState, null, 2));
  });

  it("PRECONDITIONS", async () => {
    try {
      allureReporter.addLabel('type', 'preconditions');
      allureReporter.addLabel('testKey', testKey);
      await logStep('Load strings for selected language', async () => {
        loadStrings();
      });

      await logStep('Connect TWICO', async () => {
        await connectTwico(apiBaseUrl, portName);
      });

      await logStep('Reset to FTU', async () => {
          await resetToFTU(apiBaseUrl);
      });

      await logStep('Pair pump', async () => {
          await pairPump(pumpName);
      });

      await logStep('Activate regimen and start (until medication empty)', async () => {
          await activateRegimenAndStart();
      });

      await logStep('Update pump parameters to reduce filling time', async () => {
          await updateParameterValue(apiBaseUrl, "VIAL_DETECT_MIN_CURRENT_DIFF_FOR_SUCCESS_DEFAULT", 8, 0);

          await updateParameterValue(apiBaseUrl, "VIAL_DETECT_MIN_CURRENT_SAMPLES_PER_MOTOR_BURST_DEFAULT", 9, 100);

          await updateParameterValue(apiBaseUrl, "ENCODER_FILLING_HARD_STOP_VALUE", 14, 55000);

          await updateParameterValue(apiBaseUrl, "FILING_MIN_ENCODER_FOR_REMOVE_AIR_STAGE", 53, 10000);

          await updateParameterValue(apiBaseUrl, "FILLING_STEP_2_MIN_DRUG_VOLUME_ENC", 4, 0);
      });

      preconditionsPassed = true;
    } catch (err) {
      throw new Error(`PRECONDITION FAILED: ${err.message}`);
    }
  });

  it(`${testKey}`, async function () {
    try {
      allureReporter.addLabel('testKey', testKey);
      if (!preconditionsPassed) {
        // mark test as skipped in Mocha
        this.skip();
      }
      // setLogDebugDump(true);

      const regimenEntries = Object.entries(doseMapping)
        .map(([dose, cfg]) => ({ dose: Number(dose), ...cfg }))
        .sort((a, b) => b.dose - a.dose);

      let prevTotalDose;

      let firstRegimen = true;

      let cycleCount = 0;

      let timing;

      let hasFailure = false;
      let result = { success: true };

      for (const regimen of regimenEntries) {
        const { dose: totalDose } = regimen;
        if (totalDose === 620) continue; // skip 620 with 2 * 20 intervals

        // if (totalDose === 470) break; // temp run 4 regimens 720, 670, 570 and 520
        // if (totalDose === 570) break; // temp run two regimens 720 and 670
        // if (totalDose === 670) break; // temp run only 720

        cycleCount++;

        if (firstRegimen) prevTotalDose = totalDose;

        const stepResult = await logStep(`Regimen #${totalDose} - Cycle #${cycleCount}`, async () => {

          await logSubStep(`Edit regimen`, async () => {
            await editRegimen(prevTotalDose, totalDose);
          });

          await logSubStep(`Edit time`, async () => {
            timing = calculateResetAndWait(regimen);

            logStepMessage(
              `⏱ Reset to ${timing.newHour}:${timing.newMinute}, ` +
              `Wait ${timing.waitSeconds} seconds to check 2 day (${timing.dayCycleSeconds}s) cycles and 3 night cycles`
            );

            await editTime(timing.newHour, timing.newMinute);
          });

          await logSubStep('Prepare treatment until delivery', async () => {
            let prepareTreatment;
            if (firstRegimen) {
              prepareTreatment = await getElementById('tvSecond', 'common.cmn_text_start_treatment');
              firstRegimen = false;
            } else {
              const headerMenu = await getElementById('ivHeaderMenu');
              await headerMenu.click();

              prepareTreatment = await getElementById('navToggleButton', 'common.cmn_text_start_treatment');
            }

            await prepareTreatment.click();
            await browser.pause(1000);

            await disconnectCartridgeFromPump(apiBaseUrl);

            await prepareTreatmentUntilPumpReady(apiBaseUrl);

            await clearPumpLogs(apiBaseUrl);

            await browser.pause(2000);

            await pressPumpButton(apiBaseUrl);

            await getElementById('tvHeaderTitle', 'screens.HOME.home_title');

            await getElementById('tvCurrentPumpStatusTitle', 'screens.HOME.home_screen_medication_delivery_on');
          });

          const subResult = await logSubStep('Wait, pause and check logs', async () => {
            result =  await checkDeliveryLogs(apiBaseUrl, regimen, startDayInSeconds, startNightInSeconds, cycleCount, timing.waitSeconds * 1000);

            if (!result.success) {
              throw result.error || new Error('Delivery Logs validation failed');
            }
          },
          { softFail: true }
          );

          if (subResult && subResult.success === false) {
            return { success: false };
          }

          return { success: true };
        },
        { softFail: true }
        );

        if (stepResult && stepResult.success === false) {
          hasFailure = true;
        }

        prevTotalDose = totalDose;
      }

      await logStep('Reset to FTU', async () => {
          await resetToFTU(apiBaseUrl);
      });

      await logStep('Disconnect TWICO', async () => {
        await disconnectTwico(apiBaseUrl, portName);
      });

      if (hasFailure) {
        throw new Error('One or more regimens failed during delivery log validation');
      }

      logStepMessage(`✅ ${testKey} completed successfully`);
    } catch (err) {
      console.error(`❌ ${testKey} failed:`, err.message || err, "error");
      throw err;
    }
  });
});

async function editRegimenAndPinCode(pinCode) {
  const editRegimenBtn = await getElementById('tvSecond', 'common.cmn_regimen_edit_changes');
  await editRegimenBtn.click();
  await getElementById('tvHeaderTitle', 'screens.REGIMEN_MENU.regimen_pin_title');
  await enterPinCode(pinCode);
}

async function editRegimen(actualTotalDose, newTotalDose) {
  const headerMenu = await getElementById('ivHeaderMenu');
  await headerMenu.click();

  const dosingRegimenSettings = await getElementByIdAndText('tvItemTitle', 'screens.MENU.menu_item_regimen_settings');
  await dosingRegimenSettings.click();

  await waitForVisible(
    buildSelectorById('tvHeaderTitle'),
    'screens.REGIMEN_OVERVIEW.title_single_regimen_overview',
    10000
  );

  await editRegimenAndPinCode(config.globalParams.defaultRegimenPinCode);

  await updateValueWithPlusMinusClicks({
    mode: 'dose',
    actualValue: actualTotalDose,
    newValue: newTotalDose
  });

  const doneBtn = await getElementById('tvSecond', 'common.cmn_text_done');
  await doneBtn.click();
  await browser.pause(200);

  const saveBtn = await getElementById('tvSecond', 'common.cmn_regimen_save_changes');
  await saveBtn.click();

  // Wait for navigation
  await getElementById('tvHeaderTitle', 'screens.BASAL_UPLOAD.basal_upload_screen_title');

  await waitForVisible(
    buildSelectorById('tvHeaderTitle'),
    'screens.REGIMEN_OVERVIEW.title_single_regimen_overview',
    15000
  );

  const backBtn = await getElementById('ivHeaderBack');
  await backBtn.click();
}

async function editTime(newHour, newMinute) {
  const headerMenu = await getElementById('ivHeaderMenu');
  await headerMenu.click();

  const dateAndTime = await scrollToItem('screens.MENU.menu_item_set_date', true);
  await dateAndTime.click();

  const setTime = await getElementByIdAndText('tvTop', 'screens.DATE_TIME.ftu_set_time');
  await setTime.click();

  // AM/PM if needed
  if (config.language === "en_US") {
    const previousAdbDateTime = adbGetDeviceDateTime();

    const previousDeviceTimePeriod = getPeriodFromHour(previousAdbDateTime.hour);
    logStepMessage(`🕒 Previous device period: ${previousDeviceTimePeriod}`);

    if (previousDeviceTimePeriod === "AM") {
      logStepMessage(`🔁 Switching period ${previousDeviceTimePeriod} → PM`);
      const periodSwitch = await getElementById('ivTimePeriodSwitch');
      await periodSwitch.click();
      await browser.pause(100);
    } else {
      logStepMessage(`✅ Period already correct (${previousDeviceTimePeriod})`);
    }
  }

  let fieldToUpdate = await getElementById('tvHour');
  let fieldToUpdateValue = await fieldToUpdate.getText();
  await fieldToUpdate.click();
  await browser.pause(100);

  await updateTimeValueWithPlusMinusClicks({
    field: 'hour',
    actualValue: fieldToUpdateValue,
    newValue: newHour
  });

  fieldToUpdate = await getElementById('tvMinutes');
  fieldToUpdateValue = await fieldToUpdate.getText();
  await fieldToUpdate.click();
  await browser.pause(100);

  await updateTimeValueWithPlusMinusClicks({
    field: 'minute',
    actualValue: fieldToUpdateValue,
    newValue: newMinute
  });

  const doneBtn = await getElementById('tvSecond', 'common.cmn_text_done');
  await doneBtn.click();

  const backBtn = await getElementById('ivHeaderBack');
  await backBtn.click();
  await browser.pause(100);
}

function calculateResetAndWait(regimen, options = {}) {
  const {
    prepSeconds = 240,  //  4 mn
    nightSeconds = 1350, // 22 mn 30 s (3 * 7mn 30s)
    bufferSeconds = 30, // 30 s
    targetHour = 21,
    targetMinute = 0
  } = options;

  // 1. Day cycle
  const dayCycleSeconds = regimen.intervals.day.reduce((a, b) => a + b, 0);

  // 2. Compute reset time (latest possible before 21:00)
  const targetTotalSeconds = targetHour * 3600 + targetMinute * 60;

  const resetSeconds =
    targetTotalSeconds - (prepSeconds + 2 * dayCycleSeconds);

  const newHour = Math.floor(resetSeconds / 3600);
  const newMinute = Math.floor((resetSeconds % 3600) / 60);

  // 3. Compute wait duration (real execution time)
  const waitSeconds =
    prepSeconds + (2 * dayCycleSeconds) + nightSeconds + bufferSeconds;

  // logStepMessage(JSON.stringify({
  //   dose: regimen.dose,
  //   dayCycleSeconds,
  //   reset: `${newHour}:${newMinute}`,
  //   waitSeconds
  // }));

  return {
    newHour: String(newHour).padStart(2, "0"),
    newMinute: String(newMinute).padStart(2, "0"),
    waitSeconds,
    dayCycleSeconds
  };
}

async function checkDeliveryLogs(apiBaseUrl, regimen, startDayInSeconds, startNightInSeconds, cycleCount, waitMs) {
  try {
  await waitWithHeartbeat(waitMs);
  // await waitWithHeartbeat(1800000); // 30 mn
  // await browser.pause(5000);
  // setLogDebugDump(true);
  const logs = await apiGet(apiBaseUrl, "/api/serialPort/readLogs");
  const normalized = normalizeLogs(logs);

  adbCouplePump();
  await browser.pause(15000);

  const audioBtn = await getElementById('llMuteAlarm');

  await audioBtn.click();
  await browser.pause(200);

  // [2026-04-28T20:49:58.003] [PB] Start delivery
  // [2026-04-28T20:49:58.003] [PB] PB Pressed: Start DLV`
  // [2026-04-28T20:49:58.004] [Alarm] Alarm cleared: 21`
  // [2026-04-28T20:49:58.006] [PB] 0,640,10800,80,75600,74998`

  // [2026-04-28T20:49:58.007] [DLV] TRTMNT prog: Done:0 Left:34069`
  // [2026-04-28T20:49:58.008] [DLV] New Delivery Cyc. Active Regimen 0`
  // [2026-04-28T20:49:58.009] [DLV] New Delivery Cyc. Cycle Count: 1`
  // [2026-04-28T20:49:58.009] [DLV] NewCyc FR:640 SegEnd:10800`

  // [2026-04-28T20:50:02.987] [DLV] Micro step start: 0`
  // [2026-04-28T20:50:59.021] [DLV] Micro step start: 1`
  // [2026-04-28T20:51:54.998] [DLV] Micro step start: 2`
  // [2026-04-28T20:52:50.973] [DLV] Micro step start: 3`
  // [2026-04-28T20:53:47.972] [DLV] Micro step start: 4`
  // [2026-04-28T20:54:44.040] [DLV] Micro step start: 5`
  // [2026-04-28T20:55:40.015] [DLV] Micro step start: 6`
  // [2026-04-28T20:56:35.995] [DLV] Micro step start: 7`
  // [2026-04-28T20:57:32.941] [DLV] Micro step start: 8`
  // [2026-04-28T20:58:28.988] [DLV] Micro step start: 9`
  // [2026-04-28T20:59:25.018] [DLV] Micro step start: 10`
  // [2026-04-28T20:59:59.984] [DLV] Segment changed. Flowrate: 80`
  // [2026-04-28T20:59:59.984] [DLV] Segment changed. New end time: 75600`
  // [2026-04-28T21:07:29.973] [DLV] Micro step start: 11`
  // [2026-04-28T21:14:59.941] [DLV] Micro step start: 12`

  verifyLogsNormalized(normalized, `[PB] Start delivery||[PB] PB Pressed: Start DLV\`||[Alarm] Alarm cleared: 21\`||[PB] 0,${regimen.dayFlowRate},${startDayInSeconds},${regimen.nightFlowRate},${startNightInSeconds}||[DLV] TRTMNT prog: Done:0 Left:||[DLV] New Delivery Cyc. Active Regimen 0\`||[DLV] New Delivery Cyc. Cycle Count: ${cycleCount}\`||[DLV] NewCyc FR:${regimen.dayFlowRate} SegEnd:${startDayInSeconds}\`||[DLV] Segment changed. New end time: ${startNightInSeconds}\`||[DLV] Segment changed. Flowrate: ${regimen.nightFlowRate}\``, "error");

  checkPbTimestampSeconds(normalized, "error");

  const { daySteps, nightSteps } = extractMicroStepsBySegment(normalized, true);
  printSteps("🌞 DAY STEPS", daySteps);
  printSteps("🌙 NIGHT STEPS", nightSteps);

  checkStepIntervals(daySteps, regimen.intervals.day, "error"); // "warn" // "error"
  checkStepIntervals(nightSteps, regimen.intervals.night, "error");
  } catch (err) {
    logStepMessage(`❌ Log validation failed: ${err.message}`);
    return { success: false, error: err };
  }

  return { success: true };
}

function checkStepIntervals(
  steps,
  expectedIntervals,
  severity = "error",
  toleranceMs = 1000
) {
  const normalizedSeverity = String(severity).toLowerCase();
  const shouldThrow = normalizedSeverity === "error";

  const failures = [];

  const log = (msg, level = normalizedSeverity) =>
    logStepMessage(msg, level);

  const fail = (msg) => {
    failures.push(msg);
    log(msg);
  };

  // ---- basic validation
  if (steps.length < 2) {
    return abort(`❌ Not enough steps (got ${steps.length})`);
  }

  // ---- step order check
  let stepOrderOk = true;
  const baseStep = steps[0].step;

  for (let i = 0; i < steps.length; i++) {
    const expectedStep = baseStep + i;

    if (steps[i].step !== expectedStep) {
      fail(
        `❌ Step order mismatch at index ${i}: expected ${expectedStep}, got ${steps[i].step}`
      );
      stepOrderOk = false;
    }
  }

  if (stepOrderOk) {
    log(`✅ Step order OK (starting from ${baseStep})`, "info");
  }

  // ---- interval count check
  const actualIntervals = steps.length - 1;
  const cycleLength = expectedIntervals.length;
  const expectedCount = cycleLength * 2;

  if (actualIntervals < expectedCount) {
    fail(
      `❌ Not enough intervals: expected at least ${expectedCount}, got ${actualIntervals}`
    );
  }

  if (actualIntervals > expectedCount) {
    log(
      `ℹ️ ${actualIntervals} intervals found, validating first ${expectedCount}`,
      "info"
    );
  }

  const intervalsToCheck = Math.min(actualIntervals, expectedCount);

  // ---- interval checks
  let sumActualMs = 0;
  let sumExpectedMs = 0;

  for (let i = 1; i <= intervalsToCheck; i++) {
    const t1 = Date.parse(steps[i].time);
    const t0 = Date.parse(steps[i - 1].time);

    const diffMs = t1 - t0;

    const expectedSec =
      expectedIntervals[(i - 1) % cycleLength];

    const expectedMs = expectedSec * 1000;
    const delta = Math.abs(diffMs - expectedMs);

    if (delta > toleranceMs) {
      // fail(
      log(
        [
          `❌ Step ${i - 1}→${i} mismatch`,
          `Actual: ${(diffMs / 1000).toFixed(3)}s`,
          `Expected: ${expectedSec}s`,
          `Delta: ${(delta / 1000).toFixed(3)}s`
        ].join("\n"),
      "info"
      );
    } else {
      log(
        `✅ Step ${i - 1}→${i} ${(diffMs / 1000).toFixed(3)}s OK (expected ${expectedSec}s)`,
      "info"
      );
    }

    sumActualMs += diffMs;
    sumExpectedMs += expectedMs;
  }

  // ---- average check (only if we had intervals)
  if (intervalsToCheck > 0) {
    const avgActualMs = sumActualMs / intervalsToCheck;
    const avgExpectedMs = sumExpectedMs / intervalsToCheck;

    const avgDelta = Math.abs(avgActualMs - avgExpectedMs);

    const avgTolerance = Math.max(
      toleranceMs / intervalsToCheck,
      50
    );

    if (avgDelta > avgTolerance) {
      fail(
        [
          `❌ Average interval mismatch`,
          `Actual avg: ${(avgActualMs / 1000).toFixed(3)}s`,
          `Expected avg: ${(avgExpectedMs / 1000).toFixed(3)}s`,
          `Delta: ${(avgDelta / 1000).toFixed(3)}s`,
          `Tolerance: ${(avgTolerance / 1000).toFixed(3)}s`
        ].join("\n")
      );
    } else {
      log(
        `✅ Average ${(avgActualMs / 1000).toFixed(3)}s OK (expected ${(avgExpectedMs / 1000).toFixed(3)}s)`,
      "info"
      );
    }
  }

  // ---- finalize
  return finalize(shouldThrow);

  function finalize(shouldThrow) {
    if (shouldThrow && failures.length > 0) {
      throw new Error(
        failures.length === 1
          ? failures[0]
          : `❌ Multiple step interval failures:\n${failures.join("\n\n")}`
      );
    }
  }

  function abort(msg) {
    fail(msg);
    return finalize(shouldThrow);
  }
}

function printSteps(title, steps) {
  if (!steps || steps.length === 0) {
    logStepMessage(`${title}: (no steps)`);
    return;
  }

  const formatted = steps
    .map(s => {
      const time = formatLogDeviceTime(s.time);
      return `[idx:${s.index}] step:${s.step} time:${time}`;
    })
    .join("\n");

  logStepMessage(
    `\n==== ${title} ====\n${formatted}\n====================`
  );
}