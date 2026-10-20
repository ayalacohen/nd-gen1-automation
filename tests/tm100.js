// helpers
import { clearPumpLogs, connectTwico, disconnectTwico, verifyLogsContain } from '../helpers/apiHelpers.js';
import { pairPump, resetToFTU } from '../helpers/preConditionsHelpers.js';
import { getElementById, getSegmentsValues } from '../helpers/uiHelpers.js';

import { loadStrings } from '../helpers/i18n.js';
import { logStep, logStepMessage } from '../helpers/logger.js';

// config
import config from '../helpers/config.js';
import { assertComparison, convertHoursToSeconds, parseHour } from '../helpers/generalHelpers.js';
import { flowState, saveState } from '../helpers/flowState.js';

import allureReporter from '@wdio/allure-reporter';

/*
Precondition:
Burn Pump’s FW

CS and Pump on FTU

Complete the pairing phase
*/
const testKey = "TM-100";
let preconditionsPassed = false;

describe(`${testKey} - Default regimen`, () => {
    const { apiBaseUrl, globalParams } = config;
    const { pumpName, portName } = { ...globalParams };

    const expectedValues = {
        day: {
            nbHours: "18 h",
            start: "3:00 AM",
            end: "9:00 PM",
            doseRate: "640",
            dose: "690"
        },
        night: {
            nbHours: "6 h",
            start: "9:00 PM",
            end: "3:00 AM",
            doseRate: "80",
            dose: "30"
        },  
        totalDose: "720"
        };

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

        await logStep('Step 1 - Check Dosing regimen', async () => {
            await step1(apiBaseUrl, expectedValues);
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
async function step1(apiBaseUrl, expectedValues) {
    logStepMessage("▶️ Step 1");

    const nextBtn = await getElementById('tvSecond');
    await nextBtn.click();
    await browser.pause(100);

    const { segmentsValues } = await getSegmentsValues();

    assertComparison(expectedValues, segmentsValues, true, "Regimen"); // should be as expected
    logStepMessage("✅ Default segments as expected");

    const startDayInSeconds = convertHoursToSeconds(parseHour(segmentsValues.day.start));
    const startNightInSeconds = convertHoursToSeconds(parseHour(segmentsValues.night.start));

    const segment0 = `[REGM] SEG 0 Val: ${segmentsValues.day.doseRate} Time: ${startDayInSeconds}\``;
    const segment1 = `[REGM] SEG 1 Val: ${segmentsValues.night.doseRate} Time: ${startNightInSeconds}\``;

    // check logs
    // [REGM] SEG 0 Val: 640 Time: 10800` 
    // [REGM] SEG 1 Val: 80 Time: 75600` 
    await verifyLogsContain(apiBaseUrl, `${segment0}||${segment1}`, 0, "error");

    logStepMessage("✅ Step 1");
}
