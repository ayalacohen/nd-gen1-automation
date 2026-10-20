// helpers
import { adbCouplePump, adbDecouplePump } from '../helpers/adbHelpers.js';
import { clearPumpLogs, connectCartridgeToPump, connectTwico, disconnectCartridgeFromPump, disconnectTwico, updateParameterValue, verifyLogsContain } from '../helpers/apiHelpers.js';
import { activateRegimenAndStart, pairPump, resetToFTU } from '../helpers/preConditionsHelpers.js';
import { buildSelectorById, getCachedString, getElementById, isElementDisplayedByText, waitForDisappear } from '../helpers/uiHelpers.js';

import { loadStrings } from '../helpers/i18n.js';
import { logStep, logStepMessage } from '../helpers/logger.js';

// config
import config from '../helpers/config.js';
import { flowState, saveState } from '../helpers/flowState.js';

import allureReporter from '@wdio/allure-reporter';

/*
Precondition:
Pump and CS are paired, connected

Pump is coupled to CS

Pump finished only filling flow
*/
const testKey = "TM-339";
let preconditionsPassed = false;

describe(`${testKey} - Priming execution while pump is out of the cradle`, () => {
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

            await logStep('Start prepare treatment and complete filling', async () => {
                await startPrepareTreatment(apiBaseUrl);
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

        await logStep('Step 1 - Start priming, decouple the pump', async () => {
            await step1(apiBaseUrl);
        });

        await logStep('Couple the pump', async () => {
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
    const primeTubbingBtn = await getElementById('tvSecond', 'screens.CONNECT_TUBING_SCREEN.connect_tubing_prime_button');
    await primeTubbingBtn.click();
    await browser.pause(100);

    await getElementById('tvHeaderTitle', 'screens.PREPARE_INFUSION_SITES.screen_prepare_infusion_sites_title');

    await browser.pause(2000);

    adbDecouplePump();

    // Alarms ON: ID21 (ID8 OFF)
    // Alarms: 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 1 2 2 2 2 2 2 
    await verifyLogsContain(apiBaseUrl, `[Priming] Start priming process\`||decoupled evnt:||[Priming] Priming done.||Alarms: 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 1 2 2 2 2 2 2||[Alarm] Priority ID: 21\`||[FSM] New state: ReadyPaused\`||[Alarm] Treatment Paused (med)\``, 20000, "error");

    logStepMessage(`✅ Pump Alarm ID8 "Fill process interrupted" is not active, only ID21 "Treatment paused (med)" is active`);

    const treatementPauseTxt = getCachedString('alerts.FILL_PROCESS_INTERRUPTED.alert_title_fill_process_interrupted').toUpperCase();
    if (await isElementDisplayedByText(treatementPauseTxt)) {
        throw new Error("❌ PROCESS INTERRUPTED alarm displayed [alerts.FILL_PROCESS_INTERRUPTED.alert_title_fill_process_interrupted] upper case");
    }
    logStepMessage("✅ PROCESS INTERRUPTED alarm NOT displayed [alerts.FILL_PROCESS_INTERRUPTED.alert_title_fill_process_interrupted] upper case");

    await getElementById('tvHeaderTitle', 'screens.PREPARE_INFUSION_SITES.screen_prepare_infusion_sites_title');
    logStepMessage("✅ Step 1");
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

    const startFillingBtn = await getElementById('tvSecond', 'common.cmn_start_filling');

    await browser.waitUntil(async () => await startFillingBtn.isEnabled(), {
        timeout: 5000,
        timeoutMsg: "❌ START FILLING did not enable"
    });

    await startFillingBtn.click();
    await browser.pause(1000);

    await getElementById('tvHeaderTitle', 'screens.FILLING_MEDICATION.filling_medication_ftu');

    await getElementById('progressFilingMedicine');

    await waitForDisappear(buildSelectorById('progressFilingMedicine'), 120000);

    await getElementById('tvHeaderTitle', 'screens.REMOVE_VIAL_ADAPTERS.remove_vial_adapters_title');

    nextBtn = await getElementById('tvSecond', 'common.cmn_text_next');
    await nextBtn.click();
    await browser.pause(500);

    await getElementById('tvHeaderTitle', 'screens.CONNECT_TUBING_SCREEN.connect_tubing_title');
    const primeTubbingBtn = await getElementById('tvSecond', 'screens.CONNECT_TUBING_SCREEN.connect_tubing_prime_button');
    if (!(await primeTubbingBtn.isEnabled())) {
        throw new Error("❌ PRIME TUBING disabled");
    }
    logStepMessage("✅ PRIME TUBING enabled");
}