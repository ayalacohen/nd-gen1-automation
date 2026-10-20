// helpers
import { adbDownloadCSLogs, adbGetDeviceDate, adbUpdateConfigFilesAndMainSn } from '../helpers/adbHelpers.js';
import { clearPumpLogs, connectTwico, disconnectTwico, updateParameterValue, verifyLogsContain } from '../helpers/apiHelpers.js';
import { pairPump, resetToFTU } from '../helpers/preConditionsHelpers.js';
import { buildSelectorById, checkAlarm, csClearCSLogs, enterPinCode, getCachedString, getElementById, getElementByIdAndText, getSegmentsValues, isElementDisplayedById, isElementDisplayedByText, openDosingRegimenSettings, updateValueWithPlusMinusClicks, waitForVisible } from '../helpers/uiHelpers.js';

import { loadStrings } from '../helpers/i18n.js';
import { logPretty, logStep, logStepMessage } from '../helpers/logger.js';

// config
import config from '../helpers/config.js';
import { verifyRegimenFailed, verifyRegimenPassed } from '../helpers/dbHelpers.js';
import { flowState, saveState } from '../helpers/flowState.js';
import { assertComparison, convertHoursToMs, convertHoursToSeconds, formatToDateObj, getDayDD, parseHour } from '../helpers/generalHelpers.js';

import allureReporter from '@wdio/allure-reporter';

/*
Precondition:
Use VnV pump version (\Device - Device SW Shared\0 Releases\0 Version H\0 Formal Version H builds\Pump FW\H.1.0)

CS and pump in FTU

CS with Patient configuration

Insert CS SN: adb shell

server_daemon_nonvolotile update main_sn 987654321

reboot

Clear CS logs via hidden menu

Clear pump logs via TwikoGUI
*/

const testKey = "TM-2625";

let preconditionsPassed = false;

describe(`${testKey} - Regimen verification: Read back the regimen data validation failed- Pump VnV version`, () => {
    const { apiBaseUrl, globalParams } = config;
    const { pumpName, portName } = { ...globalParams };

    let apkLocalConfigFile = "adb-config-files/PATIENT_cs_config.json";
    const fwLocalConfigFile = "adb-config-files/DEFAULT_0_config.file";
    const mainSN = "987654321";

    let deviceDate, ddToday, pinCode;

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

                logStepMessage(`Device date: ${deviceDateStr}`);
                logStepMessage(`PIN today: ${pinCode}`);
            });

            await logStep('Connect TWICO', async () => {
                await connectTwico(apiBaseUrl, portName);
            });

            await logStep('Reset to FTU', async () => {
                await resetToFTU(apiBaseUrl);
            });

            await logStep('Clear CS logs', async () => {
                await csClearCSLogs();
            });

            await logStep('Clear pump logs', async () => {
                await clearPumpLogs(apiBaseUrl);
            });
            preconditionsPassed = true;
        } catch (err) {
            throw new Error(`PRECONDITION FAILED: ${err.message}`);
        }
    });

    let segmentsValues, initialSegments;

    const defaultRegimenValues = {
        day: {
            nbHours: "18 h",
            start: "3:00 AM",
            end: "9:00 PM",
            doseRate: "640",
            dose: "690"
        },
        night: {
            nbHours: "6 h",
            start: "9:00 PM",
            end: "3:00 AM",
            doseRate: "80",
            dose: "30"
        },
        totalDose: "720"
    };

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

    const expectedValues2 = {
        day: {
            nbHours: "18 h",
            start: "4:00 AM",
            end: "10:00 PM",
            doseRate: "360",
            dose: "390"
        },
        night: {
            nbHours: "6 h",
            start: "10:00 PM",
            end: "4:00 AM",
            doseRate: "80",
            dose: "30"
        },
        totalDose: "420"
    };

    it(`${testKey}`, async function () {
        try {
            allureReporter.addLabel('testKey', testKey);
            if (!preconditionsPassed) {
                // mark test as skipped in Mocha
                this.skip();
            }
            await logStep('Step 1 - Pair pump, Open Dosing regimen overview', async () => {
                (segmentsValues = await step1(pumpName, defaultRegimenValues));
            });

            initialSegments = segmentsValues;
            logPretty("Initial regimen", initialSegments);

            await logStep('Step 2 - Update VALIDATION parameters', async () => {
                await step2(apiBaseUrl);
            });

            await logStep('Step 3 - Edit regimen, set start time 05:00 AM and total dose 620 and Activate', async () => {
                await step3(pinCode, initialSegments.day.start, "5:00 AM", initialSegments.totalDose, "620");
            });

            await logStep('Step 4 - Try again, Dosing regimen', async () => {
                await step4();
            });

            await logStep('Step 5 - Download CS logs and check 206/300/301/500 failed entries', async () => {
                await step5(expectedValues);
            });

            await logStep('Step 6 - Edit regimen, set start time 05:00 AM and total dose 620 and Activate  ', async () => {
                await step6(pinCode, "12:01 AM", "5:00 AM", initialSegments.totalDose, "620");
            });

            await logStep('Step 7 - Update VALIDATION parameters to fix validation check ', async () => {
                await step7(apiBaseUrl);
            });

            await logStep('Step 8 - Try again, Dosing regimen, Activate until Get Started', async () => {
                await step8();
            });

            await logStep('Step 9 - Download CS logs and check 300/301/500 passed entries', async () => {
                await step9(expectedValues);
            });

            await logStep('Step 10 - Check pump logs', async () => {
                await step10(apiBaseUrl, expectedValues);
            });

            await logStep('Step 11 - Update HCP config file and relaunch', async () => {
                apkLocalConfigFile = "adb-config-files/HCP_cs_config.json";
                await adbUpdateConfigFilesAndMainSn(apkLocalConfigFile);
                flowState.lastCategory = "HCP_0";

                await browser.pause(5000);

                await step11(expectedValues);
            });

            await logStep('Step 12 - Update VALIDATION parameters', async () => {
                await step12(apiBaseUrl);
            });

            await logStep('Step 13 - Edit regimen, set start time 04:00 AM and total dose 420 Save', async () => {
                await step13(pinCode, expectedValues.day.start, "4:00 AM", expectedValues.totalDose, "420");
            });

            await logStep('Step 14 - Try again, Dosing regimen', async () => {
                await step14();
            });

            await logStep('Step 15 - Download CS logs and check 206/300/301/500 failed entries', async () => {
                await step15(expectedValues2);
            });

            await logStep('Step 16 - Check pump logs', async () => {
                await step16(apiBaseUrl, expectedValues2);
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

async function step1(pumpName, defaultRegimenValues) {
    logStepMessage("▶️ Step 1");
    await pairPump(pumpName);

    const nextBtn = await getElementById('tvSecond');
    await nextBtn.click();
    await browser.pause(100);

    const { segmentsValues } = await getSegmentsValues();

    if (segmentsValues.totalDose !== defaultRegimenValues.totalDose) {
        throw new Error(`❌ Regimen total dose: ${segmentsValues.totalDose} not ${defaultRegimenValues.totalDose} as expected`);
    }
    logStepMessage("✅ Regimen with defaut total dose as expected");

    assertComparison(segmentsValues, defaultRegimenValues, true, "Regimen");   // expect unchanged
    logStepMessage("✅ Default segments as expected");
    logStepMessage("✅ Step 1");
    return segmentsValues;
}

async function step2(apiBaseUrl) {
    logStepMessage("▶️ Step 2");
    await updateParameterValue(apiBaseUrl, "VALIDATION", 1012, 277);
    await updateParameterValue(apiBaseUrl, "VALIDATION2", 1015, 5);
    await updateParameterValue(apiBaseUrl, "VALIDATION3", 1016, 100);
    logStepMessage("✅ Step 2");
}

async function step3(pinCode, actualStartDay, newStartDay, actualTotalDose, newTotalDose) {
    logStepMessage("▶️ Step 3");
    const editRegimenBtn = await getElementById('tvEditSegments', 'common.cmn_regimen_edit_changes');
    await editRegimenBtn.click();

    await enterPinCode(pinCode);
    if (await isElementDisplayedById('tvPinError')) {
        const pinError = await browser.$(buildSelectorById('tvPinError'));
        const pinErrorStr = await pinError.getText();
        throw new Error(`❌ ${pinErrorStr} [screens.REGIMEN_MENU.regiment_wrong_pin]`);
    }
    await getElementById('tvHeaderTitle', 'screens.REGIMEN_OVERVIEW.title_single_regimen_edit');

    await updateValueWithPlusMinusClicks({
        mode: 'hour',
        actualValue: actualStartDay,
        newValue: newStartDay
    });

    await updateValueWithPlusMinusClicks({
        mode: 'dose',
        actualValue: actualTotalDose,
        newValue: newTotalDose
    });

    const doneBtn = await getElementById('tvSecond', 'common.cmn_text_done');
    await doneBtn.click();

    const activateRegimenBtn = await waitForVisible(
        buildSelectorById('tvSecond'),
        'common.cmn_regimen_activate_changes',
        10000
    );
    await activateRegimenBtn.click();

    await browser.pause(2000);

    await checkAlarm(
        'dialogs.ALERT_REGIMEN_UPLOAD_FAILED.alert_type_regimen_upload_failed_title',
        'dialogs.ALERT_REGIMEN_UPLOAD_FAILED.alert_type_regimen_upload_failed_info',
        { expectedStr: 'ID 1036 ' }
    );
    logStepMessage("✅ Step 3");
}

async function step4() {
    logStepMessage("▶️ Step 4");
    const tryAgainBtn = await getElementById('tvThird', 'common.cmn_text_try_again');
    await tryAgainBtn.click();

    await waitForVisible(
        buildSelectorById('tvHeaderTitle'),
        'screens.REGIMEN_OVERVIEW.title_single_regimen_overview',
        15000
    );
    logStepMessage("✅ Step 4");
}

async function step5(expectedValues) {
    logStepMessage("▶️ Step 5");
    const dbFile = "db/2625_5_control_station_logs.db";
    await browser.pause(10000);
    adbDownloadCSLogs(dbFile);

    // 300 field_c [{"":[{"startTime":100000,"value":5},{"startTime"::82800000,"value":80}]}]
    // 301 field_c [{"":[{"startTime"::18000000,"value":550},{"startTime"::82800000,"value":80}]}]
    // 500 field_a Regimen Verification Failed
    // 206 field_a Dialog shown: 1036

    const startDayInMilliSeconds = convertHoursToMs(parseHour(expectedValues.day.start));
    const startNightInMilliSeconds = convertHoursToMs(parseHour(expectedValues.night.start));

    const expectedJsonFor300 = [
        {
            "": [
                { startTime: 100000, value: 5 },
                { startTime: startNightInMilliSeconds, value: Number(expectedValues.night.doseRate) }
            ]
        }
    ];

    const expectedJsonFor301 = [
        {
            "": [
                { startTime: startDayInMilliSeconds, value: Number(expectedValues.day.doseRate) },
                { startTime: startNightInMilliSeconds, value: Number(expectedValues.night.doseRate) }
            ]
        }
    ];

    const expectedTextFor206 = "Dialog shown: 1036";

    verifyRegimenFailed(dbFile, expectedJsonFor300, expectedJsonFor301, expectedTextFor206);
    logStepMessage("✅ Step 5");
}

async function step6(pinCode, actualStartDay, newStartDay, actualTotalDose, newTotalDose) {
    logStepMessage("▶️ Step 6");
    const editRegimenBtn = await getElementById('tvEditSegments', 'common.cmn_regimen_edit_changes');
    await editRegimenBtn.click();

    await enterPinCode(pinCode);
    if (await isElementDisplayedById('tvPinError')) {
        const pinError = await browser.$(buildSelectorById('tvPinError'));
        const pinErrorStr = await pinError.getText();
        throw new Error(`❌ ${pinErrorStr} [screens.REGIMEN_MENU.regiment_wrong_pin]`);
    }
    await getElementById('tvHeaderTitle', 'screens.REGIMEN_OVERVIEW.title_single_regimen_edit');

    await updateValueWithPlusMinusClicks({
        mode: 'hour',
        actualValue: actualStartDay,
        newValue: newStartDay
    });

    await updateValueWithPlusMinusClicks({
        mode: 'dose',
        actualValue: actualTotalDose,
        newValue: newTotalDose
    });

    const doneBtn = await getElementById('tvSecond', 'common.cmn_text_done');
    await doneBtn.click();

    const activateRegimenBtn = await waitForVisible(
        buildSelectorById('tvSecond'),
        'common.cmn_regimen_activate_changes',
        10000
    );
    await activateRegimenBtn.click();

    await browser.pause(2000);

    await checkAlarm(
        'dialogs.ALERT_REGIMEN_UPLOAD_FAILED.alert_type_regimen_upload_failed_title',
        'dialogs.ALERT_REGIMEN_UPLOAD_FAILED.alert_type_regimen_upload_failed_info',
        { expectedStr: 'ID 1036 ' }
    );
    logStepMessage("✅ Step 6");
}

async function step7(apiBaseUrl) {
    logStepMessage("▶️ Step 7");
    await updateParameterValue(apiBaseUrl, "VALIDATION", 1012, 0);
    await updateParameterValue(apiBaseUrl, "VALIDATION2", 1015, -1);
    await updateParameterValue(apiBaseUrl, "VALIDATION3", 1016, -1);
    logStepMessage("✅ Step 7");
}

async function step8() {
    logStepMessage("▶️ Step 8");
    const tryAgainBtn = await getElementById('tvThird', 'common.cmn_text_try_again');
    await tryAgainBtn.click();

    await waitForVisible(
        buildSelectorById('tvHeaderTitle'),
        'screens.REGIMEN_OVERVIEW.title_single_regimen_overview',
        15000
    );

    const activateRegimenBtn = await getElementById('tvSecond', 'common.cmn_regimen_activate_changes');
    await activateRegimenBtn.click();

    await getElementByIdAndText('tvHeaderTitle', 'screens.FTU_SETUP_DONE.set_up_done_title');
    logStepMessage("✅ Set up completed");

    let getStarted = await waitForVisible(
        buildSelectorById('tvSecond'),
        'common.cmn_get_started',
        12000
    );
    await getStarted.click();
    await browser.pause(1000);

    getStarted = await waitForVisible(
        buildSelectorById('tvThird'),
        'common.cmn_get_started',
        10000
    );
    await getStarted.click();
    await browser.pause(1000);

    if (await isElementDisplayedById('tvDismissAlert')) {
        const audioBtn = await getElementById('tvDismissAlert');
        await audioBtn.click();
    }
    logStepMessage("✅ Step 8");
}

async function step9(expectedValues) {
    logStepMessage("▶️ Step 9");
    const dbFile = "db/2625_9_control_station_logs.db";
    await browser.pause(10000);
    adbDownloadCSLogs(dbFile);

    const startDayInMilliSeconds = convertHoursToMs(parseHour(expectedValues.day.start));
    const startNightInMilliSeconds = convertHoursToMs(parseHour(expectedValues.night.start));

    const expectedRegimen = [
        {
            "": [
                { startTime: startDayInMilliSeconds, value: Number(expectedValues.day.doseRate) },
                { startTime: startNightInMilliSeconds, value: Number(expectedValues.night.doseRate) }
            ]
        }
    ];

    verifyRegimenPassed(dbFile, expectedRegimen);
    logStepMessage("✅ Step 9");
}

async function step10(apiBaseUrl, expectedValues) {
    logStepMessage("▶️ Step 10");
    const startDayInSeconds = convertHoursToSeconds(parseHour(expectedValues.day.start));
    const startNightInSeconds = convertHoursToSeconds(parseHour(expectedValues.night.start));

    const segment1 = `[REGIMENS] Segment 1 (start,flow): ${startDayInSeconds},${expectedValues.day.doseRate}\``;
    const segment2 = `[REGIMENS] Segment 2 (start,flow): ${startNightInSeconds},${expectedValues.night.doseRate}\``;
    logStepMessage(segment1);
    logStepMessage(segment2);

    await verifyLogsContain(apiBaseUrl, `[REGIMENS] Info tst: 0\`||[REGIMENS] Rec. CRC Tst: 1\`||[REGIMENS] Regimen Data: 0\`||${segment1}||${segment2}||[REGIMENS] Saved CRC Test Event: 1\`||[REGIMENS] # Regim: 1\`||[REGIMENS] Actv Indx: 0\``, 1000, "error");
    logStepMessage("✅ Step 10");
}

async function step11(expectedValues) {
    logStepMessage("▶️ Step 11");
    let segmentsValues;
    ({ segmentsValues } = await openDosingRegimenSettings());
    assertComparison(segmentsValues, expectedValues, true, "Regimen");
    logStepMessage("✅ Step 11");
}

async function step12(apiBaseUrl) {
    logStepMessage("▶️ Step 12");
    await updateParameterValue(apiBaseUrl, "VALIDATION", 1012, 277);
    await updateParameterValue(apiBaseUrl, "VALIDATION2", 1015, 5);
    await updateParameterValue(apiBaseUrl, "VALIDATION3", 1016, 100);
    logStepMessage("✅ Step 12");
}

async function step13(pinCode, actualStartDay, newStartDay, actualTotalDose, newTotalDose) {
    logStepMessage("▶️ Step 13");
    const editRegimenBtn = await getElementById('tvSecond', 'common.cmn_regimen_edit_changes');
    await editRegimenBtn.click();

    await enterPinCode(pinCode);
    if (await isElementDisplayedById('tvPinError')) {
        const pinError = await browser.$(buildSelectorById('tvPinError'));
        const pinErrorStr = await pinError.getText();
        throw new Error(`❌ ${pinErrorStr} [screens.REGIMEN_MENU.regiment_wrong_pin]`);
    }
    await getElementById('tvHeaderTitle', 'screens.REGIMEN_OVERVIEW.title_single_regimen_edit');

    await updateValueWithPlusMinusClicks({
        mode: 'hour',
        actualValue: actualStartDay,
        newValue: newStartDay
    });

    await updateValueWithPlusMinusClicks({
        mode: 'dose',
        actualValue: actualTotalDose,
        newValue: newTotalDose
    });

    const doneBtn = await getElementById('tvSecond', 'common.cmn_text_done');
    await doneBtn.click();

    const saveRegimenBtn = await getElementById('tvSecond', 'common.cmn_regimen_save_changes');
    await saveRegimenBtn.click();
    await browser.pause(200);

    await checkAlarm(
        'dialogs.ALERT_REGIMEN_UPLOAD_FAILED.alert_type_regimen_upload_failed_title',
        'dialogs.ALERT_REGIMEN_UPLOAD_FAILED.alert_type_regimen_upload_failed_info',
        { expectedStr: 'ID 1036 ' }
    );
    logStepMessage("✅ Step 13");
}

async function step14() {
    logStepMessage("▶️ Step 14");
    const tryAgainBtn = await getElementById('tvThird', 'common.cmn_text_try_again');
    await tryAgainBtn.click();

    await waitForVisible(
        buildSelectorById('tvHeaderTitle'),
        'screens.REGIMEN_OVERVIEW.title_single_regimen_overview',
        15000
    );

    const editRegimentTxt = getCachedString('common.cmn_regimen_edit_changes');
    if (!await isElementDisplayedByText(editRegimentTxt)) {
        throw new Error("❌ EDIT REGIMEN not available");
    }
    logStepMessage("✅  EDIT REGIMEN available");
    logStepMessage("✅ Step 14");
}

async function step15(expectedValues) {
    logStepMessage("▶️ Step 15");
    const dbFile = "db/2625_15_control_station_logs.db";
    await browser.pause(10000);
    adbDownloadCSLogs(dbFile);

    // 300 field_c [{"":[{"startTime":100000,"value":5},{"startTime":79200000,"value":80}]}]
    // 301 field_c [{"":[{"startTime"::14400000,"value":360},{"startTime"::79200000,"value":80}]}]
    // 500 field_a Regimen Verification Failed
    // 206 field_a Dialog shown: 1036

    const startDayInMilliSeconds = convertHoursToMs(parseHour(expectedValues.day.start));
    const startNightInMilliSeconds = convertHoursToMs(parseHour(expectedValues.night.start));

    const expectedJsonFor300 = [
        {
            "": [
                { startTime: 100000, value: 5 },
                { startTime: startNightInMilliSeconds, value: Number(expectedValues.night.doseRate) }
            ]
        }
    ];

    const expectedJsonFor301 = [
        {
            "": [
                { startTime: startDayInMilliSeconds, value: Number(expectedValues.day.doseRate) },
                { startTime: startNightInMilliSeconds, value: Number(expectedValues.night.doseRate) }
            ]
        }
    ];

    const expectedTextFor206 = "Dialog shown: 1036";

    verifyRegimenFailed(dbFile, expectedJsonFor300, expectedJsonFor301, expectedTextFor206);
    logStepMessage("✅ Step 15");
}

async function step16(apiBaseUrl, expectedValues) {
    logStepMessage("▶️ Step 16");
    const startDayInSeconds = convertHoursToSeconds(parseHour(expectedValues.day.start));
    const startNightInSeconds = convertHoursToSeconds(parseHour(expectedValues.night.start));

    const segment1 = `[REGIMENS] Segment 1 (start,flow): ${startDayInSeconds},${expectedValues.day.doseRate}\``;
    const segment2 = `[REGIMENS] Segment 2 (start,flow): ${startNightInSeconds},${expectedValues.night.doseRate}\``;
    logStepMessage(segment1);
    logStepMessage(segment2);

    await verifyLogsContain(apiBaseUrl, `[REGIMENS] Info tst: 0\`||[REGIMENS] Rec. CRC Tst: 1\`||[REGIMENS] Regimen Data: 0\`||${segment1}||${segment2}||[REGIMENS] Saved CRC Test Event: 1\`||[REGIMENS] # Regim: 1\`||[REGIMENS] Actv Indx: 0\``, 1000, "error");
    logStepMessage("✅ Step 16");
}