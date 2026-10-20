// helpers
import { adbDownloadCSLogs } from '../helpers/adbHelpers.js';
import { clearPumpLogs, connectCartridgeToPump, connectTwico, disconnectCartridgeFromPump, disconnectTwico, verifyLogsContain } from '../helpers/apiHelpers.js';
import { verifyDbEntry } from '../helpers/dbHelpers.js';
import { activateRegimenAndStart, pairPump, resetToFTU } from '../helpers/preConditionsHelpers.js';
import { buildSelectorById, buildSelectorByText, checkAlarm, csClearCSLogs, getCachedString, getElementById, isElementDisplayedById, waitForDisappear, waitForVisible } from '../helpers/uiHelpers.js';

import { loadStrings } from '../helpers/i18n.js';
import { logStep, logStepMessage } from '../helpers/logger.js';

// config
import config from '../helpers/config.js';
import { flowState, saveState } from '../helpers/flowState.js';

import allureReporter from '@wdio/allure-reporter';
import { attachScreenshotFn } from '../helpers/screenshot.js';

/*
Precondition:
Pump and CS after FTU, paired and connected

Pump is coupled

Cartridge is connected to the pump

CS shows HS “Medication is empty”
*/
const testKey = "TM-301";
let preconditionsPassed = false;

describe(`${testKey} - Cartridge disconnection during Treatment preparation`, () => {
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

        await logStep('Step 1 - Start treatment preparation until "Insert new vials" and disconnect the cartridge', async () => {
            await step1(apiBaseUrl);
        });

        await logStep('Step 2 - Connect the cartridge', async () => {
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

    await disconnectCartridgeFromPump(apiBaseUrl);

    const fillDetailNextBtn = await getElementById('tvFillDetailNext', 'common.cmn_text_next');
    await fillDetailNextBtn.click();
    await browser.pause(500);

    let nextBtn = await getElementById('tvSecond', 'common.cmn_text_next');
    await connectCartridgeToPump(apiBaseUrl);

    await browser.waitUntil(async () => await nextBtn.isEnabled(), {
        timeout: 10000,
        timeoutMsg: "❌ NEXT did not enable"
    });

    await nextBtn.click();
    await browser.pause(1000);

    await getElementById('tvHeaderTitle', 'screens.CONNECT_VIAL.connect_vial_screen_title');

    await csClearCSLogs();

    await clearPumpLogs(apiBaseUrl);

    await disconnectCartridgeFromPump(apiBaseUrl); 
    await browser.pause(5000);

    await waitForVisible(
        buildSelectorById('tvAlarmTitle'),
        'alerts.DP_DISCONNECTED.alert_title_pump_disconnected',
        10000,
        300
    );

    logStepMessage("✅ Alarm Cartridge disconnected shown [alerts.DP_DISCONNECTED.alert_title_pump_disconnected]");

    await checkAlarm(
        'alerts.DP_DISCONNECTED.alert_title_pump_disconnected',
        'alerts.DP_DISCONNECTED.alert_description_pump_disconnected',
        { expectedStr: 'ID 6 ' }
    );

    if (await isElementDisplayedById('tvSecond') || await isElementDisplayedById('tvThird')) {
        await attachScreenshotFn("Unexpected_Button_Displayed");
        throw new Error("❌ Option to close the alarm message");
    }
    logStepMessage("✅ No option to close the alarm message");

    // Alarms ON: ID3 and ID6
    // Alarms: 2 2 1 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2
    await verifyLogsContain(apiBaseUrl, `Alarms: 2 2 1 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2||[Alarm] Priority ID: 6\`||[Alarm] DP disconnected alarm (high)\`||[Alarm] Alarm Notification Event`, 5000, "error");

    await browser.pause(5000);

    const dbFile = "db/301_1_control_station_logs.db";
    adbDownloadCSLogs(dbFile);

    const expectedEntries = [
        {
            type_id: 502,
            field_a: "Pump Notifies",
            field_b: "Pump Alarm Code",
            field_c: {
                like: [
                    "Alarm Code: 6",
                    "Is Alarm ACK: false",
                    "Is Sound Enabled: true"
                ]
            }
        },
        {
            type_id: 308,
            field_a: "6",
            field_b: "true",
            field_c: {
                like: [
                    "alertCode: 6",
                    "isActive: true",
                    "isSoundEnabled: true"
                ]
            }
        }
    ];

    let allOk = true;

    for (const entry of expectedEntries) {
        if (!verifyDbEntry(dbFile, entry)) {
            allOk = false;
        }
    }

    if (!allOk) {
        throw new Error("❌ CS Logs Alarm sound and no ack verifications failed");
    }
    logStepMessage("✅ CS Logs Alarm sound and no ack verified successfully");
    logStepMessage("✅ Step 1");
}

async function step2(apiBaseUrl) {
    logStepMessage("▶️ Step 2");
    await connectCartridgeToPump(apiBaseUrl);
    await browser.pause(5000);

    await waitForDisappear(buildSelectorByText(getCachedString('alerts.DP_DISCONNECTED.alert_title_pump_disconnected')), 10000);
    logStepMessage("✅ Alarm Cartridge disconnected disappeared");

    const nextBtn = await getElementById('tvSecond', 'common.cmn_text_next');
    await browser.waitUntil(async () => await nextBtn.isEnabled(), {
        timeout: 10000,
        timeoutMsg: "❌ NEXT did not enable"
    });
 
    // Alarms ON: ID3, ID6 cleared
    // Alarms: 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2
    await verifyLogsContain(apiBaseUrl, `Alarms: 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2||[Alarm] Alarm cleared: 6\``, 5000, "error");
    logStepMessage("✅ Step 2");
}
