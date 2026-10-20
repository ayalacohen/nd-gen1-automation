// helpers
import { clearPumpLogs, clockSyncronization, connectTwico, disconnectCartridgeFromPump, disconnectTwico, updateParameterValue } from '../helpers/apiHelpers.js';
import { prepareTreatmentUntilDelivery, resetToFTU } from '../helpers/preConditionsHelpers.js';
import { buildSelectorById, buildSelectorByText, checkAlarm, enterPinCode, enterPinRegimen, getCachedString, getElementById, getElementByIdAndText, isElementDisplayedById, scrollToItem, validate24HourOrAmPmMode, validateDayStartHourFullCycle, waitForVisible, waitForVisibleWithRetry } from '../helpers/uiHelpers.js';

import { loadStrings } from '../helpers/i18n.js';
import { logStep, logStepMessage } from '../helpers/logger.js';

// config
import config from '../helpers/config.js';
import { formatDateTimeByLocale, isStrictValidDateTime } from '../helpers/generalHelpers.js';
import { flowState, saveState } from '../helpers/flowState.js';

import allureReporter from '@wdio/allure-reporter';
import { adbCouplePump, adbDecouplePump, adbGetDeviceDateTime } from '../helpers/adbHelpers.js';

/*
Precondition:
1. Push cs_config file with Italian and en_UK languages

     File is located at  \Device SW Shared\5 Tests\Validation\Version H\Files for tests\CS_config file_3 lang_open  hidden menu

adb remount

adb push .\cs_config.json /system/etc

adb reboot



2. Push strings_it_IT.json 

File is located at  \Device SW Shared\5 Tests\Validation\Version H\Files for tests

Save strings_it_IT.json at adb folder



adb shell

mkdir -p /data/NEURODERM/LANGUAGES/TEXT/it_IT

exit

adb push .\strings_it_IT.json /data/NEURODERM/LANGUAGES/TEXT/it_IT

adb shell

server_daemon_monitor_language_create

reboot



3. Set via Neuroderm_UI tool: hcpUser = ON

4. Pump and CS on FTU
*/
const testKey = "TM-923";
let preconditionsPassed = false;

describe(`${testKey} - CS's Date and time format per selected language`, () => {
    const { apiBaseUrl, globalParams } = config;
    const { pumpName, portName, defaultRegimenPinCode } = { ...globalParams };

    const language1  = "de_DE"; // "de_DE" "en_150"
    const language2  = "en_US";

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

            await logStep('Clear pump logs', async () => {
                await clearPumpLogs(apiBaseUrl);
            });

            await logStep('Reset to FTU', async () => {
                await resetToFTU(apiBaseUrl);
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

        await logStep(`Step 1 - Select your language, select ${language1} and start Set date and time`, async () => {
            await step1(language1);
        });

        await logStep('Step 2 - Complete pairing flow', async () => {
            await step2(pumpName);
        });

        await logStep('Step 3 - Start set up regimen, select edit regimen ', async () => {
            await step3(defaultRegimenPinCode);
        });

        await logStep('Step 4 - Complete FTU flow by reaching home screen, Verify time format of CS', async () => {
            await step4();
        });

        await logStep('Step 5 - Open Main Menu and select version details, Verify FTU date', async () => {
            await step5();
        });

        await logStep('Step 6 - Start treatment preparation and start delivery', async () => {
            await step6(apiBaseUrl);
        });

        await logStep('Step 7 - Start treatment preparation and start delivery, Open Main Menu and select Control station → Review treatment history', async () => {
            await step7(apiBaseUrl);
        });

        await logStep('Step 8 - Simulate "Time verification" notification (ID28) (via ClockSyncronization) and Verify time format presented on the notification', async () => {
            await step8(apiBaseUrl);
        });

        await logStep('Step 9 - Back to main menu and tap "Language", Select "English - US" and Press Next', async () => {
            await step9(language2);
        });

        await logStep('Step 10 - Open Main menu and tap "Version details", Verify FTU date', async () => {
            await step10();
        });

        await logStep('Step 11 - Open Main menu, Tap Control station → Review treatment history, Verify "Treatment started" date and time format', async () => {
            await step11();
        });


        await logStep('Step 12 - Back to Main Menu → Select "Dosing regimen settings", Verify time format', async () => {
            await step12();
        });

        await logStep('Step 13 - Select edit regimen, Enter valid pin code', async () => {
            await step13(defaultRegimenPinCode, "3:00 AM", "9:00 PM");
        });

        await logStep('Step 14 - Simulate "Time verification" notification (ID28) (via ClockSyncronization) and Verify time format presented on the notification', async () => {
            await step14(apiBaseUrl);
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

async function step1(language) {
    logStepMessage("▶️ Step 1");
    try {
        const langLabel = config.languageLabels && config.languageLabels[language];
        if (langLabel) {
            const selector = buildSelectorByText(langLabel);
            const langEl = await browser.$(selector);
            if (await langEl.isDisplayed()) {
                await langEl.click();
                await browser.pause(500);
            }
        }
    } catch (err) {
        throw new Error(`❌ Failed to select language item for "${language}": ${err.message}`);
    }

    config.language = language;

    loadStrings();

    let nextBtn = await getElementById('tvSecond');
    await nextBtn.click();
    await browser.pause(100);

    nextBtn = await getElementById('tvSecond', 'common.cmn_text_next');
    await nextBtn.click();
    await browser.pause(100);

    await getElementById('tvHeaderTitle', 'screens.DATE_TIME.ftu_select_month');
    await getElementById('tvMessageContainerInfo', 'screens.DATE_TIME.ftu_select_date_info');
    await browser.pause(100);

    nextBtn = await getElementById('tvSecond', 'common.cmn_text_done');
    await nextBtn.click();
    await browser.pause(1000);

    await getElementById('tvHeaderTitle', 'screens.DATE_TIME.ftu_set_time');

    // await getElementById('tvMessageContainerInfo', 'screens.DATE_TIME.ftu_select_time_info'); // us
    await getElementById('tvMessageContainerInfo', 'screens.DATE_TIME.ftu_select_time_info_regular'); // others

    const expectedTime = await (await getElementById('tvHour')).getText() + await (await getElementById('tvSeparator')).getText() + await (await getElementById('tvMinutes')).getText();
    logStepMessage(`Read time from UI: ${expectedTime}`);

    await validate24HourOrAmPmMode(expectedTime, language);
    logStepMessage("✅ Step 1");
}

async function step2(pumpName) {
    logStepMessage("▶️ Step 2");

    let nextBtn = await getElementById('tvSecond', 'common.cmn_text_done');
    await nextBtn.click();
    await browser.pause(1000);

    nextBtn = await getElementById('tvSecond', 'common.cmn_text_next');
    await nextBtn.click();
    await browser.pause(1000);

    const pump = await waitForVisibleWithRetry(
        buildSelectorById('tvTitle') + `.text("${pumpName}")`,
        buildSelectorById('tvThird'),
        60000
    );
    await pump.click();

    await nextBtn.click();
    await browser.pause(100);

    await enterPinCode(config.globalParams.defaultPumpPinCode);

    nextBtn = await getElementById('tvSecond');
    await nextBtn.click();
    await browser.pause(200);
    await waitForVisible(
        buildSelectorById('tvSecond'),
        null,
        20000
    );
    logStepMessage("✅ Step 2");
}

async function step3(pinCode) {
    logStepMessage("▶️ Step 3");
    const nextBtn = await getElementById('tvSecond');
    await nextBtn.click();
    await browser.pause(100);

    const editRegimenBtn =  await getElementById('tvEditSegments', 'common.cmn_regimen_edit_changes');
    if (!await editRegimenBtn.isEnabled()) {
        throw new Error("❌ EDIT REGIMEN disabled");
    }
    logStepMessage("✅ EDIT REGIMEN enabled");

    let amPmSwitch = await browser.$(buildSelectorById('tvFirstSegmentStartTimePeriod'));
    let amPmSwitchExists = await amPmSwitch.isExisting();
    if (amPmSwitchExists) {
        throw new Error(`❌ Expected 24-hour mode but tvFirstSegmentStartTimePeriod exists`);
    }
    logStepMessage(`✅ Correct 24H time mode detected in regimen overview`);

    await editRegimenBtn.click();
    await browser.pause(100);

    await getElementById('tvHeaderTitle', 'screens.REGIMEN_MENU.regimen_pin_title');

    await enterPinRegimen(pinCode);
    if (await isElementDisplayedById('tvPinError')) {
        const pinError = await browser.$(buildSelectorById('tvPinError'));
        const pinErrorStr = await pinError.getText();
        throw new Error(`❌ ${pinErrorStr} [screens.REGIMEN_MENU.regiment_wrong_pin]`);
    }
    await getElementById('tvHeaderTitle', 'screens.REGIMEN_OVERVIEW.title_single_regimen_edit');

    amPmSwitch = await browser.$(buildSelectorById('ivTimePeriodSwitch'));
    amPmSwitchExists = await amPmSwitch.isExisting();

    if (amPmSwitchExists) {
        throw new Error(`❌ Expected 24-hour mode but ivTimePeriodSwitch exists`);
    }
    logStepMessage(`✅ Correct 24H time mode detected in edit regimen`);
    logStepMessage("✅ Step 3");
}

async function step4() {
    logStepMessage("▶️ Step 4");
    const doneBtn = await getElementById('tvSecond', 'common.cmn_text_done');
    await doneBtn.click();

    await getElementById('tvHeaderTitle', 'screens.REGIMEN_OVERVIEW.title_single_regimen_overview');

    const activateRegimenBtn =  await getElementById('tvSecond', 'common.cmn_regimen_activate_changes');
    await activateRegimenBtn.click();
    await getElementByIdAndText('tvHeaderTitle', 'screens.FTU_SETUP_DONE.set_up_done_title');

    let getStarted = await waitForVisible(
        buildSelectorById('tvSecond'),
        'common.cmn_get_started',
        12000
    );
    await getStarted.click();

    await getElementById('tvCurrentPumpStatusTitle', 'screens.DISCLAIMER_SCREEN.text_mandatory_disclaimer');
    logStepMessage("✅ Disclaimer");
    getStarted = await waitForVisible(
        buildSelectorById('tvThird'),
        'common.cmn_get_started',
        10000
    );
    await getStarted.click();
    await browser.pause(1000);

    await waitForVisible(
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

    const systemClockTime = await getElementById('tvHeaderSystemClock');
    const systemClockTimeStr = await systemClockTime.getText();

    if (systemClockTimeStr.endsWith(" AM") || systemClockTimeStr.endsWith(" PM")) {
        throw new Error(`❌ System clock time is in AM/PM format: ${systemClockTimeStr}`);
    }
    logStepMessage(`✅ System clock time is in 24H format: ${systemClockTimeStr}`);
    logStepMessage("✅ Step 4");
}

async function step5() {
    logStepMessage("▶️ Step 5");
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

    const backBtn = await browser.$(buildSelectorById('ivHeaderBack'));
    await backBtn.click();
    logStepMessage("✅ Step 5");
}

async function step6(apiBaseUrl) {
    logStepMessage("▶️ Step 6");
    const prepareTreatment = await getElementById('tvSecond', 'common.cmn_text_start_treatment');
    await prepareTreatment.click();
    await browser.pause(500);

    await disconnectCartridgeFromPump(apiBaseUrl);

    await prepareTreatmentUntilDelivery(apiBaseUrl);
    logStepMessage("✅ Step 6");
}

async function step7(apiBaseUrl) {
    logStepMessage("▶️ Step 7");
    adbCouplePump();
    await browser.pause(5000);

    await waitForVisible(
        buildSelectorById('tvAlertTitle'),
        'alerts.LOW_TREATMENT_PAUSED.alert_title_low_treatment_paused',
        10000,
        300,
        true
    );
    logStepMessage("✅ Alert TREATMENT PAUSED shown [alerts.LOW_TREATMENT_PAUSED.alert_title_low_treatment_paused] upper case");

    let headerMenu = await getElementById('ivHeaderMenu');
    await headerMenu.click();

    const prepareTreatment = await getElementById('navToggleButton', 'common.cmn_text_start_treatment');
    await prepareTreatment.click();
    await browser.pause(500);

    await disconnectCartridgeFromPump(apiBaseUrl);

    await prepareTreatmentUntilDelivery(apiBaseUrl);

    headerMenu = await getElementById('ivHeaderMenu');
    await headerMenu.click();

    const reviewTreatmentHistory = await scrollToItem('screens.SETTINGS_CS_CONTROL.settings_cs_control_view_logs', true);
    await reviewTreatmentHistory.click();

    await scrollToItem('screens.T_H_SCREEN.text_treatment_started', true);
    const treatmentStarted = await getElementById('tvTreatmentStarted');
    const treatmentStartedStr = await treatmentStarted.getText();

    // de_DE "13:49, 26.02.26"
    // en_150 "13:49, 26/02/26"
    // en_US "1:49 PM, 2/26/26"
    if (isStrictValidDateTime(treatmentStartedStr, "treatmentStarted")) {
        logStepMessage(`✅ Treatment Started date "${treatmentStartedStr}" is in expected format`);
    } else {
        throw new Error(`❌ Treatment Started date "${treatmentStartedStr}" is NOT in expected format`);
    }
    logStepMessage("✅ Step 7");
}

async function step8(apiBaseUrl) {
    logStepMessage("▶️ Step 8");
    adbCouplePump();
    await browser.pause(5000);

    await waitForVisible(
        buildSelectorById('tvAlarmTitle'),
        'alerts.LOW_TREATMENT_PAUSED.alert_title_low_treatment_paused',
        10000,
        300
    );
    logStepMessage("✅ Alarm Treatment paused shown [alerts.LOW_TREATMENT_PAUSED.alert_title_low_treatment_paused]");

    const audioBtn = await waitForVisible(
        buildSelectorById('tvThird'),
        'common.text_turn_off_audio',
        10000
    );

    await audioBtn.click();
    await browser.pause(200);

    await clockSyncronization(apiBaseUrl, 1611761035);

    adbDecouplePump();
    await browser.pause(5000);

    adbCouplePump();
    await browser.pause(5000);

    const adbDateTime = adbGetDeviceDateTime();
    const formattedDateTime = formatDateTimeByLocale(adbDateTime, config.language);
    logStepMessage(`Formatted current device date time: ${formattedDateTime}`);
    //en_US 3/1/26 | 2:08 PM
    // en_150 01/03/26 | 14:08
    // de_DE 01.03.26 | 14:08

    await checkAlarm(
        'alerts.TIME_MISMATCH_ALERT.alert_title_time_mismatch',
        'alerts.TIME_MISMATCH_ALERT.alert_description_time_mismatch',
        {
            contentTemplateValues: [formattedDateTime],
            templateKey: 'alerts.STRINGS_FOR_ALERT_TYPES.alert_info_default_id_only',
            templateValues: ['28 '],
            timeToleranceMinutes: 1
        }
    );

    const confirmTimeBtn = await getElementById('tvThird', 'common.cmn_pump_time');
    await confirmTimeBtn.click();
    await browser.pause(500);
    logStepMessage("✅ Step 8");
}

async function step9(language) {
    logStepMessage("▶️ Step 9");
    const backBtn = await browser.$(buildSelectorById('ivHeaderBack'));
    await backBtn.click();

    const headerMenu = await getElementById('ivHeaderMenu');
    await headerMenu.click();

    const setLanguage = await scrollToItem('screens.MENU.menu_item_set_language', true);
    await setLanguage.click();
    try {
        const langLabel = config.languageLabels && config.languageLabels[language];
        if (langLabel) {
            const selector = buildSelectorByText(langLabel);
            const langEl = await browser.$(selector);
            if (await langEl.isDisplayed()) {
                await langEl.click();
                await browser.pause(500);
            }
        }
    } catch (err) {
        throw new Error(`❌ Failed to select language item for "${language}": ${err.message}`);
    }

    config.language = language;

    loadStrings();

    let nextBtn = await getElementById('tvSecond');
    await nextBtn.click();
    await browser.pause(100);

    const systemClockTime = await getElementById('tvHeaderSystemClock');
    const systemClockTimeStr = await systemClockTime.getText();

    if (systemClockTimeStr.endsWith(" AM") || systemClockTimeStr.endsWith(" PM")) {
        logStepMessage(`✅ System clock time is in AM/PM format: ${systemClockTimeStr}`);
    }
    else {
        throw new Error(`❌ System clock time is in 24H format: ${systemClockTimeStr}`);
    }
    logStepMessage("✅ Step 9");
}

async function step10() {
    logStepMessage("▶️ Step 10");
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

    const backBtn = await browser.$(buildSelectorById('ivHeaderBack'));
    await backBtn.click();
    logStepMessage("✅ Step 10");
}

async function step11() {
    logStepMessage("▶️ Step 11");
    const headerMenu = await getElementById('ivHeaderMenu');
    await headerMenu.click();

    const reviewTreatmentHistory = await scrollToItem('screens.SETTINGS_CS_CONTROL.settings_cs_control_view_logs', true);
    await reviewTreatmentHistory.click();

    await scrollToItem('screens.T_H_SCREEN.text_treatment_started', true);
    const treatmentStarted = await getElementById('tvTreatmentStarted');
    const treatmentStartedStr = await treatmentStarted.getText();

    if (isStrictValidDateTime(treatmentStartedStr, "treatmentStarted")) {
        logStepMessage(`✅ Treatment Started date "${treatmentStartedStr}" is in expected format`);
    } else {
        throw new Error(`❌ Treatment Started date "${treatmentStartedStr}" is NOT in expected format`);
    }
    logStepMessage("✅ Step 11");
}

async function step12() {
    logStepMessage("▶️ Step 12");
    const backBtn = await browser.$(buildSelectorById('ivHeaderBack'));
    await backBtn.click();

    const headerMenu = await getElementById('ivHeaderMenu');
    await headerMenu.click();

    const dosingRegimenSettings = await scrollToItem('screens.MENU.menu_item_regimen_settings', true);
    await dosingRegimenSettings.click();

    await waitForVisible(
        buildSelectorById('tvHeaderTitle'),
        'screens.REGIMEN_OVERVIEW.title_single_regimen_overview',
        10000
    );

    const amPmSwitch = await browser.$(buildSelectorById('tvFirstSegmentStartTimePeriod'));
    const amPmSwitchExists = await amPmSwitch.isExisting();
    if (amPmSwitchExists) {
        logStepMessage(`✅ Correct AM/PM time mode detected in regimen overview`);
    } else {
        throw new Error(`❌ Expected AM/PM mode but tvFirstSegmentStartTimePeriod doesn't exist`);
    }
    logStepMessage("✅ Step 12");
}

async function step13(pinCode, actualStartDay, actualStartNight) {
    logStepMessage("▶️ Step 13");
    const editRegimenBtn =  await getElementById('tvSecond', 'common.cmn_regimen_edit_changes');
    await editRegimenBtn.click();

    await getElementById('tvHeaderTitle', 'screens.REGIMEN_MENU.regimen_pin_title');
    await enterPinCode(pinCode);
    if (await isElementDisplayedById('tvPinError')) {
        const pinError = await browser.$(buildSelectorById('tvPinError'));
        const pinErrorStr = await pinError.getText();
        throw new Error(`❌ ${pinErrorStr} [screens.REGIMEN_MENU.regiment_wrong_pin]`);
    }
    await getElementById('tvHeaderTitle', 'screens.REGIMEN_OVERVIEW.title_single_regimen_edit');

    const amPmSwitch = await browser.$(buildSelectorById('ivTimePeriodSwitch'));
    const amPmSwitchExists = await amPmSwitch.isExisting();

    if (amPmSwitchExists) {
        logStepMessage(`✅ Correct AM/PM time mode detected in edit regimen`);
    } else {
        throw new Error(`❌ Expected AM/PM mode but ivTimePeriodSwitch doesn't exist`);
    }
    let nightRateStart = await getElementById('tvNightPart');
    const nightRateStartStr = await nightRateStart.getText();
    await amPmSwitch.click();
    await browser.pause(100);

    nightRateStart = await getElementById('tvNightPart');
    let newNightRateStartStr = await nightRateStart.getText();

    if ((nightRateStartStr.endsWith(" AM") && newNightRateStartStr.endsWith(" PM")) || (nightRateStartStr.endsWith(" PM") && newNightRateStartStr.endsWith(" AM"))) {
        logStepMessage(`✅ Night rate start time switched from AM(PM) to PM(AM): "${nightRateStartStr}" -> "${newNightRateStartStr}"`);
    } else {
        throw new Error(`❌ Night rate start time did not switch from AM(PM) to PM(AM): "${nightRateStartStr}" -> "${newNightRateStartStr}"`);
    }

    await amPmSwitch.click();
    await browser.pause(100);
    nightRateStart = await getElementById('tvNightPart');
    newNightRateStartStr = await nightRateStart.getText();

    if (nightRateStartStr === newNightRateStartStr){
        logStepMessage(`✅ Night rate start time switched back to PM(AM): "${nightRateStartStr}" -> "${newNightRateStartStr}"`);
    } else {
        throw new Error(`❌ Night rate start time did not switch back to PM(AM): "${nightRateStartStr}" -> "${newNightRateStartStr}"`);
    }

    await validateDayStartHourFullCycle(actualStartDay, actualStartNight);

    const backBtn = await browser.$(buildSelectorById('ivHeaderBack'));
    const goBackBtn = await browser.$(buildSelectorByText(getCachedString('common.cmn_go_back')));

    await backBtn.click();
    await browser.pause(100);
    await goBackBtn.click();
    await browser.pause(100);
    await backBtn.click();
    await browser.pause(100);
    await goBackBtn.click();
    logStepMessage("✅ Step 13");
}

async function step14(apiBaseUrl) {
    logStepMessage("▶️ Step 14");
    await clockSyncronization(apiBaseUrl, 1611761035);

    adbDecouplePump();
    await browser.pause(5000);

    adbCouplePump();
    await browser.pause(5000);

    const adbDateTime = adbGetDeviceDateTime();
    const formattedDateTime = formatDateTimeByLocale(adbDateTime, config.language);
    logStepMessage(`Formatted current device date time: ${formattedDateTime}`);

    await checkAlarm(
        'alerts.TIME_MISMATCH_ALERT.alert_title_time_mismatch',
        'alerts.TIME_MISMATCH_ALERT.alert_description_time_mismatch',
        {
            contentTemplateValues: [formattedDateTime],
            templateKey: 'alerts.STRINGS_FOR_ALERT_TYPES.alert_info_default_id_only',
            templateValues: ['28 '],
            timeToleranceMinutes: 1
        }
    );

    const confirmTimeBtn = await getElementById('tvThird', 'common.cmn_pump_time');
    await confirmTimeBtn.click();
    await browser.pause(500);

    logStepMessage("✅ Step 14");
}