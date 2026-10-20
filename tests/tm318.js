// helpers
import { adbDownloadCSLogs } from '../helpers/adbHelpers.js';
import { clearPumpLogs, connectCartridgeToPump, connectTwico, disconnectCartridgeFromPump, disconnectTwico, updateParameterValue, verifyLogsContain } from '../helpers/apiHelpers.js';
import { verifyDbEntry } from '../helpers/dbHelpers.js';
import { activateRegimenAndStart, pairPump, resetToFTU } from '../helpers/preConditionsHelpers.js';
import { buildSelectorById,  checkAlarm, checkAlert, csClearCSLogs, getElementById, isElementDisplayedById, waitForVisible } from '../helpers/uiHelpers.js';

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

Cartridge is connected to the pump

CS shows HS “Medication is empty”
*/
const testKey = "TM-318";
let preconditionsPassed = false;

describe(`${testKey} - Filling: WD test fail due WD test timeout`, () => {
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

            await logStep('Clear CS logs', async () => {
                await csClearCSLogs();
            });

            await logStep('Clear pump logs', async () => {
                await clearPumpLogs(apiBaseUrl);
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

        await logStep('Step 1 - Start treatment preparation until "Fill medication", update Watchdog_Test_Timeout_Period to 2000 and start filling', async () => {
            await step1(apiBaseUrl, pumpName);
        });

        await logStep('Step 2 - Check pump logs', async () => {
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

async function step1(apiBaseUrl, pumpName) {
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

    nextBtn = await getElementById('tvSecond', 'common.cmn_text_next');
    await nextBtn.click();

    await getElementById('tvHeaderTitle', 'screens.PREPARE_FOR_FILLING.prepare_for_filling_screen');

    const startFillingBtn = await getElementById('tvSecond', 'common.cmn_start_filling');

    await browser.waitUntil(async () => await startFillingBtn.isEnabled(), {
        timeout: 5000,
        timeoutMsg: "❌ START FILLING did not enable"
    });

    await updateParameterValue(apiBaseUrl, "WATCHDOG_TEST_TIMEOUT_PERIOD", 63, 2000);

    await startFillingBtn.click();
    await browser.pause(1000);

    await waitForVisible(
        buildSelectorById('tvAlarmTitle'),
        'alerts.PUMP_MALFUNCTION.alert_title_pump_malfunction',
        20000,
        300
    );
    logStepMessage("✅ Alarm Pump malfunction shown [alerts.PUMP_MALFUNCTION.alert_title_pump_malfunction]");

    await checkAlarm(
        'alerts.PUMP_MALFUNCTION.alert_title_pump_malfunction',
        'alerts.PUMP_MALFUNCTION.alert_description_pump_malfunction',
        {
            templateKey: 'alerts.STRINGS_FOR_ALERT_TYPES.alert_cs_hw_malfunction_info',
            templateValues: ['1', '60']
        }
    );

    await waitForVisible(
        buildSelectorById('tvAlarmTitle'),
        'dialogs.PUMP_WRONG_STATE.fill_flow_wrong_pump_state_title',
        20000,
        300
    );
    logStepMessage("✅ Dialog system cannot continue medication filling shown [dialogs.PUMP_WRONG_STATE.fill_flow_wrong_pump_state_title]");

    await browser.pause(10000);

    const stopProcessBtn = await getElementById('tvThird', 'dialogs.PUMP_WRONG_STATE.fill_flow_wrong_pump_state_action_abort');
    await stopProcessBtn.click();
    await browser.pause(1000);

    await waitForVisible(
        buildSelectorById('tvAlertTitle'),
        'alerts.PUMP_MALFUNCTION.alert_title_pump_malfunction',
        10000,
        300,
        true
    );
    logStepMessage("✅ Alert PUMP MALFUNCTION shown [alerts.PUMP_MALFUNCTION.alert_title_pump_malfunction] upper case");

    await checkAlert(
        'alerts.PUMP_MALFUNCTION.alert_title_pump_malfunction',
        'alerts.PUMP_MALFUNCTION.alert_description_pump_malfunction',
        {
            templateKey: 'alerts.STRINGS_FOR_ALERT_TYPES.alert_cs_hw_malfunction_info',
            templateValues: ['1', '60']
        }
    );

    await browser.pause(10000);

    if (await isElementDisplayedById('tvDismissAlert')) {
        const audioBtn = await getElementById('tvDismissAlert');
        await audioBtn.click();
    }

    await browser.pause(50000);

    const dbFile = "db/318_1_control_station_logs.db";
    adbDownloadCSLogs(dbFile);

    const expectedEntries = [
        {
            type_id: 502,
            field_a: "Reads",
            field_b: "Medicine Filling Status"
        },
        {
            type_id: 502,
            field_a: "Writes",
            field_b: "Pump Command",
            field_c: {
                like: [
                    "Pump Command: Start WD Test"
                ]
            }
        },
        {
            type_id: 502,
            field_a: {
                like: [
                    "Disconnect from the Pump"
                ]
            }
        },
        {
            type_id: 502,
            field_a: {
                like: [
                    "Connect to the Pump"
                ]
            }
        },
        {
            type_id: 502,
            field_a: "Pump Notifies",
            field_b: "Pump Alarm Code",
            field_c: {
                like: [
                    "Alarm Code: 1",
                    "Alarm Details Code: 60",
                    "Is Alarm ACK: false",
                    "Is Sound Enabled: true"
                ]
            }
        },
        {
            type_id: 308,
            field_a: "1",
            field_b: "true",
            field_c: {
                like: [
                    "alertCode: 1",
                    "isActive: true",
                    "alertDetailsCode: 60",
                    "isSoundEnabled: true"
                ]
            }
        },
        {
            type_id: 306,
            field_a: "Disconnected",
            field_b: pumpName,
            field_c: "On"
        },
        {
            type_id: 306,
            field_a: "Connected",
            field_b: pumpName,
            field_c: "On"
        }
    ];

    let allOk = true;

    for (const entry of expectedEntries) {
        if (!verifyDbEntry(dbFile, entry)) {
            allOk = false;
        }
    }

    if (!allOk) {
        throw new Error("❌ CS Logs WD Test and Alarm pump malfunction verifications failed");
    }
    logStepMessage("✅ CS Logs WD Test and Alarm pump malfunction verified successfully");

    logStepMessage("✅ Step 1");
}

async function step2(apiBaseUrl) {
    logStepMessage("▶️ Step 2");

    // [WDT] Start`
    // [WDT] Enter test loop`
    // [HW MAL] CODE 60
    // [WDT] Exit: WC enabled during test`
    // Alarms: 1 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2
    // [Alarm] Priority ID: 1`
    // [Alarm] MAL (high)`
    // [BLE] Disconnected
    // [BLE] Advertising
    // BLE state:3Advrtsing
    // [FSM] New state: HW MAL Code: 60`
    // [FSM] New state: HwMal`
    // Current state is: HwMal
    // BLE state:2Connected

    await verifyLogsContain(apiBaseUrl, `Alarms: 1 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2||[Alarm] Priority ID: 1\`||[WDT] Start\`||[WDT] Enter test loop\`||[HW MAL] CODE 60||[WDT] Exit: WC enabled during test\`||[Alarm] MAL (high)\`||[BLE] Disconnected||[BLE] Advertising||BLE state:3Advrtsing||[FSM] New state: HW MAL Code: 60\`||[FSM] New state: HwMal\`||Current state is: HwMal||BLE state:2Connected`, 0, "error");
    logStepMessage("✅ Step 2");
}
