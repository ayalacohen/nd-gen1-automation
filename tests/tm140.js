// helpers
import { adbCouplePump, adbDecouplePump } from '../helpers/adbHelpers.js';
import { clearPumpLogs, connectCartridgeToPump, connectTwico, disconnectCartridgeFromPump, disconnectTwico, pressPumpButton, updateParameterValue, verifyLogsContain } from '../helpers/apiHelpers.js';
import { activateRegimenAndStart, pairPump, resetToFTU } from '../helpers/preConditionsHelpers.js';
import { buildSelectorById, checkAlarm, getElementById, waitForDisappear, waitForVisible, waitWithHeartbeat } from '../helpers/uiHelpers.js';

import { loadStrings } from '../helpers/i18n.js';
import { logStep, logStepMessage } from '../helpers/logger.js';

// config
import config from '../helpers/config.js';
import { flowState, saveState } from '../helpers/flowState.js';

import allureReporter from '@wdio/allure-reporter';

/*
Precondition:
Pump parameter DELAY_PRIOR_FILLING = 0 

CS and pump after FTU

CS on ‘Fill medication’ screen

In the TwikoGUI in tab SCD alarms, set the PERIOD_ALARMS_HIGH_ACK to 40 sec
*/

/*
GATT: Acknowledgement status = 1 (true)  / 0 (false)
Check [GAT] updt: 19 : 00 00 00 00 00 00 00 00 00 00 00 00 06 / 00 00 00 00 00 01 00 00 00 00 00 00 06 in pump logs
Acknowledge status in 6th byte: 00 / 01 for Alarm code in 13th byte : 06 / 08
*/
const testKey = "TM-140";
let preconditionsPassed = false;

describe(`${testKey} - Cartridge disconnection alarm while filling`, () => {
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

            await logStep('Set DELAY_PRIOR_FILLING_TH_SEC_DEFAULT to 0', async () => {
                await updateParameterValue(apiBaseUrl, "DELAY_PRIOR_FILLING_TH_SEC_DEFAULT", 79, 0);
            });

            await logStep('Start prepare treatment until filling', async () => {
                await startPrepareTreatment(apiBaseUrl);
            });

            await logStep('Set PERIOD_ALARMS_HIGH_ACK to 40', async () => {
                await updateParameterValue(apiBaseUrl, "PERIOD_ALARMS_HIGH_ACK", 17, 40);
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

        await logStep(`Step 1 - Click 'Start filling', Within filling is executed, disconnect the DP`, async () => {
            await step1(apiBaseUrl);
        });

        await logStep('Step 2 - Uncouple the pump', async () => {
            await step2(apiBaseUrl);
        });

        await logStep('Step 3 - Couple the pump', async () => {
            await step3(apiBaseUrl);
        });

        await logStep('Step 4 - Wait for the acknowledgment period(40 sec)', async () => {
            await step4(apiBaseUrl);
        });

        await logStep('Step 5 - Uncouple the pump, Press the pump push button to acknowledge the alarm', async () => {
            await step5(apiBaseUrl);
        });

        await logStep('Step 6 - Connect the DP', async () => {
            await step6(apiBaseUrl);
        });

        await logStep('Step 7 - Couple the pump to CS', async () => {
            await step7(apiBaseUrl);
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
    const startFillingBtn = await getElementById('tvSecond', 'common.cmn_start_filling');

    await startFillingBtn.click();
    await browser.pause(1000);

    await getElementById('tvHeaderTitle', 'screens.FILLING_MEDICATION.filling_medication_ftu');

    await waitWithHeartbeat(20000);

    await disconnectCartridgeFromPump(apiBaseUrl);

    await waitForVisible(
        buildSelectorById('tvAlarmTitle'),
        'alerts.DP_DISCONNECTED.alert_title_pump_disconnected',
        10000,
        300
    );

    logStepMessage("✅ Alarm CARTRIDGE DISCONNECTED shown [alerts.DP_DISCONNECTED.alert_title_pump_disconnected]");

    await checkAlarm(
        'alerts.DP_DISCONNECTED.alert_title_pump_disconnected',
        'alerts.DP_DISCONNECTED.alert_description_pump_disconnected',
        {
            localizedTemplateKey: 'alerts.STRINGS_FOR_ALERT_TYPES.alert_info_default',
            requiredId: '6'
        }
    );

    // Alarms ON: ID6
    // Alarms: 2 2 2 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2

    // Acknowledge status 0
    // [GAT] updt: 19 : 00 00 00 00 00 00 00 00 00 00 00 00 06
    await verifyLogsContain(apiBaseUrl, `Start Motor\`||Stop Motor||Alarms: 2 2 2 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2||[GAT] updt: 19 : 00 00 00 00 00 00 00 00 00 00 00 00 06||[Alarm] Priority ID: 6\`||[Alarm] DP disconnected alarm (high)||Current state is: Filling`, 3000, "error");

    // motor stopped
    await verifyLogsContain(apiBaseUrl, `Current state is: Filling`, 10000, "error", false, `Start Motor\`||Stop Motor`);
    logStepMessage("✅ Step 1");
}

async function step2(apiBaseUrl) {
    logStepMessage("▶️ Step 2");
    adbDecouplePump();
    await browser.pause(10000);

    await checkAlarm(
        'alerts.DP_DISCONNECTED.alert_title_pump_disconnected',
        'alerts.DP_DISCONNECTED.alert_description_pump_disconnected',
        {
            localizedTemplateKey: 'alerts.STRINGS_FOR_ALERT_TYPES.alert_info_default',
            requiredId: '6'
        }
    );

    // Alarms ON: ID6 and ID8
    // Alarms: 2 2 2 2 2 1 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2
    // [Alarm] Fill process interrupted`

    // Acknowledge status 0
    // [GAT] updt: 19 : 00 00 00 00 00 00 00 00 00 00 00 00 06

    await verifyLogsContain(apiBaseUrl, `Alarms: 2 2 2 2 2 1 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2||[GAT] updt: 19 : 00 00 00 00 00 00 00 00 00 00 00 00 06||[Alarm] Fill process interrupted\`||Current state is: Filling`, 5000, "error");

    await browser.pause(10000);

    await getElementById('tvAlarmTitle', 'alerts.DP_DISCONNECTED.alert_title_pump_disconnected');

    logStepMessage("✅ Alarm CARTRIDGE DISCONNECTED shown [alerts.DP_DISCONNECTED.alert_title_pump_disconnected]");
    logStepMessage("✅ Step 2");
}

async function step3(apiBaseUrl) {
    logStepMessage("▶️ Step 3");
    adbCouplePump();
    await browser.pause(10000);

    await checkAlarm(
        'alerts.DP_DISCONNECTED.alert_title_pump_disconnected',
        'alerts.DP_DISCONNECTED.alert_description_pump_disconnected',
        {
            localizedTemplateKey: 'alerts.STRINGS_FOR_ALERT_TYPES.alert_info_default',
            requiredId: '6'
        }
    );

    // Alarms ON: ID6 (ID8 OFF)
    // Alarms: 2 2 2 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2
    // [Alarm] Alarm cleared: 8`

    // Acknowledge status 1
    // [GAT] updt: 19 : 00 00 00 00 00 01 00 00 00 00 00 00 06 
    await verifyLogsContain(apiBaseUrl, `[Alarm] Alarm cleared: 8\`||Alarms: 2 2 2 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2||[GAT] updt: 19 : 00 00 00 00 00 01 00 00 00 00 00 00 06||Current state is: Filling`, 3000, "error");
    logStepMessage("✅ Step 3");
}

async function step4(apiBaseUrl) {
    logStepMessage("▶️ Step 4");
    await browser.pause(40000);

    await getElementById('tvAlarmTitle', 'alerts.DP_DISCONNECTED.alert_title_pump_disconnected');

    logStepMessage("✅ Alarm CARTRIDGE DISCONNECTED shown [alerts.DP_DISCONNECTED.alert_title_pump_disconnected]");

    // Alarms ON: ID6
    // Alarms: 2 2 2 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2

    // Acknowledge status from 1 to 0
    // [GAT] updt: 19 : 00 00 00 00 00 01 00 00 00 00 00 00 06
    // [GAT] updt: 19 : 00 00 00 00 00 00 00 00 00 00 00 00 06

    await verifyLogsContain(apiBaseUrl, `Alarms: 2 2 2 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2||[GAT] updt: 19 : 00 00 00 00 00 01 00 00 00 00 00 00 06||[GAT] updt: 19 : 00 00 00 00 00 00 00 00 00 00 00 00 06||Current state is: Filling`, 0, "error", true);
    logStepMessage("✅ Step 4");
}

async function step5(apiBaseUrl) {
    logStepMessage("▶️ Step 5");
    adbDecouplePump();
    await browser.pause(10000);

    await pressPumpButton(apiBaseUrl);
    await browser.pause(10000);

    await getElementById('tvAlarmTitle', 'alerts.DP_DISCONNECTED.alert_title_pump_disconnected');

    logStepMessage("✅ Alarm CARTRIDGE DISCONNECTED shown [alerts.DP_DISCONNECTED.alert_title_pump_disconnected]");

    // Alarms ON: ID6 and ID8
    // Alarms: 2 2 2 2 2 1 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2

    // Acknowledge status 1
    // [GAT] updt: 19 : 00 00 00 00 00 01 00 00 00 00 00 00 06

    await verifyLogsContain(apiBaseUrl, `Alarms: 2 2 2 2 2 1 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2||[GAT] updt: 19 : 00 00 00 00 00 01 00 00 00 00 00 00 06||Current state is: Filling`, 0, "error");
    logStepMessage("✅ Step 5");
}

async function step6(apiBaseUrl) {
    logStepMessage("▶️ Step 6");
    await connectCartridgeToPump(apiBaseUrl);

    await waitForVisible(
        buildSelectorById('tvAlarmTitle'),
        'alerts.FILL_PROCESS_INTERRUPTED.alert_title_fill_process_interrupted',
        10000,
        300
    );

    logStepMessage("✅ Alarm Process interrupted shown [alerts.FILL_PROCESS_INTERRUPTED.alert_title_fill_process_interrupted]");

    await checkAlarm(
        'alerts.FILL_PROCESS_INTERRUPTED.alert_title_fill_process_interrupted',
        'alerts.FILL_PROCESS_INTERRUPTED.alert_description_fill_process_interrupted',
        { expectedStr: 'ID 31 ' }
    );


    // Alarms ON: ID8 (ID6 OFF)
    // Alarms: 2 2 2 2 2 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2
    // [Alarm] Alarm cleared: 6`
    // [Alarm] Priority ID: 8`

    // Acknowledge status 0
    // [GAT] updt: 19 : 00 00 00 00 00 00 00 00 00 00 00 00 08

    await verifyLogsContain(apiBaseUrl, `[Alarm] Alarm cleared: 6\`||Alarms: 2 2 2 2 2 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2||[GAT] updt: 19 : 00 00 00 00 00 00 00 00 00 00 00 00 08||[Alarm] Priority ID: 8\``, 3000, "error");
    logStepMessage("✅ Step 6");
}

async function step7(apiBaseUrl) {
    logStepMessage("▶️ Step 7");
    adbCouplePump();
    await browser.pause(5000);

    await getElementById('tvHeaderTitle', 'screens.FILLING_MEDICATION.filling_medication_ftu');

    await getElementById('progressFilingMedicine');

    await waitForDisappear(buildSelectorById('progressFilingMedicine'), 150000);

    await getElementById('tvHeaderTitle', 'screens.REMOVE_VIAL_ADAPTERS.remove_vial_adapters_title');
    logStepMessage("✅ Step 7");
}

async function startPrepareTreatment(apiBaseUrl) {
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

    nextBtn = await getElementById('tvSecond', 'common.cmn_text_next');
    await nextBtn.click();
    await browser.pause(1000);

    await getElementById('tvHeaderTitle', 'screens.PREPARE_FOR_FILLING.prepare_for_filling_screen');

    const startFillingBtn = await getElementById('tvSecond', 'common.cmn_start_filling');
    await browser.waitUntil(async () => await startFillingBtn.isEnabled(), {
        timeout: 5000,
        timeoutMsg: "❌ START FILLING did not enable"
    });
}