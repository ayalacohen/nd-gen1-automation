// helpers
import { clearPumpLogs, connectTwico, disconnectTwico } from '../helpers/apiHelpers.js';
import { pairPump, resetToFTU } from '../helpers/preConditionsHelpers.js';
import { buildSelectorById, buildSelectorByText, checkAlarm, checkAlert, enterPinCode, getCachedString, getElementById, getElementByIdAndText, getSegmentsValues, isElementDisplayedById, openDosingRegimenSettings, updateValueWithPlusMinusClicks, validateDayDoseFullCycle, validateDayStartHourFullCycle, waitForDisappear, waitForPumpDetected, waitForVisible } from '../helpers/uiHelpers.js';

import { loadStrings } from '../helpers/i18n.js';
import { logStep, logStepMessage } from '../helpers/logger.js';

// config
import config from '../helpers/config.js';
import { flowState, saveState } from '../helpers/flowState.js';
import { assertComparison } from '../helpers/generalHelpers.js';

import allureReporter from '@wdio/allure-reporter';
import { adbCouplePump, adbDecouplePump, adbUpdateConfigFilesAndMainSn } from '../helpers/adbHelpers.js';

/*
Precondition:
Using CS configuration tool NDUI to change: “FW Configuration File”-> user_default_key= 1, “APK Configuration File”-> HcpUser = False,

Pump in FTU

Pairing process completed successfully.

Pump is coupled to CS

“Startup” screen is displayed with “Set up dosing regimen” highlighted in orange.
*/
const testKey = "TM-272";
let preconditionsPassed = false;

describe(`${testKey} - FTU- Set dosing regimen`, () => {
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

            await logStep('Pair pump', async () => {
                await pairPump(pumpName);
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

        await logStep('Step 1 - Click "Next" to enter "Dosing regimen overview" section', async () => {
            await step1(expectedValues);
        });

        await logStep('Step 2 - Press on the "EDIT REGIMEN".', async () => {
            await step2();
        });

        await logStep(`Step 3 - Type an default correct PIN code: ${defaultRegimenPinCode}`, async () => {
            await step3(defaultRegimenPinCode);
        });

        await logStep('Step 4 - Adjust Day rate start time by pressing the + and – buttons', async () => {
            await step4(expectedValues.day.start, expectedValues.night.start);
        });

        await logStep('Step 5 - Press Total daily dose(mg) and adjust the dose by pressing the + and – buttons', async () => {
            await step5(expectedValues.totalDose);
        });

        await logStep('Step 6 - Select total daily dose 370 and press on back button', async () => {
            await step6(expectedValues.totalDose, "370");
        });

        await logStep('Step 7 - Press on Cancel', async () => {
            await step7();
        });

        await logStep('Step 8 - Press on Back and press on "Go back" button', async () => {
            await step8(expectedValues);
        });

        await logStep('Step 9 - Take the pump out of the cradle', async () => {
            await step9();
        });

        await logStep('Step 10 - Tap on OK', async () => {
            await step10();
        });

        await logStep('Step 11 - Insert the pump back into the cradle', async () => {
            await step11(expectedValues);
        });

        await logStep('Step 12 - Press on "Edit regimen" button and complete edit regimen flow, set up Total daily dose "370" mg and press on "Activate regimen" button', async () => {
            await step12(defaultRegimenPinCode, expectedValues.totalDose, "370");
        });

        await logStep('Step 13 - Press on "GET STARTED"', async () => {
            await step13();
        });

        await logStep('Step 14 - Press on "Get started" button', async () => {
            await step14();
        });

        await logStep('Step 15 - Open Main menu → Select "Dosing regimen settings"', async () => {
            await step15("370");
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
async function step1(expectedValues) {
    logStepMessage("▶️ Step 1");

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

    assertComparison(expectedValues, segmentsValues, true, "Regimen");
    logStepMessage("✅ Default segments as expected");
    logStepMessage("✅ Step 1");
}

async function step2() {
    logStepMessage("▶️ Step 2");
    const editRegimenBtn =  await getElementById('tvEditSegments', 'common.cmn_regimen_edit_changes');
    await editRegimenBtn.click();

    await getElementById('tvHeaderTitle', 'screens.REGIMEN_MENU.regimen_pin_title');
    await getElementById('tvEditRegimenPasswordNote', 'screens.REGIMEN_MENU.regiment_note');
    logStepMessage("✅ Step 2");
}

async function step3(pinCode) {
    logStepMessage("▶️ Step 3");
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
    logStepMessage("✅ Step 3");
}

async function step4(actualStartDay, actualStartNight) {
    logStepMessage("▶️ Step 4");
    await validateDayStartHourFullCycle(actualStartDay, actualStartNight);
    logStepMessage("✅ Step 4");
}

async function step5(actualTotalDose) {
    logStepMessage("▶️ Step 5");
    await validateDayDoseFullCycle(actualTotalDose);
    logStepMessage("✅ Step 5");
}

async function step6(actualTotalDose, newTotalDose) {
    logStepMessage("▶️ Step 6");
    await updateValueWithPlusMinusClicks({
        mode: 'dose',
        actualValue: actualTotalDose,
        newValue: newTotalDose
    });

    const backBtn = await getElementById('ivHeaderBack');
    await backBtn.click();

    await checkAlarm(
        'dialogs.REGIMEN_UNSAVED_CHANGES.regime_segment_not_saved_message',
        'dialogs.REGIMEN_UNSAVED_CHANGES.regime_segment_not_saved_title',
        { expectedStr: 'ID 1000 ' }
    );

    await getElementById('tvFirst', 'common.cmn_go_back');
    await getElementById('tvThird', 'common.cmn_text_cancel');
    logStepMessage("✅ Step 6");
}

async function step7() {
    logStepMessage("▶️ Step 7");
    const cancelBtn = await getElementById('tvThird', 'common.cmn_text_cancel');
    await cancelBtn.click();

    await waitForDisappear(buildSelectorByText(getCachedString('dialogs.REGIMEN_UNSAVED_CHANGES.regime_segment_not_saved_message')));
    logStepMessage("✅ Notification disappeared");

    await getElementById('tvHeaderTitle', 'screens.REGIMEN_OVERVIEW.title_single_regimen_edit');
    logStepMessage("✅ Step 7");
}

async function step8(expectedValues) {
    logStepMessage("▶️ Step 8");
    const backBtn = await getElementById('ivHeaderBack');
    await backBtn.click();

    const goBackBtn = await getElementById('tvFirst', 'common.cmn_go_back');
    await goBackBtn.click();

    await waitForVisible(
        buildSelectorById('tvHeaderTitle'),
        'screens.REGIMEN_OVERVIEW.title_single_regimen_overview',
        5000
    );

    const segmentsValues = await getSegmentsValues();

    assertComparison(expectedValues, segmentsValues.segmentsValues, true, "Regimen"); // should be unchanged as expected
    logStepMessage("✅ Segments unchanged as expected");
    logStepMessage("✅ Step 8");
}

async function step9() {
    logStepMessage("▶️ Step 9");
    adbDecouplePump();
    await browser.pause(2000);

    await checkAlarm(
        'dialogs.UNEXPECTED_DECOUPLE_FTU.alert_type_pump_decoupled_general_title_ftu',
        'dialogs.UNEXPECTED_DECOUPLE_FTU.alert_type_pump_decoupled_general_info_ftu',
        { expectedStr: 'ID 1023 ' }
    );

    logStepMessage("✅ Step 9");
}

async function step10() {
    logStepMessage("▶️ Step 10");
    const okBtn = await getElementById('tvThird', 'common.cmn_text_ok');
    await okBtn.click();

    await waitForDisappear(buildSelectorByText(getCachedString('dialogs.UNEXPECTED_DECOUPLE_FTU.alert_type_pump_decoupled_general_info_ftu')));

    await getElementById('tvHeaderTitle', 'common.cmn_insert_pump');
    await getElementById('tvMessageContainerInfo', 'common.cmn_insert_pump_more_info');
    logStepMessage("✅ Step 10");
}

async function step11(expectedValues) {
    logStepMessage("▶️ Step 11");
    adbCouplePump();
    await browser.pause(2000);

    await waitForPumpDetected();
    await browser.pause(100);

    await waitForVisible(
        buildSelectorById('tvHeaderTitle'),
        'screens.ESTABLISHING_THE_CONNECTION.screen_establishing_the_connection_title'
    );

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
    assertComparison(expectedValues, segmentsValues, true, "Regimen");
    logStepMessage("✅ Segments unchanged as expected");
    logStepMessage("✅ Step 11");
}

async function step12(pinCode, actualTotalDose, newTotalDose) {
    logStepMessage("▶️ Step 12");
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
        mode: 'dose',
        actualValue: actualTotalDose,
        newValue: newTotalDose
    });
    const doneBtn = await getElementById('tvSecond', 'common.cmn_text_done');
    await doneBtn.click();

    await getElementById('tvHeaderTitle', 'screens.REGIMEN_OVERVIEW.title_single_regimen_overview');

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
    logStepMessage("✅ Step 12");
}

async function step13() {
    logStepMessage("▶️ Step 13");
    const getStarted = await getElementById('tvSecond', 'common.cmn_get_started');
    await getStarted.click();

    await getElementById('tvCurrentPumpStatusTitle', 'screens.DISCLAIMER_SCREEN.text_mandatory_disclaimer');
    logStepMessage("✅ Disclaimer");

    await getElementById('tvThird', 'common.cmn_get_started');
    logStepMessage("✅ Step 13");
}

async function step14() {
    logStepMessage("▶️ Step 14");
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
    logStepMessage("✅ Step 14");
}

async function step15(newTotalDose) {
    logStepMessage("▶️ Step 15");
    let segmentsValues;
    ({ segmentsValues } = await openDosingRegimenSettings());
    const newSegments = segmentsValues;

    if (newSegments.totalDose !== newTotalDose) {
        throw new Error(`❌ Total dose mismatch: expected=${newTotalDose}, got=${newSegments.totalDose}`);
    }
    logStepMessage(`✅ Total dose is ${newTotalDose} as expected in Dosing regimen settings`);
    logStepMessage("✅ Step 15");
}