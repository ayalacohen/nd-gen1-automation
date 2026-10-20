// helpers
import { connectTwico, disconnectBle, disconnectTwico } from '../helpers/apiHelpers.js';
import { activateRegimenAndStart, pairPump, resetToFTU } from '../helpers/preConditionsHelpers.js';
import { buildSelectorById, getElementById, getElementByIdAndText, waitForVisible } from '../helpers/uiHelpers.js';

import { loadStrings } from '../helpers/i18n.js';
import { logStep, logStepMessage } from '../helpers/logger.js';

// config
import config from '../helpers/config.js';
import { flowState, saveState } from '../helpers/flowState.js';

import allureReporter from '@wdio/allure-reporter';

/*
Precondition:
Using CS configuration tool NDUI to change: “FW Configuration File”-> user_default_key= 1, “APK Configuration File”-> HcpUser = True,

Pump and CS after FTU

Pump in ‘Medication is empty’ alarm
*/

const testKey = "TM-538";

let preconditionsPassed = false;

describe(`${testKey} - BLE Disconnection While Editing Dosing Regimen`, () => {
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

        await logStep('Step 1 - BLE Disconnect while opening Dosing regimen settings', async () => {
            await step1(apiBaseUrl);
        });

        await logStep('Step 2 - Try again - Dosing regimen overview', async () => {
            await step2();
        });

        await logStep('Step 3 - Back to Home screen', async () => {
            await step3();
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

    const headerMenu = await getElementById('ivHeaderMenu');
    await headerMenu.click();

    const dosingRegimenSettings = await getElementByIdAndText('tvItemTitle', 'screens.MENU.menu_item_regimen_settings');
    await dosingRegimenSettings.click();

    await browser.pause(2000);

    await disconnectBle(apiBaseUrl);

    await getElementById('tvAlarmTitle', 'alerts.BLE_COMMUNICATION_FAILURE.alert_title_ble_communication_failure');

    logStepMessage("✅ Step 1");
}
async function step2() {
    logStepMessage("▶️ Step 2");

    const tryAgain = await getElementById('tvThird', 'common.cmn_text_try_again');
    await tryAgain.click();

    await waitForVisible(
        buildSelectorById('tvHeaderTitle'),
        'screens.REGIMEN_OVERVIEW.title_single_regimen_overview',
        15000
        );

    logStepMessage("✅ Step 2");
}

async function step3() {
    logStepMessage("▶️ Step 3");
    const backBtn = await getElementById('ivHeaderBack');
    await backBtn.click();

    await getElementById('tvHeaderTitle', 'screens.HOME.home_title');

    logStepMessage("✅ Step 3");
}