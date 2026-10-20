// helpers
import { clearPumpLogs, connectTwico, disconnectCartridgeFromPump, disconnectTwico, pressPumpButton, updateParameterValue, verifyLogsContain, vibratorOnOff } from '../helpers/apiHelpers.js';
import { activateRegimenAndStart, pairPump, prepareTreatmentUntilFillingMedication, prepareTreatmentUntilPrepareInfusionSites, resetToFTU } from '../helpers/preConditionsHelpers.js';
import { buildSelectorById, getCachedString, getElementById, isElementDisplayedById, pumpBatteryChargingOrConnectTubes, waitForVisible, waitWithHeartbeat } from '../helpers/uiHelpers.js';

import { loadStrings } from '../helpers/i18n.js';
import { logStep, logStepMessage } from '../helpers/logger.js';

// config
import config from '../helpers/config.js';
import { flowState, saveState } from '../helpers/flowState.js';

import allureReporter from '@wdio/allure-reporter';
import { adbCouplePump, adbDecouplePump, adbUpdateConfigFilesAndMainSn } from '../helpers/adbHelpers.js';

/*
Precondition:
Fill medication ended successfully.

“Remove vial adapters" is displayed

Pump is in BLE range
*/
const testKey = "TM-528";
let preconditionsPassed = false;

describe(`${testKey} - "Pump battery charging" screen after reaching 100%`, () => {
    const { apiBaseUrl, globalParams } = config;
    const { pumpName, portName } = { ...globalParams };
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

            await logStep('Reset to FTU', async () => {
                await resetToFTU(apiBaseUrl);
            });

            await logStep('Vibrator On/Off for 30 mn to lower pump battery voltage', async () => {
                adbDecouplePump();
                await vibratorOnOff(apiBaseUrl, 1);
                await waitWithHeartbeat(1800000);
                await vibratorOnOff(apiBaseUrl, 0);
            });

            await logStep('Pair pump', async () => {
                await pairPump(pumpName);
            });

            await logStep('Activate regimen and start (until medication empty)', async () => {
                await activateRegimenAndStart();
            });

            await logStep('Update pump parameters to reduce filling time', async () => {
                await updateParameterValue(apiBaseUrl, "VIAL_DETECT_MIN_CURRENT_DIFF_FOR_SUCCESS_DEFAULT", 8, 0);

                await updateParameterValue(apiBaseUrl, "VIAL_DETECT_MIN_CURRENT_SAMPLES_PER_MOTOR_BURST_DEFAULT", 9, 100);

                await updateParameterValue(apiBaseUrl, "ENCODER_FILLING_HARD_STOP_VALUE", 14, 55000);

                await updateParameterValue(apiBaseUrl, "FILING_MIN_ENCODER_FOR_REMOVE_AIR_STAGE", 53, 10000);

                await updateParameterValue(apiBaseUrl, "FILLING_STEP_2_MIN_DRUG_VOLUME_ENC", 4, 0);
            });

            await logStep('Prepare Treatment until Filling Medication', async () => {
                const prepareTreatment = await getElementById('tvSecond', 'common.cmn_text_start_treatment');
                await prepareTreatment.click();
                await browser.pause(500);

                await disconnectCartridgeFromPump(apiBaseUrl);

                await prepareTreatmentUntilFillingMedication(apiBaseUrl);
            });

            await logStep('Clear pump logs', async () => {
                await clearPumpLogs(apiBaseUrl);
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

        await logStep('Step 1 - On "Removal vial adapters" screen press on "Next" button', async () => {
            await step1(apiBaseUrl);
        });

        await logStep('Step 2 - Click on "Prime tubing"', async () => {
            await step2();
        });

        await logStep('Step 3 - While CS shows "Prepare infusion sites" screen, Decouple the pump, press on "start delivery" button (on pump) and ckeck pump logs', async () => {
            await step3(apiBaseUrl);
        });

        await logStep('Step 4 - Press on "Ok" button to close the notification, Press "Next" button on "Prepare infusion sites" screen', async () => {
            await step4();
        });

        await logStep('Step 5 - Press "Next" button on "Insert Cannulas" screen', async () => {
            await step5();
        });

        await logStep('Step 6 - Press Next', async () => {
            await step6();
        });

        await logStep('Step 7 - Insert pump to the cradle to stop the delivery, Pump battery level is less than 100%, At CS go to menu and choose "PREPARE TRATMENT", Complete Filling and priming, While CS shows "Insert cannulas" screen, Decouple the pump, press on "start delivery" button (on pump) and check pump logs', async () => {
            await step7(apiBaseUrl);
        });

        await logStep('Step 8 - Press on "Ok" button to close the notification, Press "Next" button on "Insert cannulas" screen', async () => {
            await step8();
        });

        await logStep('Step 9 - Press Next', async () => {
            await step9();
        });

        await logStep('Step 10 - Pump battery level is 80% or less, Insert pump to the cradle and start new treatment preparation flow, Complete Filling and priming, CS shows "Pump battery charging" screen, Decouple the pump and press pump button to start delivery', async () => {
            await step10(apiBaseUrl); 
        });

        await logStep('Step 11 - Press on "Ok" button to close the notification', async () => {
            await step11();
        });

        await logStep('Step 12 - Press on "Next" button', async () => {
            await step12();
        });

        await logStep('Step 13 - Insert pump to the cradle and start new treatment preparation, Complete filling and priming, CS shows "Connect tubes to cannulas" screen, Decouple the pump and start delivery', async () => {
            await step13(apiBaseUrl);
        });

        await logStep('Step 14 - Press on "Ok" button to close the notification, Press on "Next" button on "Connect tubes to cannulas" screen', async () => {
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

async function step1(apiBaseUrl) {
    logStepMessage("▶️ Step 1");
    const nextBtn = await getElementById('tvSecond', 'common.cmn_text_next');
    await nextBtn.click();
    await browser.pause(500);

    await getElementById('tvHeaderTitle', 'screens.CONNECT_TUBING_SCREEN.connect_tubing_title');

    const message = await getElementById('tvMessageContainerInfo');
    const actualMessageStr = await message.getText();
    const expectedMessageStr = getCachedString('screens.CONNECT_TUBING_SCREEN.connect_tubing_info_first') + "\n\n" + getCachedString('screens.CONNECT_TUBING_SCREEN.connect_tubing_info_second') + "\n\n" + getCachedString('screens.CONNECT_TUBING_SCREEN.connect_tubing_info_third');
    if (actualMessageStr !== expectedMessageStr) {
        throw new Error(`❌ Element text mismatch: expected "${expectedMessageStr}", got "${actualMessageStr}" ['screens.CONNECT_TUBING_SCREEN.connect_tubing_info_first' 'screens.CONNECT_TUBING_SCREEN.connect_tubing_info_second' 'screens.CONNECT_TUBING_SCREEN.connect_tubing_info_third']`);
    }
    logStepMessage(`✅ Element "tvMessageContainerInfo" text as expected: "${expectedMessageStr}" ['screens.CONNECT_TUBING_SCREEN.connect_tubing_info_first' 'screens.CONNECT_TUBING_SCREEN.connect_tubing_info_second' 'screens.CONNECT_TUBING_SCREEN.connect_tubing_info_third']`);

    await getElementById('tvSecond', 'screens.CONNECT_TUBING_SCREEN.connect_tubing_prime_button');
    logStepMessage("✅ Step 1");
}

async function step2() {
    logStepMessage("▶️ Step 2");
    const primeTubbingBtn = await getElementById('tvSecond', 'screens.CONNECT_TUBING_SCREEN.connect_tubing_prime_button');
    await primeTubbingBtn.click();
    await browser.pause(1000);

    await getElementById('tvHeaderTitle', 'screens.PREPARE_INFUSION_SITES.screen_prepare_infusion_sites_title');
    await getElementById('tvFirstStep', 'screens.PREPARE_INFUSION_SITES.screen_prepare_infusion_sites_message_first');
    await getElementById('tvSecondStep', 'screens.PREPARE_INFUSION_SITES.screen_prepare_infusion_sites_message_second');
    await getElementById('tvThirdStep', 'screens.PREPARE_INFUSION_SITES.screen_prepare_infusion_sites_message_third');

    const identifyInfusionSitesBtn = await getElementById('tvFillDetailShowMe', 'screens.PREPARE_INFUSION_SITES.screen_prepare_infusion_sites_button');
    if (!(await identifyInfusionSitesBtn.isEnabled())) {
        throw new Error("❌ Identify infusion sites disabled");
    }
    logStepMessage("✅ Identify infusion sites enabled");

    const nextBtn = await getElementById('tvFillDetailNext', 'common.cmn_text_next');
    if (!(await nextBtn.isEnabled())) {
        throw new Error("❌ NEXT disabled");
    }
    logStepMessage("✅ NEXT enabled");

    if (await isElementDisplayedById('ivHeaderBack')) {
        throw new Error("❌ Back button displayed");
    }
    logStepMessage("✅ Back button NOT displayed");
    logStepMessage("✅ Step 2");
}

async function step3(apiBaseUrl) {
    logStepMessage("▶️ Step 3");
    await clearPumpLogs(apiBaseUrl);
    await browser.pause(1000);

    adbDecouplePump();
    await browser.pause(7000);

    await pressPumpButton(apiBaseUrl);

    await getElementById('tvTitle', 'dialogs.DELIVERY_STARTED.dialog_delivery_started_title');

    await getElementById('tvThird', 'common.cmn_text_ok');

    await verifyLogsContain(apiBaseUrl, `[PB] Start delivery||BLE state:3Advrtsing`, 3000, "error");
    logStepMessage("✅ Step 3");
}

async function step4() {
    logStepMessage("▶️ Step 4");
    const okBtn = await getElementById('tvThird', 'common.cmn_text_ok');
    await okBtn.click();
    await browser.pause(100);

    await getElementById('tvHeaderTitle', 'screens.PREPARE_INFUSION_SITES.screen_prepare_infusion_sites_title');

    let nextBtn = await getElementById('tvFillDetailNext', 'common.cmn_text_next');
    await nextBtn.click();
    await browser.pause(100);

    await getElementById('tvHeaderTitle', 'screens.INSERT_CANNULA.insert_cannula_screen_title');
    await getElementById('tvFirstStep', 'screens.INSERT_CANNULA.insert_cannula_screen_info_first');
    await getElementById('tvSecondStep', 'screens.INSERT_CANNULA.insert_cannula_screen_info_second');
    await getElementById('tvThirdStep', 'screens.INSERT_CANNULA.insert_cannula_screen_info_third');

    nextBtn = await getElementById('tvFillDetailNext', 'common.cmn_text_next');
    if (!(await nextBtn.isEnabled())) {
        throw new Error("❌ NEXT disabled");
    }
    logStepMessage("✅ NEXT enabled");

    logStepMessage("✅ Step 4");
}

async function step5() {
    logStepMessage("▶️ Step 5");
    const nextBtn = await getElementById('tvFillDetailNext', 'common.cmn_text_next');
    await nextBtn.click();
    await browser.pause(1000);

    await pumpBatteryChargingOrConnectTubes();
    logStepMessage("✅ Step 5");
}

async function step6() {
    logStepMessage("▶️ Step 6");
    const nextBtn = await getElementById('tvFillDetailNext', 'common.cmn_text_next');
    await nextBtn.click();
    await browser.pause(100);

    //  text="The Pump is delivering &#10;medication." resource-id="com.neuroderm.station:id/tvStartedDeliveringTitle"
    await getElementById('tvStartedDeliveringTitle', 'screens.HOME.home_screen_action_pump_delivering_started');

    // logStepMessage(await browser.getPageSource());

    await getElementById('tvHeaderTitle', 'screens.HOME.home_title');

    await getElementById('tvCurrentPumpStatusTitle', 'screens.HOME.home_screen_medication_delivery_on');
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

    const headerMenu = await getElementById('ivHeaderMenu');
    await headerMenu.click();

    const prepareTreatment = await getElementById('navToggleButton', 'common.cmn_text_start_treatment');
    await prepareTreatment.click();
    await browser.pause(500);

    await disconnectCartridgeFromPump(apiBaseUrl);

    await prepareTreatmentUntilPrepareInfusionSites(apiBaseUrl);
    await browser.pause(20000);

    adbDecouplePump();
    await browser.pause(7000);

    await pressPumpButton(apiBaseUrl);

    await getElementById('tvTitle', 'dialogs.DELIVERY_STARTED.dialog_delivery_started_title');

    await getElementById('tvThird', 'common.cmn_text_ok');

    await verifyLogsContain(apiBaseUrl, `[PB] Start delivery||BLE state:3Advrtsing`, 3000, "error");
    logStepMessage("✅ Step 7");
}

async function step8() {
    logStepMessage("▶️ Step 8");
    const okBtn = await getElementById('tvThird', 'common.cmn_text_ok');
    await okBtn.click();
    await browser.pause(100);

    await getElementById('tvHeaderTitle', 'screens.INSERT_CANNULA.insert_cannula_screen_title');

    const nextBtn = await getElementById('tvFillDetailNext', 'common.cmn_text_next');
    await nextBtn.click();
    await browser.pause(1000);

    await pumpBatteryChargingOrConnectTubes();
    logStepMessage("✅ Step 8");
}

async function step9() {
    logStepMessage("▶️ Step 9");

    const nextBtn = await getElementById('tvFillDetailNext', 'common.cmn_text_next');
    await nextBtn.click();
    await browser.pause(100);

    await getElementById('tvStartedDeliveringTitle', 'screens.HOME.home_screen_action_pump_delivering_started');

    await getElementById('tvHeaderTitle', 'screens.HOME.home_title');

    await getElementById('tvCurrentPumpStatusTitle', 'screens.HOME.home_screen_medication_delivery_on');
    logStepMessage("✅ Step 9");
}

async function step10(apiBaseUrl) {
    logStepMessage("▶️ Step 10");
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

    const headerMenu = await getElementById('ivHeaderMenu');
    await headerMenu.click();

    const prepareTreatment = await getElementById('navToggleButton', 'common.cmn_text_start_treatment');
    await prepareTreatment.click();
    await browser.pause(500);

    await disconnectCartridgeFromPump(apiBaseUrl);

    await prepareTreatmentUntilPrepareInfusionSites(apiBaseUrl);

    await getElementById('tvHeaderTitle', 'screens.INSERT_CANNULA.insert_cannula_screen_title');

    const nextBtn = await getElementById('tvFillDetailNext', 'common.cmn_text_next');
    await nextBtn.click();
    await browser.pause(1000);

    const headerTitle = await getElementById('tvHeaderTitle');
    const headerTitleText = await headerTitle.getText();
    const pumpBatteryChargingTitleText = getCachedString('screens.CHARGING.charging_screen_title');
    const connectTubesTitleText = getCachedString('screens.CONNECT_TUBES.connect_tubes_screen_title');
    if (headerTitleText == pumpBatteryChargingTitleText) {
        logStepMessage(`▶️ ${pumpBatteryChargingTitleText} screen displayed`);
        await getElementById('tvMessageContainerInfo', 'screens.CHARGING.charging_screen_info');
    }
    else if (headerTitleText == connectTubesTitleText) {
        logStepMessage(`✅ ${connectTubesTitleText} screen displayed`);
    }
    else {
        throw new Error(`❌ ${headerTitleText} screen displayed`);
    }

    await browser.pause(20000);

    adbDecouplePump();
    await browser.pause(7000);

    await pressPumpButton(apiBaseUrl);

    await getElementById('tvTitle', 'dialogs.DELIVERY_STARTED.dialog_delivery_started_title');

    await getElementById('tvThird', 'common.cmn_text_ok');

    await verifyLogsContain(apiBaseUrl, `[PB] Start delivery||BLE state:3Advrtsing`, 5000, "error");
    logStepMessage("✅ Step 10");
}

async function step11() {
    logStepMessage("▶️ Step 11");
    const okBtn = await getElementById('tvThird', 'common.cmn_text_ok');
    await okBtn.click();
    await browser.pause(100);

    await getElementById('tvHeaderTitle', 'screens.CONNECT_TUBES.connect_tubes_screen_title');

    const nextBtn = await getElementById('tvFillDetailNext', 'common.cmn_text_next');
    if (!(await nextBtn.isEnabled())) {
        throw new Error("❌ NEXT disabled");
    }
    logStepMessage("✅ Step 11");
}

async function step12() {
    logStepMessage("▶️ Step 12");
    const nextBtn = await getElementById('tvFillDetailNext', 'common.cmn_text_next');
    await nextBtn.click();
    await browser.pause(1000);

    await getElementById('tvHeaderTitle', 'screens.HOME.home_title');

    await getElementById('tvCurrentPumpStatusTitle', 'screens.HOME.home_screen_medication_delivery_on');
    logStepMessage("✅ Step 12");
}

async function step13(apiBaseUrl) {
    logStepMessage("▶️ Step 13");
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

    const headerMenu = await getElementById('ivHeaderMenu');
    await headerMenu.click();

    const prepareTreatment = await getElementById('navToggleButton', 'common.cmn_text_start_treatment');
    await prepareTreatment.click();
    await browser.pause(500);

    await disconnectCartridgeFromPump(apiBaseUrl);

    await prepareTreatmentUntilPrepareInfusionSites(apiBaseUrl);

    await getElementById('tvHeaderTitle', 'screens.INSERT_CANNULA.insert_cannula_screen_title');

    const nextBtn = await getElementById('tvFillDetailNext', 'common.cmn_text_next');
    await nextBtn.click();
    await browser.pause(1000);

    await pumpBatteryChargingOrConnectTubes();

    await browser.pause(20000);

    adbDecouplePump();
    await browser.pause(7000);

    await pressPumpButton(apiBaseUrl);

    await getElementById('tvTitle', 'dialogs.DELIVERY_STARTED.dialog_delivery_started_title');

    await getElementById('tvThird', 'common.cmn_text_ok');

    await verifyLogsContain(apiBaseUrl, `[PB] Start delivery||BLE state:3Advrtsing`, 3000, "error");
    logStepMessage("✅ Step 13");
}

async function step14(apiBaseUrl) {
    logStepMessage("▶️ Step 14");
    const okBtn = await getElementById('tvThird', 'common.cmn_text_ok');
    await okBtn.click();
    await browser.pause(100);

    await getElementById('tvHeaderTitle', 'screens.CONNECT_TUBES.connect_tubes_screen_title');

    const nextBtn = await getElementById('tvFillDetailNext', 'common.cmn_text_next');
    await nextBtn.click();
    await browser.pause(1000);

    await getElementById('tvHeaderTitle', 'screens.HOME.home_title');

    await getElementById('tvCurrentPumpStatusTitle', 'screens.HOME.home_screen_medication_delivery_on');

    await verifyLogsContain(apiBaseUrl, `BLE state:4Disconnected`, 3000, "error");
    logStepMessage("✅ Step 14");
}