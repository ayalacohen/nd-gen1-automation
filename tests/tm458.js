// helpers
import { adbCouplePump, adbDecouplePump, adbUpdateConfigFilesAndMainSn } from '../helpers/adbHelpers.js';
import { clearPumpLogs, connectTwico, disconnectTwico, updateParameterValue, verifyLogsContain } from '../helpers/apiHelpers.js';
import { activateRegimenAndStart, pairPump, resetToFTU } from '../helpers/preConditionsHelpers.js';
import { buildSelectorById, checkAlarm, csTurnOffPump, enterPinCode, getCachedString, getElementById, getSegmentsValues, openDosingRegimenSettings, updateValueWithPlusMinusClicks, waitForVisible } from '../helpers/uiHelpers.js';

import { loadStrings } from '../helpers/i18n.js';
import { logStep, logStepMessage } from '../helpers/logger.js';

// config
import config from '../helpers/config.js';
import { assertComparison, convertHoursToSeconds, parseHour } from '../helpers/generalHelpers.js';
import { flowState, saveState } from '../helpers/flowState.js';

import allureReporter from '@wdio/allure-reporter';

/*
Precondition:
Using CS configuration tool NDUI to change: “FW Configuration File”-> user_default_key= 1, “APK Configuration File”-> HcpUser = True,

Pump and CS after FTU

Use dedicated CS VnV Apk version
*/

const testKey = "TM-458";

let preconditionsPassed = false;

describe(`${testKey} - Invalid read CRC from flash - Test with VNV`, () => {
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
        await logStep('Clear pump logs', async () => {
            await clearPumpLogs(apiBaseUrl);
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

            preconditionsPassed = true;
        } catch (err) {
            throw new Error(`PRECONDITION FAILED: ${err.message}`);
        }
  });

  let segmentsValues, initialSegments;

  it(`${testKey}`, async function () {
    try {
        allureReporter.addLabel('testKey', testKey);
        if (!preconditionsPassed) {
            // mark test as skipped in Mocha
            this.skip(); 
        }

        await logStep('Step 1 - Update VALIDATION to 255', async () => {
            await step1(apiBaseUrl);
        });

        await logStep('Step 2 - Dosing regimen settings, edit regimen with default correct PIN, set total dose 620mg and save - NOT SAVED', async () => {
            ({ segmentsValues } = await step2(apiBaseUrl, defaultRegimenPinCode, "620"));
        });

        initialSegments = segmentsValues;
        // return;

        await logStep('Step 3 - Shut down Pump from cs', async () => {
            await step3(apiBaseUrl);
        });

        await logStep('Step 4 - Decouple, Couple and open Dosing regimen settings', async () => {
            await step4(apiBaseUrl, initialSegments);
        });

        await logStep('Step 5 - Update VALIDATION to 0', async () => {
            await step5(apiBaseUrl);
        });

        await logStep('Step 6 - Dosing regimen settings, edit regimen with default correct PIN, set total dose 570mg and save - SAVED', async () => {
            await step6(apiBaseUrl, defaultRegimenPinCode, initialSegments, "570");
        });

        await logStep('Disconnect TWICO', async () => {
            await disconnectTwico(apiBaseUrl, portName);
        });

        logStepMessage(`✅ ${testKey} completed successfully`);
    } catch (err) {
        console.error(`❌ ${testKey} failed:`, err.message || err, "error");
        throw err;
    }
  });
});

async function step1(apiBaseUrl) {
    logStepMessage("▶️ Step 1");
    await updateParameterValue(apiBaseUrl, "VALIDATION", 1012, 255);
    logStepMessage("✅ Step 1");
}

async function step2(apiBaseUrl, pinCode, newTotalDose) {
    logStepMessage("▶️ Step 2");
    const segmentsValues = await openDosingRegimenSettings();

    const editRegimenBtn = await browser.$(buildSelectorById('tvSecond') + `.text("${getCachedString('common.cmn_regimen_edit_changes')}")`);
    await editRegimenBtn.click();
    await getElementById('tvHeaderTitle', 'screens.REGIMEN_MENU.regimen_pin_title');
    await enterPinCode(pinCode);

    
    await updateValueWithPlusMinusClicks({
        mode: 'dose',
        actualValue: segmentsValues.totalDose,
        newValue: newTotalDose
    });

    const doneBtn = await getElementById('tvSecond', 'common.cmn_text_done');
    await doneBtn.click();

    const saveBtn = await getElementById('tvSecond', 'common.cmn_regimen_save_changes');
    await saveBtn.click();

    await browser.pause(2000);

    await checkAlarm(
        'dialogs.ALERT_REGIMEN_UPLOAD_FAILED.alert_type_regimen_upload_failed_title',
        'dialogs.ALERT_REGIMEN_UPLOAD_FAILED.alert_type_regimen_upload_failed_info',
        { expectedStr: 'ID 1036 ' }
    );
    await verifyLogsContain(apiBaseUrl, `[REGIMENS] Saved CRC Test Event: 0\``, 3000, "error");
    logStepMessage("✅ Step 2");
    return segmentsValues;
}

async function step3(apiBaseUrl) {
    logStepMessage("▶️ Step 3");
    const tryAgainBtn = await getElementById('tvThird', 'common.cmn_text_try_again');
    await tryAgainBtn.click();

    await waitForVisible(
        buildSelectorById('tvHeaderTitle'),
        'screens.REGIMEN_OVERVIEW.title_single_regimen_overview',
        10000
    );

    const backBtn = await getElementById('ivHeaderBack');
    await backBtn.click();

    await csTurnOffPump();
    await browser.pause(5000);

    await verifyLogsContain(apiBaseUrl, `Enter ShipMode [CS_Com]\``, 0, "error");
    logStepMessage("✅ Step 3");
}

async function step4(apiBaseUrl, initialSegments) {
    logStepMessage("▶️ Step 4");
    // decouple, couple, dosing regimen settings

    adbDecouplePump();
    await browser.pause(2000);

    adbCouplePump();
    await browser.pause(7000);

    const segmentsValues = await openDosingRegimenSettings();
    const newSegments = segmentsValues.segmentsValues;

    assertComparison(initialSegments, newSegments, true, "Regimen"); // unchanged
    logStepMessage("✅ Segments unsaved as expected");

    const audioBtn = await getElementById('tvFirst');
    if (await audioBtn.isDisplayed()) {
        const text = await audioBtn.getText();
        if (text === getCachedString('common.text_pause_audio')) {
            logStepMessage("⏸ Clicking PAUSE AUDIO");
            await browser.pause(1000);
            await audioBtn.click();
        }
    }

    await verifyLogsContain(apiBaseUrl, `[BIT] SPI&FLASH Tst PASS\`||[BIT] REGIMENS Tst PASS\`||[BIT] ALL Tst PASS\``, 0, "error");

    logStepMessage("✅ Step 4");
}

async function step5(apiBaseUrl) {
    logStepMessage("▶️ Step 5");
    await updateParameterValue(apiBaseUrl, "VALIDATION", 1012, 0);
    logStepMessage("✅ Step 5");
}

async function step6(apiBaseUrl, pinCode, initialSegments, newTotalDose) {
    logStepMessage("▶️ Step 6");

    const editRegimenBtn = await browser.$(buildSelectorById('tvSecond') + `.text("${getCachedString('common.cmn_regimen_edit_changes')}")`);
    await editRegimenBtn.click();
    await getElementById('tvHeaderTitle', 'screens.REGIMEN_MENU.regimen_pin_title');
    await enterPinCode(pinCode);

    await updateValueWithPlusMinusClicks({
        mode: 'dose',
        actualValue: initialSegments.totalDose,
        newValue: newTotalDose
    });

    const doneBtn = await getElementById('tvSecond', 'common.cmn_text_done');
    await doneBtn.click();

    const saveBtn = await getElementById('tvSecond', 'common.cmn_regimen_save_changes');
    await saveBtn.click();

    await getElementById('tvHeaderTitle', 'screens.BASAL_UPLOAD.basal_upload_screen_title');
    await getElementById('tvDoneText', 'common.cmn_action_finished');

    await waitForVisible(
        buildSelectorById('tvHeaderTitle'),
        'screens.REGIMEN_OVERVIEW.title_single_regimen_overview',
        15000
    );

    const { segmentsValues: savedSegments } = await getSegmentsValues();

    assertComparison(initialSegments, savedSegments, false, "Regimen");

    if (savedSegments.totalDose != newTotalDose) {
        throw new Error(`❌ New Total Dose ${savedSegments.totalDose} not as expected ${newTotalDose}`);
    }

    logStepMessage(`✅ Segments saved as expected with new Total Dose ${newTotalDose}mg`);

    const startDayInSeconds = convertHoursToSeconds(parseHour(savedSegments.day.start));
    const startNightInSeconds = convertHoursToSeconds(parseHour(savedSegments.night.start));
    const segment1 = `[REGIMENS] Segment 1 (start,flow): ${startDayInSeconds},${savedSegments.day.doseRate}\``;
    const segment2 = `[REGIMENS] Segment 2 (start,flow): ${startNightInSeconds},${savedSegments.night.doseRate}\``;

    await verifyLogsContain(apiBaseUrl, `[REGIMENS] Info tst: 0\`||[REGIMENS] Rec. CRC Tst: 1\`||[REGIMENS] Regimen Data: 0\`||${segment1}||${segment2}||[REGIMENS] Saved CRC Test Event: 1\`||[REGIMENS] # Regim: 1\`||[REGIMENS] Actv Indx: 0\``, 1000, "error");
    logStepMessage("✅ Step 6");
}