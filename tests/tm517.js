// helpers
import { clearPumpLogs, connectTwico, disconnectCartridgeFromPump, disconnectTwico, pressPumpButton, updateParameterValue, verifyLogsContain } from '../helpers/apiHelpers.js';
import { activateRegimenAndStart, pairPump, prepareTreatmentUntilPrepareInfusionSites, resetToFTU } from '../helpers/preConditionsHelpers.js';
import { buildSelectorById, checkAlert, getCachedString, getElementById, waitForScreenWithHeartbeat } from '../helpers/uiHelpers.js';

import { loadStrings } from '../helpers/i18n.js';
import { logStep, logStepMessage } from '../helpers/logger.js';

// config
import config from '../helpers/config.js';
import { flowState, saveState } from '../helpers/flowState.js';

import allureReporter from '@wdio/allure-reporter';
import { adbDecouplePump } from '../helpers/adbHelpers.js';

/*
Precondition:
Pump and CS after FTU, paired and connected

Complete filling and priming

CS shows “Insert cannulas“ screen

Pump is coupled

Change vie TwikoGUI the following parameters under "Occlusion" tab:

check box "Update during runtime"

change "occlusion_current_treshold" to 0

change "occlusion_min_steps_on_sample_10ms" to 100 (can use any number from 30 to 40)

click "Write to system active"
*/
const testKey = "TM-517";
let preconditionsPassed = false;

describe(`${testKey} - "Blockage" alarm detection following priming completion`, () => {
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

            await logStep('Update pump parameters to reduce filling time and change occlusion', async () => {
                await updateParameterValue(apiBaseUrl, "VIAL_DETECT_MIN_CURRENT_DIFF_FOR_SUCCESS_DEFAULT", 8, 0);

                await updateParameterValue(apiBaseUrl, "VIAL_DETECT_MIN_CURRENT_SAMPLES_PER_MOTOR_BURST_DEFAULT", 9, 100);

                await updateParameterValue(apiBaseUrl, "ENCODER_FILLING_HARD_STOP_VALUE", 14, 55000);

                await updateParameterValue(apiBaseUrl, "FILING_MIN_ENCODER_FOR_REMOVE_AIR_STAGE", 53, 10000);

                await updateParameterValue(apiBaseUrl, "FILLING_STEP_2_MIN_DRUG_VOLUME_ENC", 4, 0);

                await updateParameterValue(apiBaseUrl, "OCLUSION_CURRENT_THRESHOLD", 6, 0);

                await updateParameterValue(apiBaseUrl, "OCCLUSION_MIN_STEPS_ON_SAMPLE_10MS", 2, 100);
            });

            await logStep('Start prepare treatment until Prepare Infusion Sites', async () => {
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

        await logStep('Step 1 - Wait for blockage detection alarm', async () => {
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
    await getElementById('tvHeaderTitle', 'screens.INSERT_CANNULA.insert_cannula_screen_title');

    await browser.pause(20000);

    adbDecouplePump();
    await browser.pause(7000);

    await pressPumpButton(apiBaseUrl);

    await getElementById('tvTitle', 'dialogs.DELIVERY_STARTED.dialog_delivery_started_title');

    await getElementById('tvThird', 'common.cmn_text_ok');

    await waitForScreenWithHeartbeat(
      buildSelectorById('tvAlertTitle') + `.text("${getCachedString('alerts.BLOCKAGE_ALARM.alert_title_pump_blockage_alarm').toUpperCase()}")`,
      null,
      600000
    );

    logStepMessage("✅ Alert BLOCKAGE DETECTED shown [alerts.BLOCKAGE_ALARM.alert_title_pump_blockage_alarm] upper case");

    await getElementById('tvHeaderTitle', 'screens.HOME.home_title');

    await checkAlert(
        'alerts.BLOCKAGE_ALARM.alert_title_pump_blockage_alarm',
        'alerts.BLOCKAGE_ALARM.alert_description_pump_blockage_alarm_full',
      {
          localizedTemplateKey: 'alerts.STRINGS_FOR_ALERT_TYPES.alert_info_default',
          requiredId: '5'
      }
    );

    // Alarms ON: ID5
    //"Alarms: Alarms: 2 2 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2"
    // [Alarm] Priority ID: 5\`
    // [Alarm] Occlusion detected (high)\`

    await verifyLogsContain(apiBaseUrl, `Alarms: 2 2 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2||[Alarm] Priority ID: 5\`||[Alarm] Occlusion detected (high)\``, 5000, "error");
    logStepMessage("✅ Step 1");
}