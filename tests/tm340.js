// helpers
import { clearPumpLogs, connectCartridgeToPump, connectTwico, disconnectCartridgeFromPump, disconnectTwico, updateParameterValue, verifyLogsContain } from '../helpers/apiHelpers.js';
import { activateRegimenAndStart, pairPump, prepareTreatmentUntilFillingMedication, resetToFTU } from '../helpers/preConditionsHelpers.js';
import { buildSelectorById, buildSelectorByText, checkAlarm, getCachedString, getElementById, waitForDisappear, waitForVisible } from '../helpers/uiHelpers.js';

import { loadStrings } from '../helpers/i18n.js';
import { logStep, logStepMessage } from '../helpers/logger.js';

// config
import config from '../helpers/config.js';
import { flowState, saveState } from '../helpers/flowState.js';

import allureReporter from '@wdio/allure-reporter';
import { adbCouplePump, adbDecouplePump } from '../helpers/adbHelpers.js';

/*
Precondition:
Pump and CS are paired, connected

Pump is coupled to CS

Pump finished only filling flow
*/
const testKey = "TM-340";
let preconditionsPassed = false;

describe(`${testKey} - Priming execution while Disconnected cartridge`, () => {
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

                await updateParameterValue(apiBaseUrl, "ENCODER_FILLING_HARD_STOP_VALUE", 14, 110000);          // 55000 * 2

                await updateParameterValue(apiBaseUrl, "FILING_MIN_ENCODER_FOR_REMOVE_AIR_STAGE", 53, 20000);   // 10000 * 2

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

        await logStep('Step 1 - Disconnect the cartridge and quickly press the "Prime tubing" button on CS (Before "Cartridge disconnected alarm" is raised)', async () => {
            await step1(apiBaseUrl);
        });

        await logStep('Step 2 - Connect the cartridge', async () => {
            await step2(apiBaseUrl);
        });

        await logStep('Step 3 - Within priming is executed, disconnect the cartridge', async () => {
            await step3(apiBaseUrl);
        });

        await logStep('Step 4 - Verify that after priming is completed, the CS shows notification "Cartridge disconnected" (ID6), Uncouple the pump', async () => {
            await step4(apiBaseUrl);
        });

        await logStep('Connect the cartridge and couple the pump', async () => {
            await connectCartridgeToPump(apiBaseUrl);
            await browser.pause(5000);
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
async function step1(apiBaseUrl) {
    logStepMessage("▶️ Step 1");
    const nextBtn = await getElementById('tvSecond', 'common.cmn_text_next');
    await nextBtn.click();
    await browser.pause(500);

    await getElementById('tvHeaderTitle', 'screens.CONNECT_TUBING_SCREEN.connect_tubing_title');

    await disconnectCartridgeFromPump(apiBaseUrl);

    const primeTubbingBtn = await getElementById('tvSecond', 'screens.CONNECT_TUBING_SCREEN.connect_tubing_prime_button');
    await primeTubbingBtn.click();

    await getElementById('tvHeaderTitle', 'screens.PREPARE_INFUSION_SITES.screen_prepare_infusion_sites_title');

    await waitForVisible(
        buildSelectorById('tvAlarmTitle'),
        'alerts.DP_DISCONNECTED.alert_title_pump_disconnected',
        10000,
        300
    );

    logStepMessage("✅ Alarm Cartridge disconnected shown [alerts.DP_DISCONNECTED.alert_title_pump_disconnected]");

    await checkAlarm(
        'alerts.DP_DISCONNECTED.alert_title_pump_disconnected',
        'alerts.DP_DISCONNECTED.alert_description_pump_disconnected',
        { expectedStr: 'ID 6 ' }
    );

    // Current state is: Filling(Priming)
    // Alarms ON: ID6
    // Alarms: 2 2 2 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2
    // [Alarm] Priority ID: 6`
    // [Alarm] DP disconnected alarm (high)`
    await verifyLogsContain(apiBaseUrl, `Current state is: Filling(Priming)||Alarms: 2 2 2 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2||[Alarm] Priority ID: 6\`||[Alarm] DP disconnected alarm (high)\``, 2000, "error", false, `[Priming] Start priming process\``);
    logStepMessage("✅ Step 1");
}

async function step2(apiBaseUrl) {
    logStepMessage("▶️ Step 2");
    await connectCartridgeToPump(apiBaseUrl);
    await browser.pause(2000);

    await waitForDisappear(buildSelectorByText(getCachedString('alerts.DP_DISCONNECTED.alert_title_pump_disconnected')), 20000);
    logStepMessage("✅ Alarm Cartridge disconnected disappeared");

    // [Alarm] Alarm cleared: 6`
    // [Priming] Start priming process` 
    // Start Motor`
    // firstEncRdAftrStrtMtr
    await verifyLogsContain(apiBaseUrl, `[Alarm] Alarm cleared: 6\`||[Priming] Start priming process\`||Start Motor\`||firstEncRdAftrStrtMtr`, 3000, "error", true);
    logStepMessage("✅ Step 2");
}

async function step3(apiBaseUrl) {
    logStepMessage("▶️ Step 3");
    await disconnectCartridgeFromPump(apiBaseUrl);

    // PRM done
    // [Priming] Priming done.Vol.pushed:30010` 
    // [FSM] New state: Ready` 
    // Alarms: 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 1 2 2 2 2 2 2
    // [Alarm] Priority ID: 21`
    // [FSM] New state: ReadyPaused`
    // [Alarm] Treatment Paused (med)`

    // Alarms: 2 2 2 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 1 2 2 2 2 2 2
    // [Alarm] Priority ID: 6`
    await verifyLogsContain(apiBaseUrl, `[Priming] Priming done.||[FSM] New state: Ready\`||Alarms: 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 1 2 2 2 2 2 2||[Alarm] Priority ID: 21\`||[FSM] New state: ReadyPaused\`||[Alarm] Treatment Paused (med)\`||Alarms: 2 2 2 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 1 2 2 2 2 2 2||[Alarm] Priority ID: 6\`||[Alarm] DP disconnected alarm (high)\`||Stop Motor||[FSM] New state: High Priority Alarms\``, 10000, "error", true);
    logStepMessage("✅ Step 3");
}

async function step4(apiBaseUrl) {
    logStepMessage("▶️ Step 4");
    await waitForVisible(
        buildSelectorById('tvAlarmTitle'),
        'alerts.DP_DISCONNECTED.alert_title_pump_disconnected',
        30000,
        300
    );

    logStepMessage("✅ Alarm Cartridge disconnected shown [alerts.DP_DISCONNECTED.alert_title_pump_disconnected]");

    await checkAlarm(
        'alerts.DP_DISCONNECTED.alert_title_pump_disconnected',
        'alerts.DP_DISCONNECTED.alert_description_pump_disconnected',
        { expectedStr: 'ID 6 ' }
    );

    await verifyLogsContain(apiBaseUrl, `Alarms: 2 2 2 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 1 2 2 2 2 2 2`, 5000, "error", false, `Sound Alarm`);

    adbDecouplePump();
    await browser.pause(5000);
    await verifyLogsContain(apiBaseUrl, `Alarms: 2 2 2 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 1 2 2 2 2 2 2||Sound Alarm`, 3000, "error");
    logStepMessage("✅ Step 4");
}