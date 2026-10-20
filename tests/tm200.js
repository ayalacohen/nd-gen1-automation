// helpers
import { adbCouplePump, adbDecouplePump } from '../helpers/adbHelpers.js';
import { clearPumpLogs, connectCartridgeToPump, connectTwico, disconnectCartridgeFromPump, disconnectTwico, updateParameterValue, verifyLogsContain } from '../helpers/apiHelpers.js';
import { activateRegimenAndStart, pairPump, resetToFTU } from '../helpers/preConditionsHelpers.js';
import { buildSelectorById, checkAlarm, getElementById, waitForDisappear, waitForVisible } from '../helpers/uiHelpers.js';

import { loadStrings } from '../helpers/i18n.js';
import { logStep, logStepMessage } from '../helpers/logger.js';

// config
import config from '../helpers/config.js';
import { flowState, saveState } from '../helpers/flowState.js';

import allureReporter from '@wdio/allure-reporter';

/*
Precondition:
Pump and CS after FTU + start prepare treatment until filling
*/
const testKey = "TM-200";
let preconditionsPassed = false;

describe(`${testKey} - Cartridge disconnection vs Process interrupted (ID31)`, () => {
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

            await logStep('Start prepare treatment until filling', async () => {
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

        await logStep('Step 1 - Start filling, decouple/couple pump, connect/disconnect cartdrige and check alarms', async () => {
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

    const nextBtn = await getElementById('tvSecond', 'common.cmn_text_next');
    await nextBtn.click();
    await browser.pause(500);

    await getElementById('tvHeaderTitle', 'screens.CONNECT_TUBING_SCREEN.connect_tubing_title');

    adbDecouplePump();
    await browser.pause(7000);

    await checkAlarm(
        'alerts.FILL_PROCESS_INTERRUPTED.alert_title_fill_process_interrupted',
        'alerts.FILL_PROCESS_INTERRUPTED.alert_description_fill_process_interrupted',
        { expectedStr: 'ID 31 ' }
    );

    // Alarms ON: ID8
    // Alarms: 2 2 2 2 2 2 2 8 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2
    await verifyLogsContain(apiBaseUrl, `Alarms: 2 2 2 2 2 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2||[Alarm] Priority ID: 8\`||[Alarm] Fill process interrupted\``, 3000, "error");

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

    // Alarms ON: ID6 and ID8
    // Alarms: 2 2 2 2 2 1 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2
    await verifyLogsContain(apiBaseUrl, `Alarms: 2 2 2 2 2 1 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2||[Alarm] Priority ID: 6\`||[Alarm] DP disconnected alarm (high)\``, 3000, "error");

    adbCouplePump();
    await browser.pause(5000);

    // Alarms ON: ID6 (ID8 cleared)
    // Alarms: 2 2 2 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2
    await verifyLogsContain(apiBaseUrl, `Alarms: 2 2 2 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2||[Alarm] Alarm cleared: 8\``, 3000, "error");

    await connectCartridgeToPump(apiBaseUrl);

    // Alarms OFF: ID6 cleared
    // Alarms: 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2
    await verifyLogsContain(apiBaseUrl, `Alarms: 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2||[Alarm] Alarm cleared: 6\``, 3000, "error");

    await waitForDisappear(buildSelectorById('tvAlarmTitle'), 10000);
    logStepMessage("✅ Alarm CARTRIDGE DISCONNECTED disappeared");

    const primeTubbingBtn = await getElementById('tvSecond', 'screens.CONNECT_TUBING_SCREEN.connect_tubing_prime_button');
    if (!(await primeTubbingBtn.isEnabled())) {
        throw new Error("❌ PRIME TUBING disabled");
    }
    logStepMessage("✅ PRIME TUBING enabled");
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
}