// helpers
import { adbCouplePump, adbDecouplePump } from '../helpers/adbHelpers.js';
import { clearPumpLogs, connectCartridgeToPump, connectTwico, disconnectCartridgeFromPump, disconnectTwico, updateParameterValue, verifyLogsContain } from '../helpers/apiHelpers.js';
import { activateRegimenAndStart, pairPump, prepareTreatmentUntilDelivery, resetToFTU } from '../helpers/preConditionsHelpers.js';
import { buildSelectorById, checkAlarm, checkAlert, getElementById, waitForVisible, waitWithHeartbeat } from '../helpers/uiHelpers.js';

import { loadStrings } from '../helpers/i18n.js';
import { logStep, logStepMessage } from '../helpers/logger.js';

// config
import config from '../helpers/config.js';
import { flowState, saveState } from '../helpers/flowState.js';

import allureReporter from '@wdio/allure-reporter';

/*
Precondition:
Pump and CS after FTU, paired and connected

Pump is coupled

Cartridge is connected to the pump

CS shows HS “Medication is empty”
*/
const testKey = "TM-309";
let preconditionsPassed = false;

describe(`${testKey} - Exit from Treatment preparation flow`, () => {
    const { apiBaseUrl, globalParams } = config;
    const { pumpName, portName } = { ...globalParams };

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

        await logStep('Step 1 - Start treatment preparation until "Insert new vials", back to "Connect the cartridge"', async () => {
            await step1(apiBaseUrl);
        });

        await logStep('Step 2 - "Go back" to HS with medication empty', async () => {
            await step2(apiBaseUrl);
        });

        await logStep('Step 3 - Start treatment preparation until "Connect a new cartridge", decouple the pump, "Back" and "Go back" ', async () => {
            await step3(apiBaseUrl);
        });

        await logStep('Step 4 - Start treatment preparation until delivery, couple the pump, start treatment preparation until "Connect a new cartridge", decouple the pump, "Back", "Go back" and resume delivery', async () => {
            await step4(apiBaseUrl);
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
    const prepareTreatment = await getElementById('tvSecond', 'common.cmn_text_start_treatment');
    await prepareTreatment.click();
    await browser.pause(500);

    await disconnectCartridgeFromPump(apiBaseUrl);

    const fillDetailNextBtn = await getElementById('tvFillDetailNext', 'common.cmn_text_next');
    await fillDetailNextBtn.click();
    await browser.pause(500);

    let nextBtn = await getElementById('tvSecond', 'common.cmn_text_next');
    await connectCartridgeToPump(apiBaseUrl);

    await browser.waitUntil(async () => await nextBtn.isEnabled(), {
        timeout: 10000,
        timeoutMsg: "❌ NEXT did not enable"
    });

    await nextBtn.click();
    await browser.pause(1000);

    await getElementById('tvHeaderTitle', 'screens.CONNECT_VIAL.connect_vial_screen_title');

    let backBtn = await getElementById('ivHeaderBack');
    await backBtn.click();
    await browser.pause(200);

    await clearPumpLogs(apiBaseUrl);

    await disconnectCartridgeFromPump(apiBaseUrl); 
    await browser.pause(5000);

    nextBtn = await getElementById('tvSecond', 'common.cmn_text_next');
    if ((await nextBtn.isEnabled())) {
        throw new Error("❌ NEXT enabled");
    }
    logStepMessage("✅ NEXT disabled");

    backBtn = await getElementById('ivHeaderBack');
    await backBtn.click();
    await browser.pause(200);

    await waitForVisible(
        buildSelectorById('tvAlarmTitle'),
        'dialogs.FILL_FLOW_GO_BACK.dialog_on_back_title',
        10000,
        300
    );

    logStepMessage("✅ Alarm sure to exit daily preparation shown [dialogs.FILL_FLOW_GO_BACK.dialog_on_back_title]");

    await checkAlarm(
        'dialogs.FILL_FLOW_GO_BACK.dialog_on_back_title',
        'dialogs.FILL_FLOW_GO_BACK.dialog_on_back_message',
        { expectedStr: 'ID 1028 ' }
    );
    logStepMessage("✅ Step 1");
}

async function step2(apiBaseUrl) {
    logStepMessage("▶️ Step 2");
    const goBackBtn = await getElementById('tvThird', 'common.cmn_go_back');
    await goBackBtn.click();
    await browser.pause(2000);

    await getElementById('tvHeaderTitle', 'screens.HOME.home_title');

    await checkAlert(
        'alerts.EMPTY_DRUG.alert_title_empty_drug',
        'alerts.EMPTY_DRUG.alert_description_empty_drug',
        { expectedStr: 'ID 3 ' }
    );

    await getElementById('tvSecond', 'common.cmn_text_start_treatment');
    await getElementById('tvThird', 'screens.HOME.home_screen_action_pump_status');

    // // Alarms ON: ID3 and ID6
    // // Alarms: 2 2 1 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2
    await verifyLogsContain(apiBaseUrl, `Alarms: 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2||[Alarm] Priority ID: 3\`||[BLE] Received Pump Command: 14\``, 3000, "error");
    logStepMessage("✅ Step 2");
}

async function step3(apiBaseUrl) {
    logStepMessage("▶️ Step 3");
    const prepareTreatment = await getElementById('tvSecond', 'common.cmn_text_start_treatment');
    await prepareTreatment.click();
    await browser.pause(500);

    const fillDetailNextBtn = await getElementById('tvFillDetailNext', 'common.cmn_text_next');
    await fillDetailNextBtn.click();
    await browser.pause(500);

    await getElementById('tvHeaderTitle', 'screens.CONNECT_A_NEW_CARTRIDGE.connect_new_cartridge_title');

    adbDecouplePump();

    const backBtn = await getElementById('ivHeaderBack');
    await backBtn.click();
    await browser.pause(200);

    const goBackBtn = await getElementById('tvThird', 'common.cmn_go_back');
    await goBackBtn.click();
    await browser.pause(2000);

    await getElementById('tvHeaderTitle', 'screens.HOME.home_title');

    await checkAlert(
        'alerts.EMPTY_DRUG.alert_title_empty_drug',
        'alerts.EMPTY_DRUG.alert_description_empty_drug',
        { expectedStr: 'ID 3 ' }
    );

    await verifyLogsContain(apiBaseUrl, `[BLE] Pump disconnected from CS\`||[BLE] Disconnected||[BLE] Advertising||BLE state:3Advrtsing`, 3000, "error");
    logStepMessage("✅ Step 3");
}

async function step4(apiBaseUrl) {
    logStepMessage("▶️ Step 4");
    let prepareTreatment = await getElementById('tvSecond', 'common.cmn_text_start_treatment');
    await prepareTreatment.click();
    await browser.pause(500);

    adbCouplePump();
    await browser.pause(2000);

    await prepareTreatmentUntilDelivery(apiBaseUrl);

    await waitWithHeartbeat(30000);

    await verifyLogsContain(apiBaseUrl, `[BLE] Disconnected||[BLE] Advertising||BLE state:3Advrtsing`, 3000, "error"); 

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

    await checkAlert(
        'alerts.LOW_TREATMENT_PAUSED.alert_title_low_treatment_paused',
        'alerts.LOW_TREATMENT_PAUSED.alert_description_treatment_paused',
        {
            localizedTemplateKey: 'alerts.STRINGS_FOR_ALERT_TYPES.alert_info_default_id_only',
            requiredId: '21'
        }
    );

    const headerMenu = await getElementById('ivHeaderMenu');
    await headerMenu.click();

    prepareTreatment = await getElementById('navToggleButton', 'common.cmn_text_start_treatment');
    await prepareTreatment.click();
    await browser.pause(1000);

    await disconnectCartridgeFromPump(apiBaseUrl);

    await prepareTreatmentUntilDelivery(apiBaseUrl);

    await verifyLogsContain(apiBaseUrl, `[BLE] Disconnected||[BLE] Advertising||BLE state:3Advrtsing`, 3000, "error"); 
    logStepMessage("✅ Step 4");
}

