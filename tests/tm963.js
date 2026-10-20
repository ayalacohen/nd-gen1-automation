// helpers
import { clearPumpLogs, connectTwico, disconnectTwico, verifyLogsContain } from '../helpers/apiHelpers.js';
import { verifyRegimenPassed } from '../helpers/dbHelpers.js';
import { pairPump, resetToFTU } from '../helpers/preConditionsHelpers.js';
import { buildSelectorById, checkAlarm, csClearCSLogs, enterPinCode, enterPinRegimen, getCachedString, getElementById, getElementByIdAndText, getSegmentsValues, isElementDisplayedById, isElementDisplayedByText, openDosingRegimenSettings, scrollToItem, updateValueWithPlusMinusClicks, validateDayDoseFullCycle, validateDayStartHourFullCycle, waitForVisible } from '../helpers/uiHelpers.js';

import { loadStrings } from '../helpers/i18n.js';
import { logPretty, logStep, logStepMessage } from '../helpers/logger.js';

// config
import config from '../helpers/config.js';
import { adbCouplePump, adbDecouplePump, adbDownloadCSLogs, adbGetDeviceDate, adbUpdateConfigFilesAndMainSn } from '../helpers/adbHelpers.js';
import { assertComparison, convertHoursToMs, convertHoursToSeconds, formatToDateObj, getDayDD, isStrictValidDate, isStrictValidTime, parseHour, shiftDays } from '../helpers/generalHelpers.js';
import { flowState, saveState } from '../helpers/flowState.js';

import allureReporter from '@wdio/allure-reporter';
/*
Precondition:
Using CS configuration tool NDUI to change: 
     “FW Configuration File”-> user_default_key= 0, 
      “APK Configuration File”-> HcpUser = True,

Insert CS SN: 
      adb shell
     server_daemon_nonvolotile update main_sn 987654321
reboot

Pump in FTU
Pairing step is  completed successfully
Pump is coupled to CS
“Getting started” screen is displayed with “Set up dosing regimen” highlighted in orange. 
*/

// user_default_key 0 => use mainSn+dd

const testKey = "TM-963";

let preconditionsPassed = false;

describe(`${testKey} - Regimen pin code protection - HCP mode`, () => {
  const { apiBaseUrl, globalParams, testParams } = config;
  const { pumpName, portName } = { ...globalParams };

  const apkLocalConfigFile = "adb-config-files/HCP_cs_config.json";
  const fwLocalConfigFile = "adb-config-files/DEFAULT_0_config.file";
  const mainSN = "987654321";
//   const mainSN = "123123123";
//   const mainSN = "123456789";
  let deviceDate, ddToday, pinCode, ddTomorrow, tomorrowPinCode, ddAWeekAgo, incorrectPinCode;

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

        await logStep('Update HCP_0 config files, main sn and relaunch', async () => {
            if (flowState.lastCategory == "HCP_0") {
                logStepMessage("Skipping these update config steps...");
            } else {
                await adbUpdateConfigFilesAndMainSn(apkLocalConfigFile, fwLocalConfigFile, mainSN);
                flowState.lastCategory = "HCP_0";
            }
        });

        await logStep("Fetch device date for PIN calculations", async () => {
            const deviceDateStr = adbGetDeviceDate();
            deviceDate = formatToDateObj(deviceDateStr);

            ddToday = getDayDD(deviceDate);
            pinCode = mainSN.slice(-6) + ddToday;

            ddTomorrow = getDayDD(shiftDays(deviceDate, +1));
            tomorrowPinCode = mainSN.slice(-6) + ddTomorrow;

            ddAWeekAgo = getDayDD(shiftDays(deviceDate, -7));
            incorrectPinCode = mainSN.slice(-6) + ddAWeekAgo;

            logStepMessage(`Device date: ${deviceDateStr}`);
            logStepMessage(`PIN today: ${pinCode}`);
            logStepMessage(`PIN tomorrow: ${tomorrowPinCode}`);
            logStepMessage(`PIN week ago: ${incorrectPinCode}`);
        });

        await logStep('Connect TWICO', async () => {
            await connectTwico(apiBaseUrl, portName);
        });
        await logStep('Clear CS logs', async () => {
            await csClearCSLogs();
        });
        await logStep('Clear pump logs', async () => {
            await clearPumpLogs(apiBaseUrl);
        });
        await logStep('Reset to FTU, Pair pump', async () => {
            await resetToFTU(apiBaseUrl);
            await pairPump(pumpName);
        });

            preconditionsPassed = true;
        } catch (err) {
            throw new Error(`PRECONDITION FAILED: ${err.message}`);
        }
  });

  let segmentsValues, initialSegments, updatedSegments;

    const expectedValues = {
    day: {
        nbHours: "18 h",
        start: "4:00 AM",
        end: "10:00 PM",
        doseRate: "500",
        dose: "540"
    },
    night: {
        nbHours: "6 h",
        start: "10:00 PM",
        end: "4:00 AM",
        doseRate: "80",
        dose: "30"
    },
    totalDose: "570"
    };

  it(`${testKey}`, async function () {
    try {
            allureReporter.addLabel('testKey', testKey);
            if (!preconditionsPassed) {
                // mark test as skipped in Mocha
                this.skip(); 
            }
        // return;
        await logStep('Step 1 - Click Next to open Dosing regimen overview', async () => {
        // dosing regimen overview screen
            ({ segmentsValues } = await step1());
        });

        initialSegments = segmentsValues;
        logPretty("Initial regimen", initialSegments);

        await logStep('Step 2 - Edit Regimen', async () => {
            await step2();
        });

        await logStep(`Step 3 - Incorrect PIN ${incorrectPinCode}`, async () => {
            await step3(incorrectPinCode);
        });

        await logStep(`Step 4 - Correct PIN ${pinCode} `, async () => {
            await step4(pinCode);
        });

        await logStep('Step 5 - Click DONE', async () => {
            await step5();
        });

        await logStep('Step 6 - Click EDIT REGIMEN, set start time 05:00 AM and total dose 420 and DONE', async () => {
            ({ segmentsValues } = await step6(initialSegments, "05:00 AM", "420"));
        });

        updatedSegments = segmentsValues;
        logPretty("Updated regimen", updatedSegments);

        await logStep('Step 7 - Click ACTIVATE REGIMEN', async () => {
            await step7();
        });
        await logStep('Step 8 - Click GET STARTED until Medication empty', async () => {
            await step8();
        });
        await logStep('Step 9 - Download CS logs and check 300/301/500 entries', async () => {
            await step9(updatedSegments);
        });
        await logStep('Step 9bis - Clear CS logs', async () => {
            await csClearCSLogs();
        });
        // return;
        await logStep('Step10 - Open Dosing regimen overview', async () => {
            await step10(updatedSegments);
        });

        await logStep('Step 11 - Edit Regimen', async () => {
            await step11();
        });

        await logStep(`Step 12 - Incorrect PIN ${incorrectPinCode}`, async () => {
            await step12(incorrectPinCode);
        });

        await logStep(`Step 13 - Correct PIN ${pinCode} `, async () => {
            await step13(pinCode);
        });

        await logStep('Step 14 - Decouple', async () => {
            await step14();
        });

        await logStep('Step 15 - Couple', async () => {
            await step15();
        });

        await logStep(`Step 16 - Open Dosing regimen overview - Edit regimen with correct PIN ${pinCode} `, async () => {
            await step16(pinCode);
        });

        await logStep('Step 17 - Adjust start time - full check and set 04:00 AM', async () => {
            await step17(updatedSegments.day.start, updatedSegments.night.start, "04:00 AM");
        });

        await logStep('Step 18 - Adjust total daily dose - full check and set 570', async () => {
            await step18(updatedSegments.totalDose, "570");
        });

        await logStep('Step 19 - Click DONE', async () => {
            await step19(updatedSegments);
        });

        await logStep('Step 20 - Save regimen and decouple', async () => {
            await step20();
        });
        await logStep('Step 21 - Couple, Open Date and time, set day + 1', async () => {
            await step21();
        });
        // return;

        await logStep('Step 22 - Open dosing regimen settings and check updated regimen', async () => {
            await step22(expectedValues);
        });

        await logStep('Step 23 - Edit regimen', async () => {
            await step23();
        });

        await logStep(`Step 24 - Enter correct tomorrow PIN ${tomorrowPinCode} and edit regimen`, async () => {
            await step24(tomorrowPinCode);
        });

        await logStep('Step 25 - Check pump logs', async () => {
            await step25(apiBaseUrl, expectedValues);
        });

        await logStep('Step 26 - Download CS logs and check 300/301/500 entries', async () => {
            await step26(expectedValues);
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

async function step1() {
    logStepMessage("▶️ Step 1");
    const nextBtn = await getElementById('tvSecond');
    await nextBtn.click();
    await browser.pause(100);

    const editRegimenBtn =  await getElementById('tvEditSegments', 'common.cmn_regimen_edit_changes');
    if (!await editRegimenBtn.isEnabled()) {
        throw new Error("❌ EDIT REGIMEN disabled");
    }
    logStepMessage("✅ EDIT REGIMEN enabled"); 

    const activateRegimenBtn =  await getElementById('tvSecond', 'common.cmn_regimen_activate_changes');
    if (!await activateRegimenBtn.isEnabled()) {
        throw new Error("❌ ACTIVATE REGIMEN disabled");
    }
    logStepMessage("✅ ACTIVATE REGIMEN enabled"); 

    const segmentsValues = await getSegmentsValues();
    logStepMessage("✅ Step 1");
    return segmentsValues;
}

async function step2() {
    logStepMessage("▶️ Step 2");
    const editRegimenBtn =  await getElementById('tvEditSegments', 'common.cmn_regimen_edit_changes');
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

    const doneBtn = await getElementById('tvSecond', 'common.cmn_text_done');
    if (!await doneBtn.isEnabled()) {
        throw new Error("❌ DONE disabled");
    }
    logStepMessage("✅ DONE enabled");

    logStepMessage("✅ Step 4");
}

async function step5() {
    logStepMessage("▶️ Step 5");
    const doneBtn = await getElementById('tvSecond', 'common.cmn_text_done');
    await doneBtn.click();

    await getElementById('tvHeaderTitle', 'screens.REGIMEN_OVERVIEW.title_single_regimen_overview');

    const editRegimenBtn =  await getElementById('tvEditSegments', 'common.cmn_regimen_edit_changes');
    if (!await editRegimenBtn.isEnabled()) {
        throw new Error("❌ EDIT REGIMEN disabled");
    }
    logStepMessage("✅ EDIT REGIMEN enabled");

    const activateRegimenBtn =  await getElementById('tvSecond', 'common.cmn_regimen_activate_changes');
    if (!await activateRegimenBtn.isEnabled()) {
        throw new Error("❌ ACTIVATE REGIMEN disabled");
    }
    logStepMessage("✅ ACTIVATE REGIMEN enabled"); 
    logStepMessage("✅ Step 5");
}

async function step6(initialSegments, newStartDay, newTotalDose) {
    logStepMessage("▶️ Step 6");
    const editRegimenBtn =  await getElementById('tvEditSegments', 'common.cmn_regimen_edit_changes');
    await editRegimenBtn.click();

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

    const doneBtn = await getElementById('tvSecond', 'common.cmn_text_done');
    await doneBtn.click();

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

    const activateRegimenBtn =  await getElementById('tvSecond', 'common.cmn_regimen_activate_changes');
    if (!await activateRegimenBtn.isEnabled()) {
        throw new Error("❌ ACTIVATE REGIMEN disabled");
    }
    logStepMessage("✅ ACTIVATE REGIMEN enabled"); 
    logStepMessage("✅ Step 6");
    return segmentsValues;
}

async function step7() {
    logStepMessage("▶️ Step 7");
    const activateRegimenBtn =  await getElementById('tvSecond', 'common.cmn_regimen_activate_changes');
    await activateRegimenBtn.click();
    await getElementByIdAndText('tvHeaderTitle', 'screens.FTU_SETUP_DONE.set_up_done_title');
    logStepMessage("✅ Set up completed");
    logStepMessage("✅ Step 7");
}

async function step8() {
    logStepMessage("▶️ Step 7");
    let getStarted = await waitForVisible(
        buildSelectorById('tvSecond'),
        'common.cmn_get_started',
        12000
    );
    await getStarted.click();

    // disclaimer
    logStepMessage("▶️ Waiting for disclaimer");
    await getElementById('tvCurrentPumpStatusTitle', 'screens.DISCLAIMER_SCREEN.text_mandatory_disclaimer');
    logStepMessage("✅ Disclaimer");
    getStarted = await waitForVisible(
        buildSelectorById('tvThird'),
        'common.cmn_get_started',
        10000
    );
    await getStarted.click();
    await browser.pause(1000);

    logStepMessage("▶️ Verify medication empty alert");
    const alert = await waitForVisible(
        buildSelectorById('tvAlertTitle'),
        'alerts.EMPTY_DRUG.alert_title_empty_drug',
        10000,
        300,
        true
    );
    logStepMessage("✅ Alert MEDICATION IS EMPTY shown [alerts.EMPTY_DRUG.alert_title_empty_drug] upper case");

    if (await isElementDisplayedById('tvDismissAlert')) {
        const audioBtn = await getElementById('tvDismissAlert');
        await audioBtn.click();
    }
    logStepMessage("✅ Step 8");
}

async function step9(expectedValues) {
    logStepMessage("▶️ Step 9");// download cs log check 300 301 500
    const dbFile = "db/963_9_control_station_logs.db";
    adbDownloadCSLogs(dbFile);

    const startDayInMilliSeconds = convertHoursToMs(parseHour(expectedValues.day.start));
    const startNightInMilliSeconds = convertHoursToMs(parseHour(expectedValues.night.start));

    const expectedRegimen = [
        {
            "": [
            { startTime: startDayInMilliSeconds, value: Number(expectedValues.day.doseRate) },
            { startTime: startNightInMilliSeconds, value: Number(expectedValues.night.doseRate)}
            ]
        }
    ];

    verifyRegimenPassed(dbFile, expectedRegimen);
    logStepMessage("✅ Step 9");
}

async function step10(updatedSegments) {
    logStepMessage("▶️ Step 10");
    let segmentsValues;
    ({ segmentsValues } = await openDosingRegimenSettings());
    const newSegments = segmentsValues;

    if (await isElementDisplayedByText(getCachedString('common.cmn_regimen_edit_changes'))) {
        throw new Error(`❌EDIT REGIMEN displayed [common.cmn_regimen_edit_changes]`);
    }

    assertComparison(updatedSegments, newSegments, true, "Regimen");   // expect unchanged
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
    logStepMessage("✅ Step 12");
}

async function step13(pinCode) {
    logStepMessage("▶️ Step 13");
    await enterPinCode(pinCode);
    if (await isElementDisplayedById('tvPinError')) {
        const pinError = await browser.$(buildSelectorById('tvPinError'));
        const pinErrorStr = await pinError.getText();
        throw new Error(`❌ ${pinErrorStr} [screens.REGIMEN_MENU.regiment_wrong_pin]`);
    }
    await getElementById('tvHeaderTitle', 'screens.REGIMEN_OVERVIEW.title_single_regimen_edit');

    const doneBtn = await getElementById('tvSecond', 'common.cmn_text_done');
    if (!await doneBtn.isEnabled()) {
        throw new Error("❌ DONE disabled");
    }
    logStepMessage("✅ DONE enabled");
    logStepMessage("✅ Step 13");
}

async function step14() {
    logStepMessage("▶️ Step 14");
    adbDecouplePump();
    await browser.pause(2000);

    await checkAlarm(
        'dialogs.UNEXPECTED_DECOUPLE.alert_type_pump_decoupled_general_title',
        'dialogs.UNEXPECTED_DECOUPLE.alert_type_pump_decoupled_general_info',
        { expectedStr: 'ID 1037 ' }
    );
    logStepMessage("✅ Step 14");
}

async function step15() {
    logStepMessage("▶️ Step 15");
    adbCouplePump();
    await browser.pause(5000);

    let okBtn = await getElementById('tvThird', 'common.cmn_text_ok');
    await okBtn.click();

    await getElementById('tvHeaderTitle', 'screens.HOME.home_title');
    await waitForVisible(
        buildSelectorById('tvAlertTitle'),
        'alerts.EMPTY_DRUG.alert_title_empty_drug',
        10000,
        300,
        true
    );
    logStepMessage("✅ Alert MEDICATION IS EMPTY shown [alerts.EMPTY_DRUG.alert_title_empty_drug] upper case");
    logStepMessage("✅ Step 15");
}

async function step16(pinCode) {
    logStepMessage("▶️ Step 16");
    await openDosingRegimenSettings();
    const editRegimenBtn =  await getElementById('tvSecond', 'common.cmn_regimen_edit_changes');
    await editRegimenBtn.click();

    await enterPinRegimen(pinCode);
    if (await isElementDisplayedById('tvPinError')) {
        const pinError = await browser.$(buildSelectorById('tvPinError'));
        const pinErrorStr = await pinError.getText();
        throw new Error(`❌ ${pinErrorStr} [screens.REGIMEN_MENU.regiment_wrong_pin]`);
    }

    await getElementById('tvHeaderTitle', 'screens.REGIMEN_OVERVIEW.title_single_regimen_edit');
    logStepMessage("✅ Step 16");
}

async function step17(actualStartDay, actualStartNight, newStartDay) {
    logStepMessage("▶️ Step 17");
    await validateDayStartHourFullCycle(actualStartDay, actualStartNight);

    await updateValueWithPlusMinusClicks({
        mode: 'hour',
        actualValue: actualStartDay,
        newValue: newStartDay
    });
    logStepMessage("✅ Step 17");
}

async function step18(actualTotalDose, newTotalDose) {
    logStepMessage("▶️ Step 18");
    await validateDayDoseFullCycle(actualTotalDose);

    await updateValueWithPlusMinusClicks({
        mode: 'dose',
        actualValue: actualTotalDose,
        newValue: newTotalDose
    });
    logStepMessage("✅ Step 18");
}

async function step19(updatedSegments) {
    logStepMessage("▶️ Step 19");
    const doneBtn = await getElementById('tvSecond', 'common.cmn_text_done');
    await doneBtn.click();

    const segmentsValues = await getSegmentsValues();
    const newSegments = segmentsValues.segmentsValues;

    assertComparison(updatedSegments, newSegments, false, "Regimen");   // expect changed
    logStepMessage("✅ Segments saved as expected");

    if (newSegments.day.end == newSegments.day.start) {
        throw new Error(`❌ Day segment - Start time and End time are equal: ${newSegments.day.start}`);
    }
    logStepMessage(`✅ Day segment - Start time and End time differ: ${newSegments.day.start} and ${newSegments.day.end}`);

    if (newSegments.night.end == newSegments.night.start) {
        throw new Error(`❌ Night segment - Start time and End time are equal: ${newSegments.night.start}`);
    }
    logStepMessage(`✅ Night segment - Start time and End time differ: ${newSegments.night.start} and ${newSegments.night.end}`);
    logStepMessage("✅ Step 19");
}

async function step20() {
    logStepMessage("▶️ Step 20");
    const saveRegimenBtn =  await getElementById('tvSecond', 'common.cmn_regimen_save_changes');
    await saveRegimenBtn.click();
    await browser.pause(200);

    adbDecouplePump();
    await browser.pause(2000);

    // saving dosing screen
    await getElementById('tvHeaderTitle', 'screens.BASAL_UPLOAD.basal_upload_screen_title');
    await getElementById('tvSettingsSyncInfo', 'screens.BASAL_UPLOAD.basal_upload_screen_content');
    // await getElementById('tvHeaderTitle', 'common.cmn_regimen_activated ');
    //console.log(await browser.getPageSource()); 
    await waitForVisible(
        buildSelectorById('tvAlertTitle'),
        'alerts.EMPTY_DRUG.alert_title_empty_drug',
        40000,
        300,
        true
    );
    logStepMessage("✅ Alert MEDICATION IS EMPTY shown [alerts.EMPTY_DRUG.alert_title_empty_drug] upper case");

    await getElementById('tvHeaderTitle', 'screens.HOME.home_title');
    logStepMessage("✅ Step 20");
}

async function step21() {
    logStepMessage("▶️ Step 21");
    adbCouplePump();
    await browser.pause(5000);

    const headerMenu = await getElementById('ivHeaderMenu');
    await headerMenu.click();

    const dateAndTime = await scrollToItem('screens.MENU.menu_item_set_date', true);
    await dateAndTime.click();

    const setDate = await getElementById('tvTop');
    await setDate.click();

    const dayToSet = await getElementById('tvDay');
    await dayToSet.click();

    const plusBtn = await getElementById('ivPlusDay');
    await plusBtn.click();

    const doneBtn = await getElementById('tvSecond');
    await doneBtn.click();

    await waitForVisible(
        buildSelectorById('tvHeaderTitle'),
        ' screens.FTU_STARTUP.ftu_date_set',
        10000
    );

    const backBtn = await getElementById('ivHeaderBack');
    await backBtn.click();
    logStepMessage("✅ Step 21");
}

async function step22(expectedValues) {
    logStepMessage("▶️ Step 22");
    let segmentsValues;
    ({ segmentsValues } = await openDosingRegimenSettings());

    assertComparison(expectedValues, segmentsValues, true, "Regimen"); // should be as expected
    logStepMessage("✅ Segments saved as expected");

    if (segmentsValues.day.end == segmentsValues.day.start) {
        throw new Error(`❌ Day segment - Start time and End time are equal: ${segmentsValues.day.start}`);
    }
    logStepMessage(`✅ Day segment - Start time and End time differ: ${segmentsValues.day.start} and ${segmentsValues.day.end}`);

    if (segmentsValues.night.end == segmentsValues.night.start) {
        throw new Error(`❌ Night segment - Start time and End time are equal: ${segmentsValues.night.start}`);
    }
    logStepMessage(`✅ Night segment - Start time and End time differ: ${segmentsValues.night.start} and ${segmentsValues.night.end}`);
    logStepMessage("✅ Step 22");
}

async function step23() {
    logStepMessage("▶️ Step 23");
    const editRegimenBtn =  await getElementById('tvSecond', 'common.cmn_regimen_edit_changes');
    await editRegimenBtn.click();

    await isElementDisplayedById('tvEditRegimenPasswordNote')
    logStepMessage("✅ Step 23");
}

async function step24(pinCode) {
    logStepMessage("▶️ Step 24");
    await enterPinCode(pinCode);
    if (await isElementDisplayedById('tvPinError')) {
        const pinError = await browser.$(buildSelectorById('tvPinError'));
        const pinErrorStr = await pinError.getText();
        throw new Error(`❌ ${pinErrorStr} [screens.REGIMEN_MENU.regiment_wrong_pin]`);
    }
    await getElementById('tvHeaderTitle', 'screens.REGIMEN_OVERVIEW.title_single_regimen_edit');
    const doneBtn = await getElementById('tvSecond', 'common.cmn_text_done');
    if (!await doneBtn.isEnabled()) {
        throw new Error("❌ DONE disabled");
    }
    logStepMessage("✅ DONE enabled");
    logStepMessage("✅ Step 24");
}

async function step25(apiBaseUrl, expectedValues) {
    logStepMessage("▶️ Step 25");
    const startDayInSeconds = convertHoursToSeconds(parseHour(expectedValues.day.start));
    const startNightInSeconds = convertHoursToSeconds(parseHour(expectedValues.night.start));

    const segment1 = `[REGIMENS] Segment 1 (start,flow): ${startDayInSeconds},${expectedValues.day.doseRate}\``;
    const segment2 = `[REGIMENS] Segment 2 (start,flow): ${startNightInSeconds},${expectedValues.night.doseRate}\``;
    logStepMessage(segment1);
    logStepMessage(segment2);

    await verifyLogsContain(apiBaseUrl, `[REGIMENS] Info tst: 0\`||[REGIMENS] Rec. CRC Tst: 1\`||[REGIMENS] Regimen Data: 0\`||${segment1}||${segment2}||[REGIMENS] Saved CRC Test Event: 1\`||[REGIMENS] # Regim: 1\`||[REGIMENS] Actv Indx: 0\``, 1000, "error");
    logStepMessage("✅ Step 25");
}

async function step26(expectedValues) {
    logStepMessage("▶️ Step 26");
    const dbFile = "db/963_26_control_station_logs.db";
    adbDownloadCSLogs(dbFile);

    const startDayInMilliSeconds = convertHoursToMs(parseHour(expectedValues.day.start));
    const startNightInMilliSeconds = convertHoursToMs(parseHour(expectedValues.night.start));

    const expectedRegimen = [
        {
            "": [
            { startTime: startDayInMilliSeconds, value: Number(expectedValues.day.doseRate) },
            { startTime: startNightInMilliSeconds, value: Number(expectedValues.night.doseRate)}
            ]
        }
    ];

    verifyRegimenPassed(dbFile, expectedRegimen);
    logStepMessage("✅ Step 26");
}