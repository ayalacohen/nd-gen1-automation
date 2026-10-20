// helpers
import { clearPumpLogs, connectTwico, disconnectTwico, verifyLogsContain } from '../helpers/apiHelpers.js';
import { pairPump, resetToFTU } from '../helpers/preConditionsHelpers.js';
import { buildSelectorById, checkAlarm, csClearCSLogs, enterPinCode, enterPinRegimen, getCachedString, getElementById, getElementByIdAndText, getSegmentsValues, isElementDisplayedById, isElementDisplayedByText, openDosingRegimenSettings, updateValueWithPlusMinusClicks, validateDayDoseFullCycle, validateDayStartHourFullCycle, waitForVisible } from '../helpers/uiHelpers.js';

import { loadStrings } from '../helpers/i18n.js';
import { logPretty, logStep, logStepMessage } from '../helpers/logger.js';

// config
import config from '../helpers/config.js';
import { adbCouplePump, adbDecouplePump, adbDownloadCSLogs, adbGetDeviceDate, adbUpdateConfigFilesAndMainSn } from '../helpers/adbHelpers.js';
import { assertComparison, convertHoursToMs, convertHoursToSeconds, formatToDateObj, getDayDD, isStrictValidDate, isStrictValidTime, parseHour, shiftDays } from '../helpers/generalHelpers.js';
import { flowState, saveState } from '../helpers/flowState.js';
import { verifyRegimenPassed } from '../helpers/dbHelpers.js';

import allureReporter from '@wdio/allure-reporter';

/*
Precondition:
Using CS configuration tool NDUI to change: 
         “FW Configuration File”-> user_default_key= 0,
          “APK Configuration File”-> HcpUser = False,

Insert CS SN: adb shell
            server_daemon_nonvolotile update main_sn 987654321
reboot

Clear pump CS logs via hidden menu before test

Clear pump logs in TwikoGUI before test

Pump in FTU

Pairing step is completed successfully

Pump is coupled to CS

“Getting started” screen is displayed with “Set up dosing regimen” highlighted in orange.
*/

// user_default_key 0 => use mainSn+dd

const testKey = "TM-961";

let preconditionsPassed = false;

describe(`${testKey} - Regimen pin code protection - Patient mode`, () => {
  const { apiBaseUrl, globalParams, testParams } = config;
  const { pumpName, portName/*, mainSN*/ } = { ...globalParams };

  const apkLocalConfigFile = "adb-config-files/PATIENT_cs_config.json";
  const fwLocalConfigFile = "adb-config-files/DEFAULT_0_config.file";
//   const mainSN = "9876543210";
  const mainSN = "987654321";
//   const mainSN = "123123123";
//   const mainSN = "123456789";

  let deviceDate, ddToday, pinCode, ddAWeekAgo, incorrectPinCode;

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

        await logStep('Update PATIENT_0 config files, main sn and relaunch', async () => {
            if (flowState.lastCategory == "PATIENT_0") {
                logStepMessage("Skipping these update config steps...");
            } else {
                    await adbUpdateConfigFilesAndMainSn(apkLocalConfigFile, fwLocalConfigFile, mainSN);
                    flowState.lastCategory = "PATIENT_0";
            }
        });

        await logStep("Fetch device date for PIN calculations", async () => {
            const deviceDateStr = adbGetDeviceDate();
            deviceDate = formatToDateObj(deviceDateStr);

            ddToday = getDayDD(deviceDate);
            pinCode = mainSN.slice(-6) + ddToday;

            ddAWeekAgo = getDayDD(shiftDays(deviceDate, -7));
            incorrectPinCode = mainSN.slice(-6) + ddAWeekAgo;

            logStepMessage(`Device date: ${deviceDateStr}`);
            logStepMessage(`PIN today: ${pinCode}`);
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

  let segmentsValues, initialSegments;

    const expectedValues = {
        day: {
            nbHours: "18 h",
            start: "5:00 AM",
            end: "11:00 PM",
            doseRate: "550",
            dose: "590"
        },
        night: {
            nbHours: "6 h",
            start: "11:00 PM",
            end: "5:00 AM",
            doseRate: "80",
            dose: "30"
        },
        totalDose: "620"
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

        await logStep('Step 5 - Adjust start time - full check and set 05:00 AM ', async () => {
            await step5(initialSegments.day.start, initialSegments.night.start, "05:00 AM");
        });

        await logStep('Step 6 - Adjust total daily dose - full check and set 620', async () => {
            await step6(initialSegments.totalDose, "620");
        });

        await logStep('Step 7 - Click DONE', async () => {
            await step7(initialSegments);
        });

        await logStep('Step 8 - Click ACTIVATE REGIMEN', async () => {
            await step8();
        });
        await logStep('Step 9 - Click GET STARTED until Medication empty', async () => {
            await step9();
        });
        await logStep('Step 10 - Open Dosing regimen overview', async () => {
            await step10(initialSegments);
        });

        await logStep('Step 11 - Decouple', async () => {
            await step11();
        });
        await logStep('Step 12 - Couple', async () => {
            await step12();
        });

        await logStep('Step 13 - Check pump logs', async () => {
            await step13(apiBaseUrl, expectedValues);
        });

        await logStep('Step 14 - Download CS logs and check 300/301/500 entries', async () => {
            await step14(expectedValues);
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
        throw new Error(`❌Day segment - Start time and End time are equal: ${newSegments.day.start}`);
    }
    logStepMessage(`✅ Day segment - Start time and End time differ: ${newSegments.day.start} and ${newSegments.day.end}`);

    if (newSegments.night.end == newSegments.night.start) {
        throw new Error(`❌Day segment - Start time and End time are equal: ${newSegments.night.start}`);
    }
    logStepMessage(`✅ Night segment - Start time and End time differ: ${newSegments.night.start} and ${newSegments.night.end}`);

    logStepMessage("✅ Step 7");
}

async function step8() {
    logStepMessage("▶️ Step 8");
    const activateRegimenBtn =  await getElementById('tvSecond', 'common.cmn_regimen_activate_changes');
    await activateRegimenBtn.click();
    await getElementByIdAndText('tvHeaderTitle', 'screens.FTU_SETUP_DONE.set_up_done_title');
    logStepMessage("✅ Set up completed");
    logStepMessage("✅ Step 8");
}

async function step9() {
    logStepMessage("▶️ Step 9");
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
        10000, // 5000
        300,
        true
    );
    logStepMessage("✅ Alert MEDICATION IS EMPTY shown [alerts.EMPTY_DRUG.alert_title_empty_drug] upper case");

    if (await isElementDisplayedById('tvDismissAlert')) {
        const audioBtn = await getElementById('tvDismissAlert');
        await audioBtn.click();
    }
    logStepMessage("✅ Step 9");
}

async function step10(initialSegments) {
    logStepMessage("▶️ Step 10");
    let segmentsValues;
    ({ segmentsValues } = await openDosingRegimenSettings());
    const newSegments = segmentsValues;

    if (await isElementDisplayedByText(getCachedString('common.cmn_regimen_edit_changes'))) {
        throw new Error(`❌EDIT REGIMEN displayed [common.cmn_regimen_edit_changes]`);
    }
    logStepMessage("✅ EDIT REGIMEN NOT displayed");

    assertComparison(initialSegments, newSegments, false, "Regimen");   // expect changed
    logStepMessage("✅ Segments saved as expected");

    if (newSegments.day.end == newSegments.day.start) {
        throw new Error(`❌Day segment - Start time and End time are equal: ${newSegments.day.start}`);
    }
    logStepMessage(`✅ Day segment - Start time and End time differ: ${newSegments.day.start} and ${newSegments.day.end}`);

    if (newSegments.night.end == newSegments.night.start) {
        throw new Error(`❌Day segment - Start time and End time are equal: ${newSegments.night.start}`);
    }
    logStepMessage(`✅ Night segment - Start time and End time differ: ${newSegments.night.start} and ${newSegments.night.end}`);
    logStepMessage("✅ Step 10");
}

async function step11() {
    logStepMessage("▶️ Step 11");
    adbDecouplePump();
    await browser.pause(2000);

    await checkAlarm(
        'dialogs.UNEXPECTED_DECOUPLE.alert_type_pump_decoupled_general_title',
        'dialogs.UNEXPECTED_DECOUPLE.alert_type_pump_decoupled_general_info',
        { expectedStr: 'ID 1037 ' }
    );
    logStepMessage("✅ Step 11");
}

async function step12() {
    logStepMessage("▶️ Step 12");
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
    logStepMessage("✅ Step 12");
}

async function step13(apiBaseUrl, expectedValues) {
    logStepMessage("▶️ Step 13");
    const startDayInSeconds = convertHoursToSeconds(parseHour(expectedValues.day.start));
    const startNightInSeconds = convertHoursToSeconds(parseHour(expectedValues.night.start));

    const segment1 = `[REGIMENS] Segment 1 (start,flow): ${startDayInSeconds},${expectedValues.day.doseRate}\``;
    const segment2 = `[REGIMENS] Segment 2 (start,flow): ${startNightInSeconds},${expectedValues.night.doseRate}\``;
    logStepMessage(segment1);
    logStepMessage(segment2);

    await verifyLogsContain(apiBaseUrl, `[REGIMENS] Info tst: 0\`||[REGIMENS] Rec. CRC Tst: 1\`||[REGIMENS] Regimen Data: 0\`||${segment1}||${segment2}||[REGIMENS] Saved CRC Test Event: 1\`||[REGIMENS] # Regim: 1\`||[REGIMENS] Actv Indx: 0\``, 1000, "error");
    logStepMessage("✅ Step 13");
}

async function step14(expectedValues) {
    logStepMessage("▶️ Step 14");
    const dbFile = "db/961_14_control_station_logs.db";
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
    logStepMessage("✅ Step 14");
}