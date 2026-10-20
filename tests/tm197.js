// helpers
import { adbCouplePump, adbDecouplePump } from '../helpers/adbHelpers.js';
import { connectCartridgeToPump, connectTwico, disconnectCartridgeFromPump, disconnectTwico, pressPumpButton, updateParameterValue } from '../helpers/apiHelpers.js';
import { buildSelectorById, checkAlert, getCachedString, getElementById, isElementDisplayedById, isElementDisplayedByText, waitForVisible, waitWithHeartbeat } from '../helpers/uiHelpers.js';

import { loadStrings } from '../helpers/i18n.js';
import { logStep, logStepMessage } from '../helpers/logger.js';

// config
import config from '../helpers/config.js';
import { flowState, saveState } from '../helpers/flowState.js';

import allureReporter from '@wdio/allure-reporter';

/*
Precondition:
Setting the following values in the TwikoGUI SCD label:

ESCALATE_TO_HIGH_PRIORITY_ALARM=100 sec.

Pump in delivery
*/
const testKey = "TM-197";
let preconditionsPassed = false;

describe(`${testKey} - Cartridge disconnected VS Treatment paused too long`, () => {
    const { apiBaseUrl, globalParams } = config;
    const { portName } = { ...globalParams };

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

            await logStep('Start delivery', async () => {
                if (!await isElementDisplayedByText(getCachedString('screens.HOME.home_screen_medication_delivery_on'), 5000)) {
                    adbCouplePump();
                    await browser.pause(1000);
                    adbDecouplePump();
                    await browser.pause(10000);
                    await pressPumpButton(apiBaseUrl);
                    await browser.pause(10000);
                } else {
                    logStepMessage("Skipping this step...Delivery already started");
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

            await logStep('Set ESCALATE_TO_HIGH_PRIORITY_ALARM to 100', async () => {
                await updateParameterValue(apiBaseUrl, "ESCALATE_TO_HIGH_PRIORITY_ALARM", 19, 100);
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

        await logStep('Step 1 - Disconnect/connect/disconnect the cartridge and check alerts', async () => {
            await step1(apiBaseUrl);
        });

        await logStep('Couple the pump, set ESCALATE_TO_HIGH_PRIORITY_ALARM back to default 3600 and connect the cartridge', async () => {
            adbCouplePump();
            await browser.pause(7000);

            await updateParameterValue(apiBaseUrl, "ESCALATE_TO_HIGH_PRIORITY_ALARM", 19, 3600);

            await connectCartridgeToPump(apiBaseUrl);
            await browser.pause(10000);

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
    await disconnectCartridgeFromPump(apiBaseUrl);

    // await browser.pause(10000);

    await waitForVisible(
        buildSelectorById('tvAlertTitle'),
        'alerts.DP_DISCONNECTED.alert_title_pump_disconnected',
        10000,
        300,
        true
    );

    logStepMessage("✅ Alert CARTRIDGE DISCONNECTED shown [alerts.DP_DISCONNECTED.alert_title_pump_disconnected] upper case");

    await checkAlert(
        'alerts.DP_DISCONNECTED.alert_title_pump_disconnected',
        'alerts.DP_DISCONNECTED.alert_description_pump_disconnected_no_fill_flow',
        {
            localizedTemplateKey: 'alerts.STRINGS_FOR_ALERT_TYPES.alert_info_default',
            requiredId: '6'
        }
    );

    await connectCartridgeToPump(apiBaseUrl);

    await waitForVisible(
        buildSelectorById('tvAlertTitle'),
        'alerts.LOW_TREATMENT_PAUSED.alert_title_low_treatment_paused',
        15000,
        300,
        true
    );
    logStepMessage("✅ Alert TREATMENT PAUSED shown [alerts.LOW_TREATMENT_PAUSED.alert_title_low_treatment_paused] upper case");

    await checkAlert(
        'alerts.LOW_TREATMENT_PAUSED.alert_title_low_treatment_paused',
        'alerts.LOW_TREATMENT_PAUSED.alert_description_treatment_paused',
        {
            localizedTemplateKey: 'alerts.STRINGS_FOR_ALERT_TYPES.alert_info_default',
            requiredId: '21'
        }
    );

    logStepMessage("▶️ Waiting for 100s to have the correct alert message");
    await waitWithHeartbeat(100000);

    await checkAlert(
        'alerts.START_DELIVERY_HIGH.alert_title_start_delivery_high',
        'alerts.START_DELIVERY_HIGH.alert_description_start_delivery_high',
        {
            localizedTemplateKey: 'alerts.STRINGS_FOR_ALERT_TYPES.alert_info_default',
            requiredId: '7'
        }
    );

    await disconnectCartridgeFromPump(apiBaseUrl);

    await waitForVisible(
        buildSelectorById('tvAlertTitle'),
        'alerts.DP_DISCONNECTED.alert_title_pump_disconnected',
        10000,
        300,
        true
    );

    logStepMessage("✅ Alert CARTRIDGE DISCONNECTED shown [alerts.DP_DISCONNECTED.alert_title_pump_disconnected] upper case");

    await checkAlert(
        'alerts.DP_DISCONNECTED.alert_title_pump_disconnected',
        'alerts.DP_DISCONNECTED.alert_description_pump_disconnected_no_fill_flow',
        {
            localizedTemplateKey: 'alerts.STRINGS_FOR_ALERT_TYPES.alert_info_default',
            requiredId: '6'
        }
    );
    logStepMessage("✅ Step 1");
}
