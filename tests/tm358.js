// helpers
import { clearPumpLogs, connectTwico, disconnectTwico, verifyLogsContain } from '../helpers/apiHelpers.js';
import { activateRegimenAndStart, pairPump, resetToFTU, updateRegimenValues } from '../helpers/preConditionsHelpers.js';
import { buildSelectorById, csTurnOffPump, getElementById, getElementByIdAndText, getSegmentsValues, waitForVisible } from '../helpers/uiHelpers.js';

import { loadStrings } from '../helpers/i18n.js';
import { logPretty, logStep, logStepMessage } from '../helpers/logger.js';

// config
import { adbCouplePump, adbDecouplePump } from '../helpers/adbHelpers.js';
import config from '../helpers/config.js';
import { flowState, saveState } from '../helpers/flowState.js';
import { assertComparison, convertHoursToSeconds, parseHour } from '../helpers/generalHelpers.js';

import allureReporter from '@wdio/allure-reporter';

/*
Precondition:
CS and Pump are after FTU and paired.

Regimen data:
620 mg (590 mg day and 30 mg night)
Day treatment - Start: 04:00 AM , End: 10:00 PM
Night treatment - Start: 10:00 PM , End: 04:00 AM

Pump regimen was activated by CS.

Pump is shut down after regimen was activated.
*/

const testKey = "TM-358";

let preconditionsPassed = false;

describe(`${testKey} - Regimen data after ship mode`, () => {
    const { apiBaseUrl, globalParams } = config;
    const { pumpName, portName } = { ...globalParams };

    const regimenValues = {
        day: {
            nbHours: "18 h",
            start: "4:00 AM",
            end: "10:00 PM",
            doseRate: "550",
            dose: "590"
        },
        night: {
            nbHours: "6 h",
            start: "10:00 PM",
            end: "4:00 AM",
            doseRate: "80",
            dose: "30"
        },
        totalDose: "620"
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
            await logStep('Reset to FTU', async () => {
                await resetToFTU(apiBaseUrl);
            });
            await logStep('Pair pump', async () => {
                await pairPump(pumpName);
            });
            await logStep(`Update Regimen - Day: ${regimenValues.day.start} / ${regimenValues.day.doseRate} - Night: ${regimenValues.night.start} / ${regimenValues.night.doseRate}`, async () => {
                await updateRegimenValues(apiBaseUrl, regimenValues.day.start, regimenValues.day.doseRate, regimenValues.night.start, regimenValues.night.doseRate);
                logPretty("Pre regimen", regimenValues);
            });
            await logStep('Activate regimen and start (until medication empty)', async () => {
                await activateRegimenAndStart();
            });
            await logStep('Shut down Pump from cs', async () => {
                await csTurnOffPump();
            });

            await browser.pause(5000);
            await logStep('Clear pump logs', async () => {
                await clearPumpLogs(apiBaseUrl);
                await browser.pause(2000);
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
            await logStep('Step 1 - Insert pump - Medication empty', async () => {
                await step1();
            });

            await logStep('Step 2 - Check Dosing regimen', async () => {
                await step2(apiBaseUrl, regimenValues);
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

async function step1() {
    logStepMessage("▶️ Step 1");

    adbDecouplePump();
    await browser.pause(1000);
    adbCouplePump();

    await waitForVisible(
        buildSelectorById('tvAlertTitle'),
        'alerts.EMPTY_DRUG.alert_title_empty_drug',
        50000,
        300,
        true
    );

    await browser.pause(1000);

    const audioBtn = await getElementById('tvDismissAlert');
    await audioBtn.click();
    logStepMessage("✅ Step 1");
}

async function step2(apiBaseUrl, regimenValues) {
    logStepMessage("▶️ Step 2");

    await browser.pause(100);
    const headerMenu = await getElementById('ivHeaderMenu');
    await headerMenu.click();

    const dosingRegimenSettings = await getElementByIdAndText('tvItemTitle', 'screens.MENU.menu_item_regimen_settings');
    await dosingRegimenSettings.click();

    let segmentsValues;
    ({ segmentsValues } = await getSegmentsValues());

    const startDayInSeconds = convertHoursToSeconds(parseHour(regimenValues.day.start));
    const startNightInSeconds = convertHoursToSeconds(parseHour(regimenValues.night.start));

    const segment0 = `[REGM] SEG 0 Val: ${regimenValues.day.doseRate} Time: ${startDayInSeconds}\``;
    const segment1 = `[REGM] SEG 1 Val: ${regimenValues.night.doseRate} Time: ${startNightInSeconds}\``;
    logStepMessage(segment0);
    logStepMessage(segment1);

    // [REGM] SEG 0 Val: 550 Time: 14400` 
    // [REGM] SEG 1 Val: 80 Time: 79200` 

    await verifyLogsContain(apiBaseUrl, `[BIT] REGIMENS Tst PASS\`||${segment0}||${segment1}`, 0, "error");

    assertComparison(regimenValues, segmentsValues, true, "Regimen"); // unchanged
    logStepMessage("✅ Segments unsaved as expected");

    logStepMessage("✅ Step 2");
}
