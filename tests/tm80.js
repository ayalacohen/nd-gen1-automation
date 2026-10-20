// helpers
import { clearPumpLogs, connectTwico, disconnectTwico, verifyLogsContain } from '../helpers/apiHelpers.js';
import { activateRegimenAndStart, pairPump, resetToFTU } from '../helpers/preConditionsHelpers.js';
import { displayHiddenMenu, getElementById, scrollToItem } from '../helpers/uiHelpers.js';

import { loadStrings } from '../helpers/i18n.js';
import { logStep, logStepMessage } from '../helpers/logger.js';

// config
import config from '../helpers/config.js';
import { flowState, saveState } from '../helpers/flowState.js';

import allureReporter from '@wdio/allure-reporter';
import { adbCouplePump, adbDecouplePump, adbGetDeviceDateTime } from '../helpers/adbHelpers.js';
import { isStrictValidDateTime, parseStrictDateTime } from '../helpers/generalHelpers.js';

/*
Precondition:
CS and Pump after FTU
*/
const testKey = "TM-80";
let preconditionsPassed = false;

describe(`${testKey} - Pump state after FTU completion`, () => {
    const { apiBaseUrl, globalParams } = config;
    const { pumpName, portName } = { ...globalParams };

    let adbFtuDateTime;

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

            await logStep('Clear pump logs', async () => {
                await clearPumpLogs(apiBaseUrl);
            });

            await logStep('Pair pump', async () => {
                await pairPump(pumpName);
                adbFtuDateTime = adbGetDeviceDateTime();
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

        await logStep('Step 1 -Validate the pump time', async () => {
            await step1(apiBaseUrl);
        });

        await logStep('Step 2 - Activate regimen, Validate in GATT logs the flag of “is FTU done”', async () => {
            await step2(apiBaseUrl);
        });

        await logStep(`Step 3 - Uncouple the pump, Open the hidden menu, select 'BLE TEST' section from CS hidden menu and verify the status of “is FTU finished ” flag`, async () => {
            await step3();
        });

        await logStep(`Step 4 - Couple the pump, Go to Menu and select 'Version details', Validate the 'FTU date' parameter and the 'Executed Cycles count'`, async () => {
            await step4(adbFtuDateTime);
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
    // [0-0] Time modified`
    // [0-0] [GAT] updt: 4b : 00 00 00 7d
    // [0-0] Cnsl RTC H15 M19 S13 D31 M3 Y2026
    // [0-0] [GAT] updt: 23 : 00 00 69 cb e5 f1 00 00 00 00
    // [0-0] BLE: CLOCK_SYNC
    // [0-0] [CPL] State:1
    // [0-0] [HALL] Val:416
    // [0-0] Cnsl RTC H15 M19 S14 D31 M3 Y2026
    // [0-0] [INFO]:PWR Mode:0

    await verifyLogsContain(apiBaseUrl, `Time modified\`||BLE: CLOCK_SYNC`, 3000, "error");
    logStepMessage("✅ Step 1");
}

async function step2(apiBaseUrl) {
    logStepMessage("▶️ Step 2");
    await activateRegimenAndStart();

    await verifyLogsContain(apiBaseUrl, `[GAT] updt: 10 : 07||[Alarm] Med is empty (high): 3\`||Alarms: 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2||[Alarm] Priority ID: 3\`||Current state is: High Priority Alarms`, 5000, "error", true);
    logStepMessage("✅ Step 2");
}

async function step3() {
    logStepMessage("▶️ Step 3");
    adbDecouplePump();
    await browser.pause(2000);

    await displayHiddenMenu();

    const bleTest = await scrollToItem('BLE Test');
    await bleTest.click();

    const bleTestIsFtuFinished = await getElementById('tvBleTestIsFtuFinished');
    const bleTestIsFtuFinishedText = await bleTestIsFtuFinished.getText();

    if (bleTestIsFtuFinishedText !== "true") {
        throw new Error(`BLE Test Is FTU finished mismatch: expected "true", got "${bleTestIsFtuFinishedText}"`);
    }
    logStepMessage(`BLE Test Is FTU finished correctly set to "true"`);

    const backButton = await getElementById('ivHeaderBack');
    await backButton.click();

    const back = await scrollToItem('Back');
    await back.click();
    logStepMessage("✅ Step 3");
}

async function step4(adbFtuDateTime) {
    logStepMessage("▶️ Step 4");
    adbCouplePump();
    await browser.pause(2000);

    const headerMenu = await getElementById('ivHeaderMenu');
    await headerMenu.click();

    const versionDetails = await scrollToItem('screens.MENU.menu_item_version_details', true);
    await versionDetails.click();

    await scrollToItem('screens.ABOUT_SCREENS.about_pump_ftu_date', true);
    const pumpFtuDate = await getElementById('tvPumpFtuDate');
    const pumpFtuDateStr = await pumpFtuDate.getText();

    if (isStrictValidDateTime(pumpFtuDateStr, "pumpFtuDate")) {
        logStepMessage(`✅ Pump FTU date "${pumpFtuDateStr}" is in expected format`);
    } else {
        throw new Error(`❌ Pump FTU date "${pumpFtuDateStr}" is NOT in expected format`);
    }

    const pumpFtuDateObj = parseStrictDateTime(pumpFtuDateStr, "pumpFtuDate");

    const adbFtuDateObj = new Date(adbFtuDateTime.year, adbFtuDateTime.month - 1, adbFtuDateTime.day, adbFtuDateTime.hour, adbFtuDateTime.minute, adbFtuDateTime.second);

    const diffMs = Math.abs(pumpFtuDateObj.getTime() - adbFtuDateObj.getTime());
    const diffSec = diffMs / 1000;

    logStepMessage(
        `🆚 Comparing FTU dates:
        UI (without second precision): ${pumpFtuDateObj}
        ADB: ${adbFtuDateObj}
        Diff: ${diffSec.toFixed(1)} sec`
    );

    const toleranceSec = 60;

    if (diffSec > toleranceSec) {
        throw new Error(
            `❌ Pump FTU ≠ ADB FTU (diff ${diffSec.toFixed(1)} sec, tolerance ${toleranceSec}s)`
        );
    }

    logStepMessage(`✅ Pump FTU matches ADB FTU (within ${toleranceSec}s)`);

    await scrollToItem('screens.ABOUT_SCREENS.about_filling_cycle_count', true);

    const fillingCycleCount = await getElementById('tvFillingCycleCount');
    const fillingCycleCountStr = await fillingCycleCount.getText();

    if (fillingCycleCountStr === "0") {
        logStepMessage("Executed Cycles count 0 as expected");
    } else {
        throw new Error(`"Executed Cycles count ${fillingCycleCountStr}, not 0 as expected"`)
    }

    const backBtn = await getElementById('ivHeaderBack');
    await backBtn.click();

    logStepMessage("✅ Step 4");
}
