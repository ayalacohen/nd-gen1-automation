// helpers
import { clearPumpLogs, connectCartridgeToPump, connectTwico, disconnectBle, disconnectCartridgeFromPump, disconnectTwico, verifyLogsContain } from '../helpers/apiHelpers.js';
import { activateRegimenAndStart, pairPump, resetToFTU } from '../helpers/preConditionsHelpers.js';
import { buildSelectorById, getElementById, waitForDisabled, waitForVisible } from '../helpers/uiHelpers.js';

import { loadStrings } from '../helpers/i18n.js';
import { logStep, logStepMessage } from '../helpers/logger.js';

// config
import config from '../helpers/config.js';
import { flowState, saveState } from '../helpers/flowState.js';

import allureReporter from '@wdio/allure-reporter';

/*
Precondition:
CS and pump after FTU, paired and connected

CS shows home screen with “Medication is empty” alarm

Cartridge is attached
*/
const testKey = "TM-2634";
let preconditionsPassed = false;

describe(`${testKey} - BLE disconnection on "Connect new cartridge" screen`, () => {
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

        await logStep('Step 1 - Tap on "Prepare treatment" button, on "Dispose of used materials" screen press on "Next" button and at the same time simulate BLE disconnection, verify that "Next" button is disabled', async () => {
            await step1(apiBaseUrl);
        });

        await logStep('Step 2 - Wait till CS and pump resumes BLE connection', async () => {
            await step2(apiBaseUrl);
        });

        await logStep('Step 3 - While on "Connect a new cartidge" screen simulate BLE disconnection , verify that "Next" button is disabled', async () => {
            await step3(apiBaseUrl);
        });

        await logStep('Step 4 - Wait till CS and pump resumes BLE connection', async () => {
            await step4(apiBaseUrl);
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
    const prepareTreatment = await getElementById('tvSecond', 'common.cmn_text_start_treatment');
    await prepareTreatment.click();

    await getElementById('tvHeaderTitle', 'screens.REMOVE_OLD_DISPOSABLE.remove_old_disposable_title');

    await disconnectCartridgeFromPump(apiBaseUrl);
    await browser.pause(2000);

    await connectCartridgeToPump(apiBaseUrl);
    await browser.pause(2000);

    const fillDetailNextBtn = await getElementById('tvFillDetailNext', 'common.cmn_text_next');
    await fillDetailNextBtn.click();
    await browser.pause(100);

    await disconnectBle(apiBaseUrl);

    await waitForVisible(
        buildSelectorById('tvHeaderTitle'),
        'screens.CONNECT_A_NEW_CARTRIDGE.connect_new_cartridge_title',
        15000,
        300
    );

    await waitForDisabled(buildSelectorById('tvSecond'));

    logStepMessage("✅ NEXT disabled");

    await verifyLogsContain(apiBaseUrl, `[BLE] Device Disconnected||[BLE] Pump disconnected from CS||BLE state:3Advrtsing`, 0, "error");
    logStepMessage("✅ Step 1");
}

async function step2(apiBaseUrl) {
    logStepMessage("▶️ Step 2");
    const nextBtn = await getElementById('tvSecond');

    await browser.waitUntil(async () => await nextBtn.isEnabled(), {
        timeout: 10000,
        timeoutMsg: "❌ NEXT did not enable"
    });
    logStepMessage("✅ NEXT enabled");

    await verifyLogsContain(apiBaseUrl, `[BLE] Device Connected||[BLE] Pump connected to CS||BLE state:2Connected`, 2000, "error");
    logStepMessage("✅ Step 2");
}

async function step3(apiBaseUrl) {
    logStepMessage("▶️ Step 3");
    await getElementById('tvHeaderTitle', 'screens.CONNECT_A_NEW_CARTRIDGE.connect_new_cartridge_title');

    await disconnectBle(apiBaseUrl);

    await waitForDisabled(buildSelectorById('tvSecond'));

    logStepMessage("✅ NEXT disabled");

    await verifyLogsContain(apiBaseUrl, `[BLE] Device Disconnected||[BLE] Pump disconnected from CS||BLE state:3Advrtsing`, 2000, "error");
    logStepMessage("✅ Step 3");
}

async function step4(apiBaseUrl) {
    logStepMessage("▶️ Step 4");
    const nextBtn = await getElementById('tvSecond');

    await browser.waitUntil(async () => await nextBtn.isEnabled(), {
        timeout: 10000,
        timeoutMsg: "❌ NEXT did not enable"
    });
    logStepMessage("✅ NEXT enabled");

    await getElementById('tvHeaderTitle', 'screens.CONNECT_A_NEW_CARTRIDGE.connect_new_cartridge_title');

    await verifyLogsContain(apiBaseUrl, `[BLE] Device Connected||[BLE] Pump connected to CS||BLE state:2Connected`, 2000, "error");
    logStepMessage("✅ Step 4");
}

