// helpers
import { clearPumpLogs, connectTwico, disconnectCartridgeFromPump, disconnectTwico, updateParameterValue, verifyLogsContain } from '../helpers/apiHelpers.js';
import { activateRegimenAndStart, pairPump, prepareTreatmentUntilPrepareInfusionSites, resetToFTU } from '../helpers/preConditionsHelpers.js';
import { buildSelectorById, checkAlert, getElementById, isElementDisplayedById, waitForVisible } from '../helpers/uiHelpers.js';

import { loadStrings } from '../helpers/i18n.js';
import { logStep, logStepMessage } from '../helpers/logger.js';

// config
import config from '../helpers/config.js';
import { flowState, saveState } from '../helpers/flowState.js';

import allureReporter from '@wdio/allure-reporter';

/*
Precondition:
Pump and CS after FTU, paired and connected

Complete filling and priming

CS shows “Insert cannulas“ screen

Pump is coupled
*/
const testKey = "TM-518";
let preconditionsPassed = false;

describe(`${testKey} - "Malfunction" alarm detection following priming completion`, () => {
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

            await logStep('Prepare treatment until Prepare Infusion Sites', async () => {
                const prepareTreatment = await getElementById('tvSecond', 'common.cmn_text_start_treatment');
                await prepareTreatment.click();
                await browser.pause(500);

                await disconnectCartridgeFromPump(apiBaseUrl);

                await prepareTreatmentUntilPrepareInfusionSites(apiBaseUrl);
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

        await logStep('Step 1 - Update MAX_ALLOWED_TEMPERATURE to 2', async () => {
            await step1(apiBaseUrl);
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
    await updateParameterValue(apiBaseUrl, "MAX_ALLOWED_TEMPERATURE", 34, 2);

    await waitForVisible(
        buildSelectorById('tvAlertTitle'),
        'alerts.PUMP_MALFUNCTION.alert_title_pump_malfunction',
        20000,
        300,
        true
    );
    logStepMessage("✅ Alert PUMP MALFUNCTION shown [alerts.PUMP_MALFUNCTION.alert_title_pump_malfunction] upper case");

    if (await isElementDisplayedById('tvDismissAlert')) {
        const audioBtn = await getElementById('tvDismissAlert');
        await audioBtn.click();
    }

    await checkAlert(
        'alerts.PUMP_MALFUNCTION.alert_title_pump_malfunction',
        'alerts.PUMP_MALFUNCTION.alert_description_pump_malfunction',
        {
            templateKey: 'alerts.STRINGS_FOR_ALERT_TYPES.alert_cs_hw_malfunction_info',
            templateValues: ['1', '29']
        }
    );

    // Alarms ON: ID1
    // Alarms: 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2
    // [Alarm] Priority ID: 1`
    // [Alarm] MAL (high)`
    // [FSM] New state: HW MAL Code: 29`
    // [FSM] New state: HwMal`
    await verifyLogsContain(apiBaseUrl, `Alarms: 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2||[Alarm] Priority ID: 1\`||[Alarm] MAL (high)\`||[FSM] New state: HW MAL Code: 29\`||[FSM] New state: HwMal\``, 2000, "error");
    logStepMessage("✅ Step 1");
}
