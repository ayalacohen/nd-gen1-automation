// helpers
import { adbCouplePump, adbDecouplePump } from '../helpers/adbHelpers.js';
import { clearPumpLogs, connectTwico, disconnectTwico, updateParameterValue, verifyLogsContain } from '../helpers/apiHelpers.js';
import { activateRegimenAndStart, pairPump, resetToFTU } from '../helpers/preConditionsHelpers.js';
import { buildSelectorById, checkAlert, getElementById, isElementDisplayedById, waitForVisible } from '../helpers/uiHelpers.js';

import { loadStrings } from '../helpers/i18n.js';
import { logStep, logStepMessage } from '../helpers/logger.js';

// config
import config from '../helpers/config.js';
import { flowState, saveState } from '../helpers/flowState.js';

import allureReporter from '@wdio/allure-reporter';

/*
Precondition:
Pump and CS after FTU

Set the CRITICALLY_LOW_BATT to 120 at the TwikoGUI ‘SCD Alarms’ tab
*/
const testKey = "TM-198";
let preconditionsPassed = false;

describe(`${testKey} - Empty battery VS Medication is empty`, () => {
    const { apiBaseUrl, globalParams } = config;
    const { pumpName, portName, lowBattery124For100Percent, lowBattery92For5Percent } = { ...globalParams };
    // use low battery 124 instead of 120 to raise the alarm even if battery 100% charged

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

            await logStep(`Set CRITICALLY_LOW_BATT to ${lowBattery124For100Percent}`, async () => {
                await updateParameterValue(apiBaseUrl, "CRITICALLY_LOW_BATT", 23, lowBattery124For100Percent);
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

        await logStep('Step 1 - Decouple the pump', async () => {
            await step1(apiBaseUrl, lowBattery124For100Percent);
        });

        await logStep(`Couple the pump and set CRITICALLY_LOW_BATT back to default ${lowBattery92For5Percent}`, async () => {
            adbCouplePump();
            await browser.pause(5000);

            await updateParameterValue(apiBaseUrl, "CRITICALLY_LOW_BATT", 23, lowBattery92For5Percent);

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
async function step1(apiBaseUrl, lowBattery124For100Percent) {
    logStepMessage("▶️ Step 1");
    adbDecouplePump();

    await waitForVisible(
        buildSelectorById('tvAlertTitle'),
        'alerts.PUMP_BATTERY_CRITICAL.alert_title_pump_battery_critical',
        360000,
        1000,
        true
    );

    logStepMessage("✅ Alert PUMP BATTERY IS EMPTY shown [alerts.PUMP_BATTERY_CRITICAL.alert_title_pump_battery_critical] upper case");

    await checkAlert(
        'alerts.PUMP_BATTERY_CRITICAL.alert_title_pump_battery_critical',
        'alerts.PUMP_BATTERY_CRITICAL.alert_description_pump_battery_critical',
        { expectedStr: 'ID 2 ' }
    );

    // Alarms ON: ID2 and ID3
    // `Alarms: 2 1 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2
    // [Alarm] Priority ID: 2`
    await verifyLogsContain(apiBaseUrl, `Alarms: 2 1 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2||[Alarm] Med is empty (high): 3\`||[Alarm] Bat empty (high): ${lowBattery124For100Percent}\``, 3000, "error");
    logStepMessage("✅ Step 1");
}
