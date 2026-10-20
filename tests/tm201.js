// helpers
import { adbCouplePump, adbDecouplePump } from '../helpers/adbHelpers.js';
import { clearPumpLogs, connectTwico, disconnectTwico, pressPumpButton, setEncoderDrugValue, updateParameterValue, verifyLogsContain } from '../helpers/apiHelpers.js';
import { buildSelectorById, checkAlert, getCachedString, getElementById, isElementDisplayedById, isElementDisplayedByText, waitForVisible } from '../helpers/uiHelpers.js';

import { loadStrings } from '../helpers/i18n.js';
import { logStep, logStepMessage } from '../helpers/logger.js';

// config
import config from '../helpers/config.js';
import { flowState, saveState } from '../helpers/flowState.js';

import allureReporter from '@wdio/allure-reporter';

/*
Precondition:
a. Pump with low battery level TwikoGUI > SCD Alarms tab > LOW_BATT=124
   Pump with Medication will stop soon alarm
b. Pump in delivery
*/
const testKey = "TM-201";
let preconditionsPassed = false;

describe(`${testKey} - Low pump battery VS Medication will stop soon`, () => {
    const { apiBaseUrl, globalParams } = config;
    const { portName, lowBattery124For100Percent, lowBattery100For20Percent } = { ...globalParams };

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

            await logStep('Click GET STARTED', async () => {
                if (await isElementDisplayedByText(getCachedString('common.cmn_get_started'), 20000)) {
                    logStepMessage("Click GET STARTED");
                    const getStarted = await getElementById('tvThird');
                    await getStarted.click();
                    await browser.pause(2000);
                } else {
                    logStepMessage("Skipping this step...");
                }
            });

            await logStep('Pause treatment', async () => {
                if (await isElementDisplayedByText(getCachedString('screens.HOME.home_screen_medication_delivery_on'), 5000)) {
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
                } else {
                    logStepMessage("Skipping this pause step...Treatment already paused");
                }
            });

            await logStep('Clear pump logs', async () => {
                await clearPumpLogs(apiBaseUrl);
            });

            await logStep('Simulate  Medication will stop soon alarm', async () => {
                await setEncoderDrugValue(apiBaseUrl, 17000);
            });

            await logStep(`Set LOW_BATT to ${lowBattery124For100Percent}`, async () => {
                await updateParameterValue(apiBaseUrl, "LOW_BATT", 24, lowBattery124For100Percent);
            });

            await logStep('Decouple and press Pump button', async () => {
                adbDecouplePump();
                await browser.pause(10000);
                await pressPumpButton(apiBaseUrl);
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

        await logStep('Step 1 - Check low battery alarm', async () => {
            await step1(apiBaseUrl);
        });

        await logStep(`Couple the pump and set LOW_BATT back to default ${lowBattery100For20Percent}`, async () => {
            adbCouplePump();
            await browser.pause(7000);

            await updateParameterValue(apiBaseUrl, "LOW_BATT", 24, lowBattery100For20Percent);

            if (await isElementDisplayedById('tvDismissAlert', 10000)) {
                const audioBtn = await getElementById('tvDismissAlert');
                await audioBtn.click();
            }
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
    await waitForVisible(
        buildSelectorById('tvAlertTitle'),
        'alerts.LOW_PUMP_BATTERY.alert_title_pump_battery_low',
        10000,
        300,
        true
    );

    logStepMessage("✅ Alert PUMP BATTERY IS LOW shown [alerts.LOW_PUMP_BATTERY.alert_title_pump_battery_low] upper case");

    await checkAlert(
        'alerts.LOW_PUMP_BATTERY.alert_title_pump_battery_low',
        'alerts.LOW_PUMP_BATTERY.alert_description_pump_battery_low',
        { expectedStr: 'ID 22 ' }
    );

    // Alarms ON: ID22 and ID23
    // Alarms: 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 1 1 2 2 2 2
    await verifyLogsContain(apiBaseUrl, `Alarms: 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 1 1 2 2 2 2||[Alarm] Bat low (low)||[Alarm] Priority ID: 22\``, 5000, "error");
    logStepMessage("✅ Step 1");
}
