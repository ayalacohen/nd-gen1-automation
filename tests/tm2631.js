// helpers
import { clearPumpLogs, connectTwico, disconnectTwico, readLogsCommand, verifyLogsContain } from '../helpers/apiHelpers.js';
import { pairPump, resetToFTU } from '../helpers/preConditionsHelpers.js';
import { buildSelectorById, checkAlert, enterPinCode, getElementById, getElementByIdAndText, getSegmentsValues, isElementDisplayedById, openDosingRegimenSettings, scrollToItem, updateValueWithPlusMinusClicks, validateDayDoseFullCycle, validateDayStartHourFullCycle, waitForVisible } from '../helpers/uiHelpers.js';

import { loadStrings } from '../helpers/i18n.js';
import { logStep, logStepMessage } from '../helpers/logger.js';

// config
import config from '../helpers/config.js';
import { flowState, saveState } from '../helpers/flowState.js';
import { assertComparison, convertHoursToSeconds, formatPumpRtc, isStrictValidDateTime, parseHour, parseStrictDateTime } from '../helpers/generalHelpers.js';

import allureReporter from '@wdio/allure-reporter';
import { adbUpdateConfigFilesAndMainSn } from '../helpers/adbHelpers.js';

/*
Precondition:
Using CS configuration tool NDUI to change: “FW Configuration File”-> user_default_key= 1, “APK Configuration File”-> HcpUser = False,

CS and Pump in FTU
*/
const testKey = "TM-2631";
let preconditionsPassed = false;

describe(`${testKey} - Finish FTU process`, () => {
    const { apiBaseUrl, globalParams } = config;
    const { pumpName, portName, defaultRegimenPinCode } = { ...globalParams };

    const apkLocalConfigFile = "adb-config-files/PATIENT_cs_config.json";
    const fwLocalConfigFile = "adb-config-files/DEFAULT_1_config.file";
    const expectedValues = {
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

    const updatedValues = {
        day: {
            nbHours: "18 h",
            start: "4:00 AM",
            end: "10:00 PM",
            doseRate: "550",
            dose: "590"
        },
        night: {
            nbHours: "6 h",
            start: "10:00 PM",
            end: "4:00 AM",
            doseRate: "80",
            dose: "30"
        },
        totalDose: "620"
    };

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

            await logStep('Update PATIENT_1 config files and relaunch', async () => {
                if (flowState.lastCategory == "PATIENT_1") {
                    logStepMessage("Skipping these update config steps...");
                } else {
                        await adbUpdateConfigFilesAndMainSn(apkLocalConfigFile, fwLocalConfigFile);
                        flowState.lastCategory = "PATIENT_1";
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

        await logStep('Step 1 - Choose English US language, set date and time and pair the pump with pairing key', async () => {
            await step1(pumpName);
        });

        await logStep('Step 2 - Click "Next" to enter "Dosing regimen overview" section', async () => {
            await step2(expectedValues);
        });

        await logStep('Step 3 - Press on the "EDIT REGIMEN".', async () => {
            await step3();
        });

        await logStep(`Step 4 - Type an default correct PIN code: ${defaultRegimenPinCode}`, async () => {
            await step4(defaultRegimenPinCode);
        });

        await logStep('Step 5 - Adjust Day rate start time by pressing the + and – buttons', async () => {
            await step5(expectedValues.day.start, expectedValues.night.start);
        });

        await logStep('Step 6 - Press Total daily dose(mg) and adjust the dose by pressing the + and – buttons', async () => {
            await step6(expectedValues.totalDose);
        });

        await logStep('Step 7 - Select total daily dose 620, change dose time and press Done', async () => {
            await step7(expectedValues.totalDose, "620", expectedValues.day.start, "4:00 AM");
        });

        await logStep('Step 8 - Press on "Activate regimen" button', async () => {
            await step8();
        });

        await logStep('Step 9 - Press on "GET STARTED"', async () => {
            await step9();
        });

        await logStep('Step 10 - Press on "Get started" button', async () => {
            await step10();
        });

        await logStep('Step 11 - Open Main menu → Select "Dosing regimen settings"', async () => {
            await step11("620", "4:00 AM");
        });

        await logStep('Step 12 - Check sync pump date and regimen in pump logs', async () => {
            await step12(apiBaseUrl, updatedValues);
        });

        await logStep('Step 13 - Check ftu pump date in pump logs', async () => {
            await step13(apiBaseUrl);
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

async function step1(pumpName) {
    logStepMessage("▶️ Step 1");
    await pairPump(pumpName);
    logStepMessage("✅ Step 2");
}

async function step2(expectedValues) {
    logStepMessage("▶️ Step 2");
    const nextBtn = await getElementById('tvSecond');
    await nextBtn.click();
    await browser.pause(100);

    await waitForVisible(
        buildSelectorById('tvHeaderTitle'),
        'screens.REGIMEN_OVERVIEW.title_single_regimen_overview',
        15000
    );

    const editRegimenBtn =  await getElementById('tvEditSegments', 'common.cmn_regimen_edit_changes');
    if (!await editRegimenBtn.isEnabled()) {
        throw new Error("❌ EDIT REGIMEN disabled");
    }
    logStepMessage("✅ EDIT REGIMEN enabled");

    const activateRegimenBtn = await getElementById('tvSecond', 'common.cmn_regimen_activate_changes');
    if (!await activateRegimenBtn.isEnabled()) {
        throw new Error("❌ ACTIVATE REGIMEN disabled");
    }
    logStepMessage("✅ ACTIVATE REGIMEN enabled");

    const { segmentsValues } = await getSegmentsValues();

    assertComparison(expectedValues, segmentsValues, true, "Regimen"); // should be as expected
    logStepMessage("✅ Default segments as expected");

    logStepMessage("✅ Step 2");
}

async function step3() {
    logStepMessage("▶️ Step 3");
    const editRegimenBtn =  await getElementById('tvEditSegments', 'common.cmn_regimen_edit_changes');
    await editRegimenBtn.click();

    await getElementById('tvHeaderTitle', 'screens.REGIMEN_MENU.regimen_pin_title');
    await getElementById('tvEditRegimenPasswordNote', 'screens.REGIMEN_MENU.regiment_note');
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

async function step5(actualStartDay, actualStartNight) {
    logStepMessage("▶️ Step 5");
    await validateDayStartHourFullCycle(actualStartDay, actualStartNight);
    logStepMessage("✅ Step 5");
}

async function step6(actualTotalDose) {
    logStepMessage("▶️ Step 6");
    await validateDayDoseFullCycle(actualTotalDose);
    logStepMessage("✅ Step 6");
}

async function step7(actualTotalDose, newTotalDose, actualStartDay, newStartDay) {
    logStepMessage("▶️ Step 7");
    await updateValueWithPlusMinusClicks({
        mode: 'dose',
        actualValue: actualTotalDose,
        newValue: newTotalDose
    });

    await updateValueWithPlusMinusClicks({
        mode: 'hour',
        actualValue: actualStartDay,
        newValue: newStartDay
    });

    const doneBtn = await getElementById('tvSecond', 'common.cmn_text_done');
    await doneBtn.click();

    await getElementById('tvHeaderTitle', 'screens.REGIMEN_OVERVIEW.title_single_regimen_overview');
    logStepMessage("✅ Step 7");
}

async function step8() {
    logStepMessage("▶️ Step 8");

    const activateRegimenBtn =  await getElementById('tvSecond', 'common.cmn_regimen_activate_changes');
    await activateRegimenBtn.click();

    await waitForVisible(
        buildSelectorById('tvHeaderTitle'),
        'screens.FTU_SYNC_DATA.ftu_sync_data_title'
    );

    await waitForVisible(
        buildSelectorById('tvHeaderTitle'),
        'screens.FTU_SETUP_DONE.set_up_done_title'
    );

    await getElementById('tvSecond', 'common.cmn_get_started');
    logStepMessage("✅ Step 8");
}

async function step9() {
    logStepMessage("▶️ Step 9");
    const getStarted = await getElementById('tvSecond', 'common.cmn_get_started');
    await getStarted.click();

    await getElementById('tvCurrentPumpStatusTitle', 'screens.DISCLAIMER_SCREEN.text_mandatory_disclaimer');
    logStepMessage("✅ Disclaimer");

    await getElementById('tvThird', 'common.cmn_get_started');
    logStepMessage("✅ Step 9");
}

async function step10() {
    logStepMessage("▶️ Step 10");
    const getStarted = await getElementById('tvThird', 'common.cmn_get_started');
    await getStarted.click();
    await waitForVisible(
        buildSelectorById('tvAlertTitle'),
        'alerts.EMPTY_DRUG.alert_title_empty_drug',
        10000,
        300,
        true
    );
    logStepMessage("✅ Alert MEDICATION IS EMPTY shown [alerts.EMPTY_DRUG.alert_title_empty_drug] upper case");

    await checkAlert(
        'alerts.EMPTY_DRUG.alert_title_empty_drug',
        'alerts.EMPTY_DRUG.alert_description_empty_drug',
        { expectedStr: 'ID 3 ' }
    );

    if (await isElementDisplayedById('tvDismissAlert')) {
        const audioBtn = await getElementById('tvDismissAlert');
        await audioBtn.click();
    }

    const prepareTreatment = await getElementById('tvSecond', 'common.cmn_text_start_treatment');
    if (!(await prepareTreatment.isEnabled())) {
        throw new Error("❌ PREPARE TREATMENT disabled");
    }
    logStepMessage("✅ PREPARE TREATMENT enabled");

    const pumpStatus = await getElementById('tvThird', 'common.cmn_text_pump_status');
    if (!(await pumpStatus.isEnabled())) {
        throw new Error("❌ PUMP STATUS disabled");
    }
    logStepMessage("✅ PUMP STATUS enabled");

    await pumpStatus.click();

    await getElementById('tvHeaderTitle', 'screens.PUMP_STATUS.pump_status_title');
    await getElementById('tvStatusOnDrugDeliveredLabel', 'screens.PUMP_STATUS.status_screen_no_delivery');
    logStepMessage("✅ NO DELIVERY displayed");

    const backBtn = await getElementById('ivHeaderBack');
    await backBtn.click();
    logStepMessage("✅ Step 10");
}

async function step11(newTotalDose, newStartDay) {
    logStepMessage("▶️ Step 11");
    let segmentsValues;
    ({ segmentsValues } = await openDosingRegimenSettings());
    const newSegments = segmentsValues;

    if (newSegments.totalDose !== newTotalDose) {
        throw new Error(`❌ Total dose mismatch: expected=${newTotalDose}, got=${newSegments.totalDose}`);
    }
    logStepMessage(`✅ Total dose is ${newTotalDose} as expected in Dosing regimen settings`);

    if (newSegments.day.start !== newStartDay) {
        throw new Error(`❌ Start day mismatch: expected=${newStartDay}, got=${newSegments.day.start}`);
    }
    logStepMessage(`✅ Start day is ${newStartDay} as expected in Dosing regimen settings`);
    logStepMessage("✅ Step 11");
}

async function step12(apiBaseUrl, updatedValues) {
    logStepMessage("▶️ Step 12");
    const startDayInSeconds = convertHoursToSeconds(parseHour(updatedValues.day.start));
    const startNightInSeconds = convertHoursToSeconds(parseHour(updatedValues.night.start));

    const segment0 = `[REGM] SEG 0 Val: ${updatedValues.day.doseRate} Time: ${startDayInSeconds}\``;
    const segment1 = `[REGM] SEG 1 Val: ${updatedValues.night.doseRate} Time: ${startNightInSeconds}\``;
    // logStepMessage(segment0);
    // logStepMessage(segment1);

    // [REGM] SEG 0 Val: 550 Time: 14400` 
    // [REGM] SEG 1 Val: 80 Time: 79200` 

    // [0-0] Time modified`
    // [0-0] [GAT] updt: 4b : 00 00 54 1c
    // [0-0] Cnsl RTC H16 M8 S28 D10 M3 Y2026
    // [0-0] [GAT] updt: 23 : 00 00 69 b0 41 fc 00 00 00 00
    // [0-0] BLE: CLOCK_SYNC

    await verifyLogsContain(apiBaseUrl, `[BIT] REGIMENS Tst PASS\`||${segment0}||${segment1}||BLE: CLOCK_SYNC`, 0, "error");
    logStepMessage("✅ Step 12");
}

async function step13(apiBaseUrl) {
    logStepMessage("▶️ Step 13");
    let backBtn = await getElementById('ivHeaderBack');
    await backBtn.click();

    const headerMenu = await getElementById('ivHeaderMenu');
    await headerMenu.click();

    const versionDetails = await scrollToItem('screens.MENU.menu_item_version_details', true);
    await versionDetails.click();

    await scrollToItem('screens.ABOUT_SCREENS.about_pump_ftu_date', true);
    const pumpFtuDate = await getElementById('tvPumpFtuDate');
    const pumpFtuDateStr = await pumpFtuDate.getText();

    if (isStrictValidDateTime(pumpFtuDateStr, "pumpFtuDate")) {
        logStepMessage(`✅ Pump FTU date "${pumpFtuDateStr}" is in expected format`);
    } else {
        throw new Error(`❌ Pump FTU date "${pumpFtuDateStr}" is NOT in expected format`);
    }

    backBtn = await getElementById('ivHeaderBack');
    await backBtn.click();

    const dateObj = parseStrictDateTime(pumpFtuDateStr, "pumpFtuDate");

    const pumpRtcFormat = formatPumpRtc(dateObj);

    logStepMessage(`Pump RTC expected value: ${pumpRtcFormat}`);

    await readLogsCommand(apiBaseUrl);

    // FTU RTC: Y2026-M2-D22 H9:M37
    await verifyLogsContain(apiBaseUrl, `FTU RTC: ${pumpRtcFormat}`, 2000, "error");
    logStepMessage("✅ Step 13");
}
