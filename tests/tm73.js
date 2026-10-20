// helpers
import { clearPumpLogs, connectTwico, disconnectTwico, verifyLogsContain } from '../helpers/apiHelpers.js';
import { pairPump, resetToFTU } from '../helpers/preConditionsHelpers.js';
import { buildSelectorById, buildSelectorByText, checkAlarm, checkAlert, enterPinCode, getCachedString, getElementById, getElementByIdAndText, getSegmentsValues, isElementDisplayedById, updateValueWithPlusMinusClicks, waitForDisappear, waitForPumpDetected, waitForVisible, waitForVisibleWithRetry } from '../helpers/uiHelpers.js';

import { loadStrings } from '../helpers/i18n.js';
import { logStep, logStepMessage } from '../helpers/logger.js';

// config
import config from '../helpers/config.js';
import { assertComparison, convertHoursToSeconds, parseHour } from '../helpers/generalHelpers.js';
import { flowState, saveState } from '../helpers/flowState.js';

import allureReporter from '@wdio/allure-reporter';
import { adbCouplePump, adbDecouplePump, adbUpdateConfigFilesAndMainSn } from '../helpers/adbHelpers.js';

/*
Precondition:
Set via Neuroderm_UI tool: hcpUser = ON

CS and pump on FTU
*/
const testKey = "TM-73";
let preconditionsPassed = false;

describe(`${testKey} - FTU flow with interruptions`, () => {
    const { apiBaseUrl, globalParams } = config;
    const { pumpName, portName, defaultRegimenPinCode } = { ...globalParams };

    const apkLocalConfigFile = "adb-config-files/HCP_cs_config.json";
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

        await logStep('Step 1 - Set up date and time', async () => {
            await step1();
        });

        await logStep('Step 2 - When “Pair pump” is orange highlighted, uncouple the pump, Click Next', async () => {
            await step2();
        });

        await logStep('Step 3 - Click "OK"', async () => {
            await step3();
        });

        await logStep('Step 4 - Couple the pump', async () => {
            await step4();
        });

        await logStep('Step 5 - On "Select your pump" screen, click back', async () => {
            await step5();
        });

        await logStep('Step 6 - Click "Next" to pair the pump, Quickly uncouple the pump', async () => {
            await step6();
        });

        await logStep('Step 7 - Click "OK", Couple the pump', async () => {
            await step7();
        });

        await logStep('Step 8 - Select your pump and complete paring', async () => {
            await step8(pumpName);
        });

        await logStep('Step 9 - Tap on "Next button", On "Dosing regimen overview" screen decouple the pump', async () => {
            await step9();
        });

        await logStep('Step 10 - Couple the pump and tap on "OK" button, Click "Activate regimen" to set the default regimen', async () => {
            await step10(apiBaseUrl, expectedValues);
        });

        await logStep('Step 11 - Press on "Get started" button on "Set up completed" screen', async () => {
            await step11();
        });

        await logStep('Step 12 - Press on "Get Started" button on "Disclaimer" screen', async () => {
            await step12();
        });

        await logStep('Step 13 - Start the FTU flow again, Pair the pump, On "Dosing regimen overview" screen, edit the regimen', async () => {
            await step13(apiBaseUrl, pumpName, defaultRegimenPinCode,  expectedValues, updatedValues);
        });

        await logStep('Step 14 - Click "Activate regimen", then rapidly decouple the pump', async () => {
            await step14();
        });

        await logStep('Step 15 - Press on "Get started" button on "Set up completed" screen, Press on "Get Started" button on "Disclaimer" screen and check Pump logs', async () => {
            await step15(apiBaseUrl, updatedValues);
        });

        await logStep('Couple the pump to pause audio', async () => {
            adbCouplePump();
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
    try {
        const langLabel = config.languageLabels && config.languageLabels[config.language];
        if (langLabel) {
            const selector = buildSelectorByText(langLabel);
            const langEl = await browser.$(selector);
            if (await langEl.isDisplayed()) {
                await langEl.click();
                await browser.pause(500);
            }
        }
    } catch (err) {
        // if language selection fails, continue the flow silently
    }

    const nextBtn = await getElementById('tvSecond');

    for (let i = 0; i < 4; i++) {
        await nextBtn.click();
        await browser.pause(1000);
    }
    logStepMessage("✅ Step 1");
}

async function step2() {
    logStepMessage("▶️ Step 2");
    await getElementByIdAndText('tvStartupItemTitle', 'screens.FTU_STARTUP.pair_pump_ftu');

    const nextBtn = await getElementById('tvSecond');

    adbDecouplePump();
    await browser.pause(100);

    await nextBtn.click();
    await browser.pause(1000);

    await checkAlarm(
        'dialogs.UNEXPECTED_DECOUPLE_FTU.alert_type_pump_decoupled_general_title_ftu',
        'dialogs.UNEXPECTED_DECOUPLE_FTU.alert_type_pump_decoupled_general_info_ftu',
        { expectedStr: 'ID 1023 ' }
    );

    await getElementById('tvThird', 'common.cmn_text_ok');

    logStepMessage("✅ Step 2");
}

async function step3() {
    logStepMessage("▶️ Step 3");
    const okBtn = await getElementById('tvThird', 'common.cmn_text_ok');
    await okBtn.click();

    await waitForDisappear(buildSelectorByText(getCachedString('dialogs.UNEXPECTED_DECOUPLE_FTU.alert_type_pump_decoupled_general_info_ftu')));

    await getElementById('tvHeaderTitle', 'common.cmn_insert_pump');
    await getElementById('tvMessageContainerInfo', 'common.cmn_insert_pump_more_info');
    logStepMessage("✅ Step 3");
}

async function step4() {
    logStepMessage("▶️ Step 4");
    adbCouplePump();
    await waitForPumpDetected();
    await browser.pause(3000);

    const headerTitle = await getElementById('tvHeaderTitle');
    const headerTitleTxt = await headerTitle.getText();
    const selectPumpTxt1 = getCachedString('screens.FTU_PUMP_LIST.ftu_pump_list_title');
    const selectPumpTxt2 = getCachedString('screens.FTU_PUMP_LIST.ftu_pump_list_title_search');

    if (headerTitleTxt == selectPumpTxt1) {
        logStepMessage(`✅ Element "tvHeaderTitle" text as expected: "${selectPumpTxt1}" [screens.FTU_PUMP_LIST.ftu_pump_list_title]`);
    }
    else if (headerTitleTxt == selectPumpTxt2){
        logStepMessage(`✅ Element "tvHeaderTitle" text as expected: "${selectPumpTxt2}" [screens.FTU_PUMP_LIST.ftu_pump_list_title_search]`);
    }
    else {
        throw new Error(`❌ Element text mismatch: expected "${selectPumpTxt1}" or "${selectPumpTxt2}", got "${headerTitleTxt}" `);
    }
    logStepMessage("✅ Step 4");
}

async function step5() {
    logStepMessage("▶️ Step 5");
    const backBtn = await getElementById('ivHeaderBack');
    await backBtn.click();
    await browser.pause(100);

    await getElementById('tvHeaderTitle', 'screens.FTU_STARTUP.title_start_up_ftu');

    await getElementByIdAndText('tvStartupItemTitle', 'screens.FTU_STARTUP.pair_pump_ftu');
    logStepMessage("✅ Step 5");
}

async function step6() {
    logStepMessage("▶️ Step 6");
    const nextBtn = await getElementById('tvSecond');
    await nextBtn.click();
    await browser.pause(100);

    adbDecouplePump();
    await browser.pause(100);

    await checkAlarm(
        'dialogs.UNEXPECTED_DECOUPLE_FTU.alert_type_pump_decoupled_general_title_ftu',
        'dialogs.UNEXPECTED_DECOUPLE_FTU.alert_type_pump_decoupled_general_info_ftu',
        { expectedStr: 'ID 1023 ' }
    );

    await getElementById('tvThird', 'common.cmn_text_ok');
    logStepMessage("✅ Step 6");
}

async function step7() {
    logStepMessage("▶️ Step 7");
    const okBtn = await getElementById('tvThird', 'common.cmn_text_ok');
    await okBtn.click();

    adbCouplePump();
    await waitForPumpDetected();
    await browser.pause(3000);

    const headerTitle = await getElementById('tvHeaderTitle');
    const headerTitleTxt = await headerTitle.getText();
    const selectPumpTxt1 = getCachedString('screens.FTU_PUMP_LIST.ftu_pump_list_title');
    const selectPumpTxt2 = getCachedString('screens.FTU_PUMP_LIST.ftu_pump_list_title_search');

    if (headerTitleTxt == selectPumpTxt1) {
        logStepMessage(`✅ Element "tvHeaderTitle" text as expected: "${selectPumpTxt1}" [screens.FTU_PUMP_LIST.ftu_pump_list_title]`);
    }
    else if (headerTitleTxt == selectPumpTxt2){
        logStepMessage(`✅ Element "tvHeaderTitle" text as expected: "${selectPumpTxt2}" [screens.FTU_PUMP_LIST.ftu_pump_list_title_search]`);
    }
    else {
        throw new Error(`❌ Element text mismatch: expected "${selectPumpTxt1}" or "${selectPumpTxt2}", got "${headerTitleTxt}" `);
    }
    logStepMessage("✅ Step 7");
}

async function step8(pumpName) {
    logStepMessage("▶️ Step 8");
    let nextBtn = await getElementById('tvSecond');

    await nextBtn.click();
    await browser.pause(10000);

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

    await getElementById('tvHeaderTitle', 'screens.FTU_STARTUP.title_start_up_ftu');
    await getElementByIdAndText('tvStartupItemTitle', 'screens.FTU_STARTUP.pair_pump_ftu_prepared');
    await getElementByIdAndText('tvStartupItemTitle', 'screens.FTU_STARTUP.set_regimens_title');
    logStepMessage("✅ Step 8");
}

async function step9() {
    logStepMessage("▶️ Step 9");
    const nextBtn = await getElementById('tvSecond', 'common.cmn_text_next');
    await nextBtn.click();
    await browser.pause(100);

    await waitForVisible(
        buildSelectorById('tvHeaderTitle'),
        'screens.REGIMEN_OVERVIEW.title_single_regimen_overview',
        15000
    );

    adbDecouplePump();

    await checkAlarm(
        'dialogs.UNEXPECTED_DECOUPLE_FTU.alert_type_pump_decoupled_general_title_ftu',
        'dialogs.UNEXPECTED_DECOUPLE_FTU.alert_type_pump_decoupled_general_info_ftu',
        { expectedStr: 'ID 1023 ' }
    );

    await getElementById('tvThird', 'common.cmn_text_ok');

    logStepMessage("✅ Step 9");
}

async function step10(apiBaseUrl, expectedValues) {
    logStepMessage("▶️ Step 10");
    adbCouplePump();
    await browser.pause(1000);

    const okBtn = await getElementById('tvThird', 'common.cmn_text_ok');
    await okBtn.click();

    const activateRegimenBtn = await waitForVisible(
        buildSelectorById('tvSecond'),
        'common.cmn_regimen_activate_changes',
        15000
    );

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

    const startDayInSeconds = convertHoursToSeconds(parseHour(expectedValues.day.start));
    const startNightInSeconds = convertHoursToSeconds(parseHour(expectedValues.night.start));

    const seg0 = `[REGM] SEG 0 Val: ${expectedValues.day.doseRate} Time: ${startDayInSeconds}\``;
    const seg1 = `[REGM] SEG 1 Val: ${expectedValues.night.doseRate} Time: ${startNightInSeconds}\``;

    const segment1 = `[REGIMENS] Segment 1 (start,flow): ${startDayInSeconds},${expectedValues.day.doseRate}\``;
    const segment2 = `[REGIMENS] Segment 2 (start,flow): ${startNightInSeconds},${expectedValues.night.doseRate}\``;

    await verifyLogsContain(apiBaseUrl, `${seg0}||${seg1}||[REGIMENS] Info tst: 0\`||[REGIMENS] Rec. CRC Tst: 1\`||[REGIMENS] Regimen Data: 0\`||${segment1}||${segment2}||[REGIMENS] Saved CRC Test Event: 1\`||[REGIMENS] # Regim: 1\`||[REGIMENS] Actv Indx: 0\``, 3000, "error");
    logStepMessage("✅ Step 10");
}

async function step11() {
    logStepMessage("▶️ Step 11");
    const getStarted = await getElementById('tvSecond','common.cmn_get_started');
    await getStarted.click();
    await browser.pause(100);

    await getElementById('tvCurrentPumpStatusTitle', 'screens.DISCLAIMER_SCREEN.text_mandatory_disclaimer');

    await waitForVisible(
        buildSelectorById('tvThird'),
        'common.cmn_get_started',
        10000
    );
    logStepMessage("✅ Step 11");
}

async function step12() {
    logStepMessage("▶️ Step 12");
    const getStarted = await getElementById('tvThird','common.cmn_get_started');
    await getStarted.click();
    await browser.pause(100);

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
    logStepMessage("✅ Step 12");
}

async function step13(apiBaseUrl, pumpName, pinCode, expectedValues, updatedValues) {
    logStepMessage("▶️ Step 13");
    await resetToFTU(apiBaseUrl);

    await pairPump(pumpName);

    const nextBtn = await getElementById('tvSecond');
    await nextBtn.click();
    await browser.pause(100);

    await waitForVisible(
        buildSelectorById('tvHeaderTitle'),
        'screens.REGIMEN_OVERVIEW.title_single_regimen_overview',
        15000
    );

    const editRegimenBtn =  await getElementById('tvEditSegments', 'common.cmn_regimen_edit_changes');
    await editRegimenBtn.click();

    await getElementById('tvHeaderTitle', 'screens.REGIMEN_MENU.regimen_pin_title');
    await getElementById('tvEditRegimenPasswordNote', 'screens.REGIMEN_MENU.regiment_note');
    await enterPinCode(pinCode);
    if (await isElementDisplayedById('tvPinError')) {
        const pinError = await browser.$(buildSelectorById('tvPinError'));
        const pinErrorStr = await pinError.getText();
        throw new Error(`❌ ${pinErrorStr} [screens.REGIMEN_MENU.regiment_wrong_pin]`);
    }
    await getElementById('tvHeaderTitle', 'screens.REGIMEN_OVERVIEW.title_single_regimen_edit');

    await updateValueWithPlusMinusClicks({
        mode: 'hour',
        actualValue: expectedValues.day.start,
        newValue: updatedValues.day.start
    });

    await updateValueWithPlusMinusClicks({
        mode: 'dose',
        actualValue: expectedValues.totalDose,
        newValue: updatedValues.totalDose
    });

    const doneBtn = await getElementById('tvSecond', 'common.cmn_text_done');
    await doneBtn.click();

    await getElementById('tvHeaderTitle', 'screens.REGIMEN_OVERVIEW.title_single_regimen_overview');

    const segmentsValues = await getSegmentsValues();
    const newSegments = segmentsValues.segmentsValues;

    assertComparison(updatedValues, newSegments, true, "Regimen"); 
    logStepMessage("✅ Segments saved as expected");
    logStepMessage("✅ Step 13");
}

async function step14() {
    logStepMessage("▶️ Step 14");
    const activateRegimenBtn =  await getElementById('tvSecond', 'common.cmn_regimen_activate_changes');
    await activateRegimenBtn.click();
    await browser.pause(100);

    adbDecouplePump();

    await waitForVisible(
        buildSelectorById('tvHeaderTitle'),
        'screens.FTU_SYNC_DATA.ftu_sync_data_title'
    );

    await waitForVisible(
        buildSelectorById('tvHeaderTitle'),
        'screens.FTU_SETUP_DONE.set_up_done_title'
    );

    await getElementById('tvSecond', 'common.cmn_get_started');
    logStepMessage("✅ Step 14");
}

async function step15(apiBaseUrl, updatedValues) {
    logStepMessage("▶️ Step 15");

    let getStarted = await getElementById('tvSecond', 'common.cmn_get_started');
    await getStarted.click();

    await getElementById('tvCurrentPumpStatusTitle', 'screens.DISCLAIMER_SCREEN.text_mandatory_disclaimer');

    getStarted = await getElementById('tvThird', 'common.cmn_get_started');
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

    const startDayInSeconds = convertHoursToSeconds(parseHour(updatedValues.day.start));
    const startNightInSeconds = convertHoursToSeconds(parseHour(updatedValues.night.start));

    const segment1 = `[REGIMENS] Segment 1 (start,flow): ${startDayInSeconds},${updatedValues.day.doseRate}\``;
    const segment2 = `[REGIMENS] Segment 2 (start,flow): ${startNightInSeconds},${updatedValues.night.doseRate}\``;
    await verifyLogsContain(apiBaseUrl, `${segment1}||${segment2}`, 0, "error");
    logStepMessage("✅ Step 15");
}
