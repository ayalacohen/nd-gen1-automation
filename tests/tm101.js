// helpers
import { clearPumpLogs, connectTwico, disconnectTwico, pressPumpButton, verifyLogsContain } from '../helpers/apiHelpers.js';
import { convertHoursToMs } from '../helpers/generalHelpers.js';
import { buildSelectorById, checkAlert, csClearCSLogs, enterPinCode, getCachedString, getElementById, getSegmentsValues, isElementDisplayedById, isElementDisplayedByText, openDosingRegimenSettings, updateValueWithPlusMinusClicks, waitForVisible, waitWithHeartbeat } from '../helpers/uiHelpers.js';

import { loadStrings } from '../helpers/i18n.js';
import { logPretty, logStep, logStepMessage } from '../helpers/logger.js';

// config
import { adbCouplePump, adbDecouplePump, adbDownloadCSLogs, adbUpdateConfigFilesAndMainSn } from '../helpers/adbHelpers.js';
import config from '../helpers/config.js';
import { verifyRegimenPassed } from '../helpers/dbHelpers.js';
import { flowState, saveState } from '../helpers/flowState.js';
import { assertComparison, convertHoursToSeconds, isStrictValidDate, isStrictValidTime, parseHour } from '../helpers/generalHelpers.js';

import allureReporter from '@wdio/allure-reporter';

/*
Precondition:
Using CS configuration tool NDUI to change: “FW Configuration File”-> user_default_key= 1, “APK Configuration File”-> HcpUser = True,

CS and pump are paired

Pump in Delivery 
*/

// run after prepare treatment with 1 and 1

const testKey = "TM-101";

let preconditionsPassed = false;

describe(`${testKey} - Regimen edit in paused delivery`, () => {
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
                }
            });
            await logStep('Click GET STARTED', async () => {
                if (await isElementDisplayedByText(getCachedString('common.cmn_get_started'), 20000)) {
                    logStepMessage("Click GET STARTED");
                    const getStarted = await getElementById('tvThird');
                    await getStarted.click();
                    await browser.pause(2000);
                } else {
                    logStepMessage("Skipping this step...");
                }
            });
            await logStep('Connect TWICO', async () => {
                await connectTwico(apiBaseUrl, portName);
            });
            await logStep('Decouple and press Pump button', async () => {
                if (flowState.lastSuccess && ["prepareTreatment", "tm194"].includes(flowState.lastTest)) {
                    logStepMessage("Skipping these reset steps...");
                } else {
                    adbDecouplePump();
                    await browser.pause(7000);
                    await  pressPumpButton(apiBaseUrl);
                }
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

    let segmentsValues, initialSegments, updatedSegments;

    const expectedValues = {
        day: {
            nbHours: "18 h",
            start: "4:00 AM",
            end: "10:00 PM",
            doseRate: "410",
            dose: "440"
        },
        night: {
            nbHours: "6 h",
            start: "10:00 PM",
            end: "4:00 AM",
            doseRate: "80",
            dose: "30"
        },
        totalDose: "470"
    };

    // const expectedValues = {
    // day: {
    //     nbHours: "18 h",
    //     start: "5:00 AM",
    //     end: "11:00 PM",
    //     doseRate: "500",
    //     dose: "540"
    // },
    // night: {
    //     nbHours: "6 h",
    //     start: "11:00 PM",
    //     end: "5:00 AM",
    //     doseRate: "80",
    //     dose: "30"
    // },
    // totalDose: "570"
    // };

    it(`${testKey} - Regimen edit in paused delivery`, async function () {
        try {
            allureReporter.addLabel('testKey', testKey);
            if (!preconditionsPassed) {
                // mark test as skipped in Mocha
                this.skip();
            }
            // return;
            await logStep('Step 1 - Check Dosing regimen settings not available in menu', async () => {
                await step1();
            });
            await logStep('Step 2 - Couple', async () => {
                await step2();
            });

            await logStep('Step 3 - Check Dosing regimen', async () => {
                ({ segmentsValues } = await step3());
            });
            initialSegments = segmentsValues;
            logPretty("Initial regimen", initialSegments);

            await logStep('Step 4 - Edit regimen', async () => {
                await step4();
            });

            await logStep('Step 5 - Enter default correct PIN code', async () => {
                await step5(defaultRegimenPinCode);
            });

            await logStep('Step 6 - Set start time 05:00 AM and  total daily dose 570 mg', async () => {
                await step6(apiBaseUrl, initialSegments, expectedValues);
            });

            await logStep('Step 7 - Back to Home, open Dosing regimen settings', async () => {
                await step7(expectedValues);
            });

            await logStep('Step 8 - Resume delivery', async () => {
                await step8(apiBaseUrl, expectedValues.totalDose);
            });

            await logStep('Step 9 - Pause and check pump logs', async () => {
                await step9(apiBaseUrl, expectedValues);
            });

            await logStep('Step 10 - Download CS logs and check 300/301/500 entries', async () => {
                await step10(expectedValues);
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
    const headerMenu = await getElementById('ivHeaderMenu');
    await headerMenu.click();
    await browser.pause(100);

    const dosingRegimenSettingsTxt = getCachedString('screens.MENU.menu_item_regimen_settings');
    if (await isElementDisplayedByText(dosingRegimenSettingsTxt)) {
        throw new Error("❌ Dosing Regimen settings available during delivery");
    }
    logStepMessage("✅  Dosing Regimen settings not available during delivery");

    const closeBtn = await getElementById('navDrawerClose');
    await closeBtn.click();
    logStepMessage("✅ Step 1");
}

async function step2() {
    logStepMessage("▶️ Step 2");
    adbCouplePump();
    await browser.pause(5000);

    const alert = await waitForVisible(
        buildSelectorById('tvAlertTitle'),
        'alerts.LOW_TREATMENT_PAUSED.alert_title_low_treatment_paused',
        10000,
        300,
        true
    );
    logStepMessage("✅ Alert TREATMENT PAUSED shown [alerts.LOW_TREATMENT_PAUSED.alert_title_low_treatment_paused] upper case");

    const muteBtn = await getElementById('llMuteAlarm');
    const turnOffAudio = await getElementById('tvDismissAlert');
    if (await turnOffAudio.isDisplayed()) {
        const text = await turnOffAudio.getText();
        if (text === getCachedString('common.text_turn_off_audio')) {
            logStepMessage("⏸ Clicking TURN OFF AUDIO");
            await browser.pause(1000);
            await muteBtn.click();
        } else if (text === getCachedString('common.text_turn_off_audio_ack')) {
            logStepMessage("✅ Already paused");
        } else {
            logStepMessage(`⚠️ Unexpected text: ${text}`);
        }
    } else {
        throw new Error("❌ Turn off button not displayed");
    }

    // await checkAlert(
    //     'alerts.LOW_TREATMENT_PAUSED.alert_title_low_treatment_paused',
    //     'alerts.LOW_TREATMENT_PAUSED.alert_description_treatment_paused',
    //     {
    //         localizedTemplateKey: 'alerts.STRINGS_FOR_ALERT_TYPES.alert_info_default_id_only',
    //         requiredId: '21'
    //     }
    // );

    logStepMessage("▶️ Waiting for 90s to have the complete alert message");
    await waitWithHeartbeat(90000);

    await checkAlert(
        'alerts.LOW_TREATMENT_PAUSED.alert_title_low_treatment_paused',
        'alerts.LOW_TREATMENT_PAUSED.alert_description_treatment_paused',
        {
            localizedTemplateKey: 'alerts.STRINGS_FOR_ALERT_TYPES.alert_info_default',
            requiredId: '21'
        }
    );

    logStepMessage("✅ Step 2");
}

async function step3() {
    logStepMessage("▶️ Step 3");
    const segmentsValues = await openDosingRegimenSettings();
    await getElementById('tvFirstLabel', 'screens.REGIMEN_OVERVIEW.regiment_segment_start_text');
    await getElementById('tvSecondLabel', 'screens.REGIMEN_OVERVIEW.regiment_segment_end_text');
    await getElementById('tvThirdLabel', 'screens.REGIMEN_OVERVIEW.regiment_segment_flow_text_fix');
    await getElementById('tvFirstSegmentFlowUnit', 'screens.REGIMEN_OVERVIEW.regiment_segment_flow_day_text_unit');
    await getElementById('tvSecondSegmentFlowUnit', 'screens.REGIMEN_OVERVIEW.regiment_segment_flow_day_text_unit_night');
    await getElementById('tvMessageContainerInfo', 'screens.REGIMEN_OVERVIEW.regimen_daily_total_title');
    await getElementById('tvMessageContainerUnit', 'screens.REGIMEN_OVERVIEW.regiment_segment_flow_text_unit');
    await getElementById('tvInfo', 'screens.REGIMEN_OVERVIEW.regiment_segment_flow_info');
    const editRegimenBtn = await getElementById('tvSecond', 'common.cmn_regimen_edit_changes');
    if (!await editRegimenBtn.isEnabled()) {
        throw new Error("❌ EDIT REGIMEN disabled");
    }
    logStepMessage("✅ EDIT REGIMEN enabled");
    logStepMessage("✅ Step 3");
    return segmentsValues;
}

async function step4() {
    logStepMessage("▶️ Step 4");
    const editRegimenBtn = await getElementById('tvSecond', 'common.cmn_regimen_edit_changes');
    await editRegimenBtn.click();

    await getElementById('tvHeaderTitle', 'screens.REGIMEN_MENU.regimen_pin_title');
    await getElementById('tvEditRegimenPasswordNote', 'screens.REGIMEN_MENU.regiment_note');

    const systemClock = await getElementById('tvHeaderSystemClock');
    const systemClockStr = await systemClock.getText();
    logStepMessage(`Check ${systemClockStr}`);
    if (isStrictValidDate(systemClockStr)) {
        logStepMessage(`✅ Date ${systemClockStr} displayed instead of time`);
    } else if (isStrictValidTime(systemClockStr)) {
        throw new Error(`❌ Time  ${systemClockStr} displayed instead of date`);
    } else {
        throw new Error(`❌ Date not properly displayed: ${systemClockStr}`);
    }
    logStepMessage("✅ Step 4");
}

async function step5(pinCode) {
    logStepMessage("▶️ Step 5");
    await enterPinCode(pinCode);
    if (await isElementDisplayedById('tvPinError')) {
        const pinError = await browser.$(buildSelectorById('tvPinError'));
        const pinErrorStr = await pinError.getText();
        throw new Error(`❌ ${pinErrorStr} [screens.REGIMEN_MENU.regiment_wrong_pin]`);
    }
    await getElementById('tvHeaderTitle', 'screens.REGIMEN_OVERVIEW.title_single_regimen_edit');
    logStepMessage("✅ Step 5");
}

async function step6(apiBaseUrl, initialSegments, expectedValues) {
    logStepMessage("▶️ Step 6");
    await updateValueWithPlusMinusClicks({
        mode: 'hour',
        actualValue: initialSegments.day.start,
        newValue: expectedValues.day.start
    });

    await updateValueWithPlusMinusClicks({
        mode: 'dose',
        actualValue: initialSegments.totalDose,
        newValue: expectedValues.totalDose
    });

    const doneBtn = await getElementById('tvSecond', 'common.cmn_text_done');
    await doneBtn.click();

    const saveRegimenBtn = await getElementById('tvSecond', 'common.cmn_regimen_save_changes');
    await saveRegimenBtn.click();

    await getElementById('tvHeaderTitle', 'screens.BASAL_UPLOAD.basal_upload_screen_title');
    await getElementById('tvDoneText', 'common.cmn_action_finished');

    await waitForVisible(
        buildSelectorById('tvHeaderTitle'),
        'screens.REGIMEN_OVERVIEW.title_single_regimen_overview',
        15000
    );

    const segmentsValues = await getSegmentsValues();
    const newSegments = segmentsValues.segmentsValues;

    assertComparison(expectedValues, newSegments, true, "Regimen");
    logStepMessage("✅ Segments saved as expected");

    const startDayInSeconds = convertHoursToSeconds(parseHour(newSegments.day.start));
    const startNightInSeconds = convertHoursToSeconds(parseHour(newSegments.night.start));

    // [REGIMENS] Segment 1 (start,flow): 18000,500
    // [REGIMENS] Segment 2 (start,flow): 82800,80

    const segment1 = `[REGIMENS] Segment 1 (start,flow): ${startDayInSeconds},${newSegments.day.doseRate}\``;
    const segment2 = `[REGIMENS] Segment 2 (start,flow): ${startNightInSeconds},${newSegments.night.doseRate}\``;
    logStepMessage(segment1);
    logStepMessage(segment2);

    await verifyLogsContain(apiBaseUrl, `[REGIMENS] Info tst: 0\`||[REGIMENS] Rec. CRC Tst: 1\`||[REGIMENS] Regimen Data: 0\`||${segment1}||${segment2}||[REGIMENS] Saved CRC Test Event: 1\`||[REGIMENS] # Regim: 1\`||[REGIMENS] Actv Indx: 0\``, 1000, "error");

    logStepMessage("✅ Step 6");
}

async function step7(expectedValues) {
    logStepMessage("▶️ Step 7");
    const backBtn = await getElementById('ivHeaderBack');
    await backBtn.click();

    let segmentsValues;
    ({ segmentsValues } = await openDosingRegimenSettings());

    assertComparison(segmentsValues, expectedValues, true, "Regimen");   // expect unchanged
    logStepMessage("✅ Segments saved as expected");

    logStepMessage("✅ Step 7");
}

async function step8(apiBaseUrl, newTotalDose) {
    logStepMessage("▶️ Step 8");
    const backBtn = await getElementById('ivHeaderBack');
    await backBtn.click();

    adbDecouplePump();
    await browser.pause(10000);
    await pressPumpButton(apiBaseUrl);
    await browser.pause(5000);

    const pumpStatusBtn = await getElementById('tvHomeActionRight', 'screens.HOME.home_screen_action_pump_status');
    await pumpStatusBtn.click();
    await browser.pause(1000);

    await getElementById('tvHeaderTitle', 'screens.PUMP_STATUS.pump_status_title');

    await getElementById('tvPumpStatusDisclaimer', 'screens.PUMP_STATUS.status_screen_disclaimer');

    const drugDelivered = await getElementById('tvStatusOnDrugDelivered');
    const drugDeliveredStart = (await drugDelivered.getText()).trim();
    logStepMessage(`drugDeliveredStart: ${drugDeliveredStart}`);
    const drugDeliveredNumbers = drugDeliveredStart.match(/\/\s*(\d+)/);
    const drugDeliveredTotalDose = drugDeliveredNumbers ? drugDeliveredNumbers[1] : null;

    if (drugDeliveredTotalDose != newTotalDose) {
        throw new Error(`❌ Pump status Total daily dose ${drugDeliveredTotalDose} different than new total daily dose ${newTotalDose}`);
    }
    logStepMessage(`✅ Pump status Total daily dose has the new value, as expected: ${drugDeliveredTotalDose}`);
    logStepMessage("✅ Step 8");
}

async function step9(apiBaseUrl, expectedValues) {
    logStepMessage("▶️ Step 9");
    adbCouplePump();
    await browser.pause(5000);

    const alert = await waitForVisible(
        buildSelectorById('tvAlertTitle'),
        'alerts.LOW_TREATMENT_PAUSED.alert_title_low_treatment_paused',
        10000,
        300,
        true
    );
    logStepMessage("✅ Alert TREATMENT PAUSED shown [alerts.LOW_TREATMENT_PAUSED.alert_title_low_treatment_paused] upper case");

    await checkAlert(
        'alerts.LOW_TREATMENT_PAUSED.alert_title_low_treatment_paused',
        'alerts.LOW_TREATMENT_PAUSED.alert_description_treatment_paused',
        {
            localizedTemplateKey: 'alerts.STRINGS_FOR_ALERT_TYPES.alert_info_default_id_only',
            requiredId: '21'
        }
    );

    const muteBtn = await getElementById('llMuteAlarm');
    const turnOffAudio = await getElementById('tvDismissAlert');
    if (await turnOffAudio.isDisplayed()) {
        const text = await turnOffAudio.getText();
        if (text === getCachedString('common.text_turn_off_audio')) {
            logStepMessage("⏸ Clicking TURN OFF AUDIO");
            await browser.pause(1000);
            await muteBtn.click();
        } else if (text === getCachedString('common.text_turn_off_audio_ack')) {
            logStepMessage("✅ Already paused");
        } else {
            logStepMessage(`⚠️ Unexpected text: ${text}`);
        }
    } else {
        throw new Error("❌ Turn off button not displayed");
    }

    const startDayInSeconds = convertHoursToSeconds(parseHour(expectedValues.day.start));
    const startNightInSeconds = convertHoursToSeconds(parseHour(expectedValues.night.start));

    // [PB] 0,410,14400,80,79200,52057`
    // [DLV] Resume: Actv:0,FR:410,SegEnd:14400`

    // PB log without <timeleft>`
    const pbLog = `[PB] 0,${expectedValues.day.doseRate},${startDayInSeconds},${expectedValues.night.doseRate},${startNightInSeconds},`;
    const deliveryLog = `[DLV] Resume: Actv:0,FR:${expectedValues.day.doseRate},SegEnd:${startDayInSeconds}\``;

    await verifyLogsContain(apiBaseUrl, `${pbLog}||${deliveryLog}`, 1000, "error");

    logStepMessage("✅ Step 9");
}

async function step10(expectedValues) {
    logStepMessage("▶️ Step 10");
    const dbFile = "db/101_9_control_station_logs.db";
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
    logStepMessage("✅ Step 10");
}
