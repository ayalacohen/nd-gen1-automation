// helpers
import { clearPumpLogs, connectTwico, disconnectTwico, verifyLogsContain } from '../helpers/apiHelpers.js';
import { activateRegimenAndStart, pairPump, resetToFTU } from '../helpers/preConditionsHelpers.js';
import { buildSelectorById, enterPinCode, enterPinRegimen, getCachedString, getElementById, getSegmentsValues, isElementDisplayedByText, openDosingRegimenSettings, updateValueWithPlusMinusClicks, validateDayStartHourFullCycle, validateDayDoseFullCycle, waitForVisible } from '../helpers/uiHelpers.js';

import { loadStrings } from '../helpers/i18n.js';
import { logPretty, logStep, logStepMessage, logSubStep } from '../helpers/logger.js';

// config
import config from '../helpers/config.js';
import { assertComparison, isStrictValidDate, isStrictValidTime, convertHoursToSeconds, parseHour, changeDose, changeHour, formatSigned } from '../helpers/generalHelpers.js';
import { adbUpdateConfigFilesAndMainSn } from '../helpers/adbHelpers.js';
import { flowState, saveState } from '../helpers/flowState.js';

import allureReporter from '@wdio/allure-reporter';

/*
Precondition:
Using CS configuration tool NDUI to change:
     “FW Configuration File”-> user_default_key= 1, 
       “APK Configuration File”-> HcpUser = True,

CS and pump after FTU

Pump and CS paired and connected

Pump is in CS cradle
*/
const testKey = "regimenLoop";
let preconditionsPassed = false;

describe("Loop on edit regimen", () => {

  const { apiBaseUrl, globalParams } = config;
  const { pumpName, portName, defaultRegimenPinCode } = { ...globalParams };

  const apkLocalConfigFile = "adb-config-files/HCP_cs_config.json";
  const fwLocalConfigFile = "adb-config-files/DEFAULT_1_config.file";

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
    await logStep('Update HCP_1 config files and relaunch', async () => {
      if (flowState.lastCategory == "HCP_1") {
        logStepMessage("Skipping these update config steps...");
      } else {
        await adbUpdateConfigFilesAndMainSn(apkLocalConfigFile, fwLocalConfigFile);
        flowState.lastCategory = "HCP_1";
      }
    });
    await logStep('Connect TWICO', async () => {
      await connectTwico(apiBaseUrl, portName);
    });

    await logStep('Reset to FTU, Pair pump, Activate regimen and start (until medication empty)', async () => {
      if (await isElementDisplayedByText(getCachedString('common.cmn_get_started'), 20000)) {
        logStepMessage("Click GET STARTED");
        const getStarted = await getElementById('tvThird');
        await getStarted.click();
      }

      if (flowState.lastSuccess && ["medicationEmpty"].includes(flowState.lastTest)) {
        logStepMessage("Skipping these reset steps...");
      } else {
        await resetToFTU(apiBaseUrl);
        await pairPump(pumpName);
        await activateRegimenAndStart();
      }
    });

    await logStep('Clear pump logs', async () => {
      await clearPumpLogs(apiBaseUrl);
    });

            preconditionsPassed = true;
        } catch (err) {
            throw new Error(`PRECONDITION FAILED: ${err.message}`);
        }
  });

  // number of times to loop through the regimenChangeList
  const numOfLoops = 5; // 1

  // start 03:00 720
  const regimenChangeList = [
    { hour: -1, dose: -4 },   // -1 hour, -200mg
    { hour: 3, dose: -2 },    // +3 hours, +100mg
    { hour: 0, dose: -1 },    // no hour change, –50mg
    { hour: 5, dose: 2 },     // +5 hours, -100mg
    { hour: -1, dose: 1 },
    { hour: -1, dose: 1 },
    { hour: -2, dose: 1 },
    { hour: -1, dose: 1 },
    { hour: -2, dose: 1 },
  ];
  // end 03:00 720

  let segmentsValues, currentSegments;

  it(`${testKey}`, async function () {
    try {
            allureReporter.addLabel('testKey', testKey);
            if (!preconditionsPassed) {
                // mark test as skipped in Mocha
                this.skip(); 
            }

      await logStep('Open Dosing regimen settings', async () => {
        ({ segmentsValues } = await openDosingRegimenSettings());
      });

      currentSegments = segmentsValues;
      logPretty("Initial regimen", currentSegments);

      await logStep('Click Edit regimen and enter default correct PIN code', async () => {
        await editRegimenAndPinCode(defaultRegimenPinCode);
      });

      for (let i = 1; i <= numOfLoops; i++) {
        for (const change of regimenChangeList) {
          await logStep(`#${i} Apply regimen change (${formatSigned(change.hour)}h, ${formatSigned(change.dose * 50)}mg)`, async () => {

            const { previewSegments } = await logSubStep("Edit regimen", async () => {
              return await editRegimen(currentSegments, change);
            });

            const { savedSegments } = await logSubStep("Save regimen", async () => {
              return await saveRegimen();
            });

            await logSubStep("Compare preview vs saved", () => {
              assertComparison(previewSegments, savedSegments, true, "Regimen");
            });

            await logSubStep("Check pump logs", async () => {
              await checkPumpLogs(apiBaseUrl, savedSegments);
            });

            logStepMessage(`✔️ Regimen with Start Day ${previewSegments.day.start} and Total Dose ${previewSegments.totalDose}mg saved correctly and in Pump logs`);

            // Prepare for next iteration
            currentSegments = savedSegments;
          });
        }
      }

      await logStep('Disconnect TWICO', async () => {
        await disconnectTwico(apiBaseUrl, portName);
      });

      logStepMessage("✅ Loop on edit regimen completed successfully");
    } catch (err) {
      console.error("❌ Loop on edit regimen failed:", err.message || err, "error");
      throw err;
    }
  });
});

async function editRegimenAndPinCode(pinCode) {
    const editRegimenBtn =  await getElementById('tvSecond', 'common.cmn_regimen_edit_changes');
    await editRegimenBtn.click();
    await getElementById('tvHeaderTitle', 'screens.REGIMEN_MENU.regimen_pin_title');
    await enterPinCode(pinCode);
}

async function editRegimen(currentSegments, { hour, dose }) {
    // --- AUTO-DETECT EDIT MODE ---
    const editRegimenBtn = await browser.$(buildSelectorById('tvSecond') + `.text("${getCachedString('common.cmn_regimen_edit_changes')}")`);
    if (await editRegimenBtn.isDisplayed().catch(() => false)) {
        logStepMessage("↪ Clicking Edit Regimen");
        await editRegimenBtn.click();
    } else {
        logStepMessage("↪ Already in Edit Mode");
    }

    const newStartDay = changeHour(currentSegments.day.start, hour);
    const newTotalDose = changeDose(currentSegments.totalDose, dose);

    await updateValueWithPlusMinusClicks({
        mode: 'hour',
        actualValue: currentSegments.day.start,
        newValue: newStartDay
    });

    await updateValueWithPlusMinusClicks({
        mode: 'dose',
        actualValue: currentSegments.totalDose,
        newValue: newTotalDose
    });

    const doneBtn = await getElementById('tvSecond', 'common.cmn_text_done');
    await doneBtn.click();

    const { segmentsValues: previewSegments } = await getSegmentsValues();

    return { previewSegments };
}

async function saveRegimen() {
    const saveBtn = await getElementById('tvSecond', 'common.cmn_regimen_save_changes');
    await saveBtn.click();

    // Wait for navigation
    await getElementById('tvHeaderTitle', 'screens.BASAL_UPLOAD.basal_upload_screen_title');

    await waitForVisible(
        buildSelectorById('tvHeaderTitle'),
        'screens.REGIMEN_OVERVIEW.title_single_regimen_overview',
        15000
    );

    const { segmentsValues: savedSegments } = await getSegmentsValues();
    return { savedSegments };
}

async function checkPumpLogs(apiBaseUrl, savedSegments) {
    const startDayInSeconds = convertHoursToSeconds(parseHour(savedSegments.day.start));
    const startNightInSeconds = convertHoursToSeconds(parseHour(savedSegments.night.start));
    const segment1 = `[REGIMENS] Segment 1 (start,flow): ${startDayInSeconds},${savedSegments.day.doseRate}\``;
    const segment2 = `[REGIMENS] Segment 2 (start,flow): ${startNightInSeconds},${savedSegments.night.doseRate}\``;

    await verifyLogsContain(apiBaseUrl, `[REGIMENS] Info tst: 0\`||[REGIMENS] Rec. CRC Tst: 1\`||[REGIMENS] Regimen Data: 0\`||${segment1}||${segment2}||[REGIMENS] Saved CRC Test Event: 1\`||[REGIMENS] # Regim: 1\`||[REGIMENS] Actv Indx: 0\``, 1000, "error");
}