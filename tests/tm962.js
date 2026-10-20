// helpers
import { clearPumpLogs, connectTwico, disconnectTwico, verifyLogsContain } from '../helpers/apiHelpers.js';
import { activateRegimenAndStart, pairPump, resetToFTU } from '../helpers/preConditionsHelpers.js';
import { buildSelectorById, checkAlarm, enterPinCode, enterPinRegimen, getCachedString, getElementById, getSegmentsValues, isElementDisplayedById, openDosingRegimenSettings, updateValueWithPlusMinusClicks, validateDayStartHourFullCycle, validateDayDoseFullCycle, waitForVisible } from '../helpers/uiHelpers.js';

import { loadStrings } from '../helpers/i18n.js';
import { logPretty, logStep, logStepMessage } from '../helpers/logger.js';

// config
import config from '../helpers/config.js';
import { assertComparison, isStrictValidDate, isStrictValidTime, convertHoursToSeconds, parseHour } from '../helpers/generalHelpers.js';
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

const testKey = "TM-962";

let preconditionsPassed = false;

describe(`${testKey} - Regimen edit - Default pin code protection - HCP mode`, () => {
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
            // await browser.pause(1000);
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
        await logStep('Clear pump logs', async () => {
            await clearPumpLogs(apiBaseUrl);
            // await browser.pause(2000);
        });

            preconditionsPassed = true;
        } catch (err) {
            throw new Error(`PRECONDITION FAILED: ${err.message}`);
        }
  });

  after(async function () {
    flowState.lastTest = this.currentTest.title;
    flowState.lastSuccess = this.currentTest.state === 'passed';

    saveState(flowState);

    logStepMessage("flowState: " + JSON.stringify(flowState, null, 2));
  });

  let segmentsValues, initialSegments, updatedSegments;

  it(`${testKey}`, async function () {
    try {
            allureReporter.addLabel('testKey', testKey);
            if (!preconditionsPassed) {
                // mark test as skipped in Mocha
                this.skip(); 
            }
        await logStep('Step 1 - Open Dosing regimen settings', async () => {
           ({ segmentsValues } = await step1());
        });

        initialSegments = segmentsValues;
        logPretty("Initial regimen", initialSegments);

        await logStep('Step 2 - Edit regimen', async () => {
        await step2();
        });

        await logStep('Step 3 - Enter default incorrect PIN code', async () => {
            await step3("12121212");
        });

        await logStep('Step 4 - Enter default correct PIN code', async () => {
            await step4(defaultRegimenPinCode);
        });

        await logStep('Step 5 - Adjust start time - full check and set 05:00 AM ', async () => {
            await step5(initialSegments.day.start, initialSegments.night.start, "05:00 AM");
        });

        await logStep('Step 6 - Adjust total daily dose - full check and set 620 mg', async () => {
            await step6(initialSegments.totalDose, "620");
        });

        await logStep('Step 7 - Click DONE', async () => {
            await step7(initialSegments);
        });

        await logStep('Step 8 - Go Back to Home', async () => {
            await step8();
        });        

        await logStep('Step 9 - Go Back', async () => {
            await step9();
        });

        await logStep('Step 10 - Open Dosing regimen settings', async () => {
            await step10(initialSegments);
        });

        await logStep('Step 11 - Edit regimen', async () => {
        await step11();
        });

        await logStep('Step 12 - Enter default correct PIN code', async () => {
            await step12(defaultRegimenPinCode);
        });

        await logStep('Step 13 - Set day start time 02:00 AM and total dose 570', async () => {
            await step13(initialSegments, "02:00 AM", "570");
        });

        await logStep('Step 14 - Click Done and check segments changes', async () => {
            ({ segmentsValues } = await step14(initialSegments));
        });

        updatedSegments = segmentsValues;

        await logStep('Step 15 - Save regimen and check segments changes', async () => {
            await step15(updatedSegments);
        });

        await logStep('Step 16 - Go Back to home', async () => {
        await step16();
        });

        await logStep('Step 17 - Open Dosing regimen settings', async () => {
        await step17(updatedSegments);
        });

        await logStep('Step 18 - Check pump logs', async () => {
        await step18(apiBaseUrl , updatedSegments);
        });
        // return;

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

async function step1() {
    logStepMessage("▶️ Step 1");
    const segmentsValues = await openDosingRegimenSettings();
    await getElementById('tvFirstLabel', 'screens.REGIMEN_OVERVIEW.regiment_segment_start_text');
    await getElementById('tvSecondLabel', 'screens.REGIMEN_OVERVIEW.regiment_segment_end_text');
    await getElementById('tvThirdLabel', 'screens.REGIMEN_OVERVIEW.regiment_segment_flow_text_fix');
    await getElementById('tvFirstSegmentFlowUnit', 'screens.REGIMEN_OVERVIEW.regiment_segment_flow_day_text_unit');
    await getElementById('tvSecondSegmentFlowUnit', 'screens.REGIMEN_OVERVIEW.regiment_segment_flow_day_text_unit_night');
    await getElementById('tvMessageContainerInfo', 'screens.REGIMEN_OVERVIEW.regimen_daily_total_title');
    await getElementById('tvMessageContainerUnit', 'screens.REGIMEN_OVERVIEW.regiment_segment_flow_text_unit');
    await getElementById('tvInfo', 'screens.REGIMEN_OVERVIEW.regiment_segment_flow_info');
    const editRegimenBtn =  await getElementById('tvSecond', 'common.cmn_regimen_edit_changes');
    if (!await editRegimenBtn.isEnabled()) {
        throw new Error("❌ EDIT REGIMEN disabled");
    }
    logStepMessage("✅ EDIT REGIMEN enabled");  
    logStepMessage("✅ Step 1");
    return segmentsValues;
}

async function step2() {
    logStepMessage("▶️ Step 2");
    const editRegimenBtn =  await getElementById('tvSecond', 'common.cmn_regimen_edit_changes');
    await editRegimenBtn.click();

    await getElementById('tvHeaderTitle', 'screens.REGIMEN_MENU.regimen_pin_title');
    await getElementById('tvEditRegimenPasswordNote', 'screens.REGIMEN_MENU.regiment_note');

    const systemClock = await getElementById('tvHeaderSystemClock');
    const systemClockStr = await systemClock.getText();
    logStepMessage(`Check ${systemClockStr}`); 
    if (isStrictValidDate(systemClockStr)) {
        logStepMessage(`✅ Date ${systemClockStr} displayed instead of time`); 
    } else if (isStrictValidTime(systemClockStr)) {
        throw new  Error(`❌ Time  ${systemClockStr} displayed instead of date`);
    } else {
        throw new  Error(`❌ Date not properly displayed: ${systemClockStr}`);
    }
    logStepMessage("✅ Step 2"); 
}

async function step3(pinCode) {
    logStepMessage("▶️ Step 3");
    await enterPinRegimen(pinCode, { retryOnWrongPin: false });
    if (await isElementDisplayedById('tvPinError')) {
        const pinError = await browser.$(buildSelectorById('tvPinError'));
        const pinErrorStr = await pinError.getText();
        if (pinErrorStr == getCachedString('screens.REGIMEN_MENU.regiment_wrong_pin')) {
            logStepMessage(`✅ Pin incorrect message as expected: ${pinErrorStr} [screens.REGIMEN_MENU.regiment_wrong_pin]`);
        } else {
            throw new Error(`❌ Pin incorrect message JOT as expected${pinErrorStr} [screens.REGIMEN_MENU.regiment_wrong_pin]`);
        }
    } else {
     throw new Error(`❌No pin incorrect message`);
    }
    logStepMessage("✅ Step 3");
}

async function step4(pinCode) {
    logStepMessage("▶️ Step 4");
    await enterPinCode(pinCode);
    if (await isElementDisplayedById('tvPinError')) {
        const pinError = await browser.$(buildSelectorById('tvPinError'));
        const pinErrorStr = await pinError.getText();
        throw new Error(`❌ ${pinErrorStr} [screens.REGIMEN_MENU.regiment_wrong_pin]`);
    }
    await getElementById('tvHeaderTitle', 'screens.REGIMEN_OVERVIEW.title_single_regimen_edit');
    logStepMessage("✅ Step 4");
}

async function step5(actualStartDay, actualStartNight, newStartDay) {
    logStepMessage("▶️ Step 5");
    await validateDayStartHourFullCycle(actualStartDay, actualStartNight);

    await updateValueWithPlusMinusClicks({
        mode: 'hour',
        actualValue: actualStartDay,
        newValue: newStartDay
    });
    logStepMessage("✅ Step 5");
}

async function step6(actualTotalDose, newTotalDose) {
    logStepMessage("▶️ Step 6");
    await validateDayDoseFullCycle(actualTotalDose);

    await updateValueWithPlusMinusClicks({
        mode: 'dose',
        actualValue: actualTotalDose,
        newValue: newTotalDose
    });
    logStepMessage("✅ Step 6");
}

async function step7(initialSegments) {
    logStepMessage("▶️ Step 7");
    const doneBtn = await getElementById('tvSecond', 'common.cmn_text_done');
    await doneBtn.click();

    const editRegimenBtn =  await getElementById('tvEditSegments', 'common.cmn_regimen_edit_changes');
    if (!await editRegimenBtn.isEnabled()) {
        throw new Error("❌ EDIT REGIMEN disabled");
    }
    logStepMessage("✅ EDIT REGIMEN enabled"); 

    const segmentsValues = await getSegmentsValues();
    const newSegments = segmentsValues.segmentsValues;

    assertComparison(initialSegments, newSegments, false, "Regimen");   // expect changed
    logStepMessage("✅ Segments saved as expected");

    if (newSegments.day.end == newSegments.day.start) {
        throw new Error(`❌ Day segment - Start time and End time are equal: ${newSegments.day.start}`);
    }
    logStepMessage(`✅ Day segment - Start time and End time differ: ${newSegments.day.start} and ${newSegments.day.end}`);

    if (newSegments.night.end == newSegments.night.start) {
        throw new Error(`❌ Night segment - Start time and End time are equal: ${newSegments.night.start}`);
    }
    logStepMessage(`✅ Night segment - Start time and End time differ: ${newSegments.night.start} and ${newSegments.night.end}`);

    logStepMessage("✅ Step 7");
}

async function step8() {
    logStepMessage("▶️ Step 8");
    const backBtn = await getElementById('ivHeaderBack');
    await backBtn.click();

    await checkAlarm(
        'dialogs.REGIMEN_UNSAVED_CHANGES.regime_segment_not_saved_message',
        'dialogs.REGIMEN_UNSAVED_CHANGES.regime_segment_not_saved_title',
        { expectedStr: 'ID 1000 ' }
    );

    await getElementById('tvFirst', 'common.cmn_go_back');
    await getElementById('tvThird', 'common.cmn_text_cancel');

    logStepMessage("✅ Step 8");
}

async function step9() {
    logStepMessage("▶️ Step 9");
    const goBackBtn = await getElementById('tvFirst', 'common.cmn_go_back');
    await goBackBtn.click();

    await getElementById('tvHeaderTitle', 'screens.HOME.home_title');
    logStepMessage("✅ Step 9");
}

async function step10(initialSegments) {
    logStepMessage("▶️ Step 10");
    let segmentsValues;
    ({ segmentsValues } = await openDosingRegimenSettings());
    const newSegments = segmentsValues;

    assertComparison(initialSegments, newSegments, true, "Regimen");   // expect unchanged
    logStepMessage("✅ Segments not saved as expected");

    if (newSegments.day.end == newSegments.day.start) {
        throw new Error(`❌ Day segment - Start time and End time are equal: ${newSegments.day.start}`);
    }
    logStepMessage(`✅ Day segment - Start time and End time differ: ${newSegments.day.start} and ${newSegments.day.end}`);

    if (newSegments.night.end == newSegments.night.start) {
        throw new Error(`❌ Night segment - Start time and End time are equal: ${newSegments.night.start}`);
    }
    logStepMessage(`✅ Night segment - Start time and End time differ: ${newSegments.night.start} and ${newSegments.night.end}`);
    logStepMessage("✅ Step 10");
}

async function step11() {
    logStepMessage("▶️ Step 11");
    const editRegimenBtn =  await getElementById('tvSecond', 'common.cmn_regimen_edit_changes');
    await editRegimenBtn.click();

    await getElementById('tvHeaderTitle', 'screens.REGIMEN_MENU.regimen_pin_title');
    await getElementById('tvEditRegimenPasswordNote', 'screens.REGIMEN_MENU.regiment_note');

    const systemClock = await getElementById('tvHeaderSystemClock');
    const systemClockStr = await systemClock.getText();
    logStepMessage(`Check ${systemClockStr}`); 
    if (isStrictValidDate(systemClockStr)) {
        logStepMessage(`✅ Date ${systemClockStr} displayed instead of time`); 
    } else if (isStrictValidTime(systemClockStr)) {
        throw new  Error(`❌ Time  ${systemClockStr} displayed instead of date`);
    } else {
        throw new  Error(`❌ Date not properly displayed: ${systemClockStr}`);
    }
    logStepMessage("✅ Step 11");
}

async function step12(pinCode) {
    logStepMessage("▶️ Step 12");
    await enterPinCode(pinCode);
    if (await isElementDisplayedById('tvPinError')) {
        const pinError = await browser.$(buildSelectorById('tvPinError'));
        const pinErrorStr = await pinError.getText();
        throw new Error(`❌ ${pinErrorStr} [screens.REGIMEN_MENU.regiment_wrong_pin]`);
    }
    await getElementById('tvHeaderTitle', 'screens.REGIMEN_OVERVIEW.title_single_regimen_edit');
    logStepMessage("✅ Step 12");
}

async function step13(initialSegments, newStartDay, newTotalDose) {
    logStepMessage("▶️ Step 13");
    await updateValueWithPlusMinusClicks({
        mode: 'hour',
        actualValue: initialSegments.day.start,
        newValue: newStartDay
    });

    await updateValueWithPlusMinusClicks({
        mode: 'dose',
        actualValue: initialSegments.totalDose,
        newValue: newTotalDose
    });
    logStepMessage("✅ Step 13");
}

async function step14(initialSegments) {
    logStepMessage("▶️ Step 14");
    const doneBtn = await getElementById('tvSecond', 'common.cmn_text_done');
    await doneBtn.click();

    await getElementById('tvHeaderTitle', 'screens.REGIMEN_OVERVIEW.title_single_regimen_overview');

    const segmentsValues = await getSegmentsValues();
    const newSegments = segmentsValues.segmentsValues;

    assertComparison(initialSegments, newSegments, false, "Regimen");   // expect changed
    logStepMessage("✅ Segments saved as expected");

    if (newSegments.day.end == newSegments.day.start) {
        throw new Error(`❌ Day segment - Start time and End time are equal: ${newSegments.day.start}`);
    }
    logStepMessage(`✅ Day segment - Start time and End time differ: ${newSegments.day.start} and ${newSegments.day.end}`);

    if (newSegments.night.end == newSegments.night.start) {
        throw new Error(`❌ Night segment - Start time and End time are equal: ${newSegments.night.start}`);
    }
    logStepMessage(`✅ Night segment - Start time and End time differ: ${newSegments.night.start} and ${newSegments.night.end}`);
    logStepMessage("✅ Step 14");
    return segmentsValues;
}

async function step15(updatedSegments) {
    logStepMessage("▶️ Step 15");
    const saveRegimenBtn =  await getElementById('tvSecond', 'common.cmn_regimen_save_changes');
    await saveRegimenBtn.click();
    // saving dosing screen
    await getElementById('tvHeaderTitle', 'screens.BASAL_UPLOAD.basal_upload_screen_title');
    await getElementById('tvDoneText', 'common.cmn_action_finished');

    await waitForVisible(
            buildSelectorById('tvHeaderTitle'),
            'screens.REGIMEN_OVERVIEW.title_single_regimen_overview',
            15000
        );

    const segmentsValues = await getSegmentsValues();
    const newSegments = segmentsValues.segmentsValues;

    assertComparison(updatedSegments, newSegments, true, "Regimen");
    logStepMessage("✅ Segments saved as expected");

    if (newSegments.day.end == newSegments.day.start) {
        throw new Error(`❌ Day segment - Start time and End time are equal: ${newSegments.day.start}`);
    }
    logStepMessage(`✅ Day segment - Start time and End time differ: ${newSegments.day.start} and ${newSegments.day.end}`);

    if (newSegments.night.end == newSegments.night.start) {
        throw new Error(`❌ Night segment - Start time and End time are equal: ${newSegments.night.start}`);
    }
    logStepMessage(`✅ Night segment - Start time and End time differ: ${newSegments.night.start} and ${newSegments.night.end}`);

    logStepMessage("✅ Step 15");
}

async function step16() {
    logStepMessage("▶️ Step 16");
    const backBtn = await getElementById('ivHeaderBack');
    await backBtn.click();
    await getElementById('tvHeaderTitle', 'screens.HOME.home_title');
    await waitForVisible(
        buildSelectorById('tvAlertTitle'),
        'alerts.EMPTY_DRUG.alert_title_empty_drug',
        10000,
        300,
        true
    );
    logStepMessage("✅ Alert MEDICATION IS EMPTY shown [alerts.EMPTY_DRUG.alert_title_empty_drug] upper case");
    logStepMessage("✅ Step 16");
}

async function step17(updatedSegments) {
    logStepMessage("▶️ Step 17");

    let segmentsValues;
    ({ segmentsValues } = await openDosingRegimenSettings());

    assertComparison(updatedSegments, segmentsValues, true, "Regimen");
    logStepMessage("✅ Segments saved as expected");

    if (segmentsValues.day.end == segmentsValues.day.start) {
        throw new Error(`❌ Day segment - Start time and End time are equal: ${segmentsValues.day.start}`);
    }
    logStepMessage(`✅ Day segment - Start time and End time differ: ${segmentsValues.day.start} and ${segmentsValues.day.end}`);

    if (segmentsValues.night.end == segmentsValues.night.start) {
        throw new Error(`❌ Night segment - Start time and End time are equal: ${segmentsValues.night.start}`);
    }
    logStepMessage(`✅ Night segment - Start time and End time differ: ${segmentsValues.night.start} and ${segmentsValues.night.end}`);
    logStepMessage("✅ Step 17");
}

async function step18(apiBaseUrl, updatedSegments) {
    logStepMessage("▶️ Step 18");
    const startDayInSeconds = convertHoursToSeconds(parseHour(updatedSegments.day.start));
    const startNightInSeconds = convertHoursToSeconds(parseHour(updatedSegments.night.start));

    // [REGIMENS] Regimen Data: 0
    // [REGIMENS] Segment 1 (start,flow): 14400,590
    // [REGIMENS] Segment 2 (start,flow): 79200,80

    // [REGIMENS] Segment 1 (start,flow): 7200,590
    // [REGIMENS] Segment 2 (start,flow): 72000,80

    const segment1 = `[REGIMENS] Segment 1 (start,flow): ${startDayInSeconds},${updatedSegments.day.doseRate}\``;
    const segment2 = `[REGIMENS] Segment 2 (start,flow): ${startNightInSeconds},${updatedSegments.night.doseRate}\``;
    logStepMessage(segment1);
    logStepMessage(segment2);

    await verifyLogsContain(apiBaseUrl, `[REGIMENS] Info tst: 0\`||[REGIMENS] Rec. CRC Tst: 1\`||[REGIMENS] Regimen Data: 0\`||${segment1}||${segment2}||[REGIMENS] Saved CRC Test Event: 1\`||[REGIMENS] # Regim: 1\`||[REGIMENS] Actv Indx: 0\``, 1000, "error");
    logStepMessage("✅ Step 18");
}

