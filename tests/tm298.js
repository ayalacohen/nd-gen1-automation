// helpers
import { clearPumpLogs, connectCartridgeToPump, connectTwico, disconnectCartridgeFromPump, disconnectTwico, updateParameterValue, verifyLogsContain } from '../helpers/apiHelpers.js';
import { activateRegimenAndStart, pairPump, resetToFTU } from '../helpers/preConditionsHelpers.js';
import { getElementById, waitWithHeartbeat } from '../helpers/uiHelpers.js';

import { loadStrings } from '../helpers/i18n.js';
import { logStep, logStepMessage } from '../helpers/logger.js';

// config
import config from '../helpers/config.js';
import { flowState, saveState } from '../helpers/flowState.js';

import allureReporter from '@wdio/allure-reporter';

/*
Precondition:
Pump and CS after FTU, paired and connected

Pump is coupled

CS shows  HS “Medication is empty” 

At the TwikoGUI change the parameter CARTRIDGE_REMOVE_PERIOD to 120

 Cartridge wasn’t disconnected from the pump more for 2 minutes
*/

/*
GATT: BIT6 "Is Cartridge removed on last period" = 1 (true)  / 0 (false) 
GATT: BIT2 "IsCartridgeAttached" = 1 (true)  / 0 (false)

Check [GAT] updt: 19 : 07 / 45 / 47 in pump logs
Hex	Binary	   	    Reversed            Bit 6 IsCartridgeRemoved    Bit 2 IsCartridgeAttached
07	0000 0111		1 1 1 0 0 0 0 0	    0   false                   1   true
45	0100 0101		1 0 1 0 0 0 1 0	    1	true                    0   false
47	0100 0111		1 0 1 0 0 0 1 0	    1	true                    1   true
*/

const testKey = "TM-298";
let preconditionsPassed = false;

describe(`${testKey} - Cartridge connection TimeOut`, () => {
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

            await logStep('Set CARTRIDGE_REMOVE_PERIOD to 120', async () => {
                await updateParameterValue(apiBaseUrl, "CARTRIDGE_REMOVE_PERIOD", 83, 120);
            });

            await logStep('Disconnect and connect the cartdridge', async () => {
                await disconnectCartridgeFromPump(apiBaseUrl);
                await browser.pause(2000);

                await connectCartridgeToPump(apiBaseUrl);
                await browser.pause(7000);
            });

            await logStep('Clear pump logs', async () => {
                await clearPumpLogs(apiBaseUrl);
            });

            await logStep('Wait for 2 minutes', async () => {
                await waitWithHeartbeat(120000);
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

        await logStep('Step 1 - Start the preparation flow until the CS is displaying "Connect a new cartridge" screen', async () => {
            await step1(apiBaseUrl);
        });

        await logStep('Step 2 - Disconnect and reconnect the cartridge to the pump', async () => {
            await step2(apiBaseUrl);
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
    await browser.pause(500);

    await getElementById('tvHeaderTitle', 'screens.REMOVE_OLD_DISPOSABLE.remove_old_disposable_title');

    const fillDetailNextBtn = await getElementById('tvFillDetailNext', 'common.cmn_text_next');
    await fillDetailNextBtn.click();
    await browser.pause(1000);

    await getElementById('tvMessageContainerInfo', 'screens.CONNECT_A_NEW_CARTRIDGE.connect_new_cartridge_info');

    const nextBtn = await getElementById('tvSecond', 'common.cmn_text_next');
    if ((await nextBtn.isEnabled())) {
        throw new Error("❌ NEXT enabled");
    }
    logStepMessage("✅ NEXT disabled");

    await verifyLogsContain(apiBaseUrl, `[GAT] updt: 10 : 07`, 2000, "error", false, `[GAT] updt: 10 : 47||[GAT] updt: 10 : 45`);
    logStepMessage("✅ Step 1");
}

async function step2(apiBaseUrl) {
    logStepMessage("▶️ Step 2");
    await disconnectCartridgeFromPump(apiBaseUrl);
    await browser.pause(2000);

    await connectCartridgeToPump(apiBaseUrl);

    const nextBtn = await getElementById('tvSecond', 'common.cmn_text_next');
    await browser.waitUntil(async () => await nextBtn.isEnabled(), {
        timeout: 10000,
        timeoutMsg: "❌ NEXT did not enable"
    });
    logStepMessage("✅ NEXT enabled");

    await verifyLogsContain(apiBaseUrl, `[GAT] updt: 10 : 47||[DP Status] DP removed||[GAT] updt: 10 : 45||[DP Status] DP attached||[GAT] updt: 10 : 47`, 2000, "error", true, `[GAT] updt: 10 : 07`);
    logStepMessage("✅ Step 2");
}
