// helpers
import { adbConnectWC, adbCouplePump, adbDecouplePump, adbDisconnectWC } from '../helpers/adbHelpers.js';
import { clearPumpLogs, connectCartridgeToPump, connectTwico, disconnectCartridgeFromPump, disconnectTwico, pressPumpButton, resetPump, updateParameterValue, verifyLogsContain } from '../helpers/apiHelpers.js';
import { activateRegimenAndStart, pairPump, resetToFTU } from '../helpers/preConditionsHelpers.js';
import { buildSelectorById, buildSelectorByText, checkAlarm, checkAlert, displayHiddenMenu, getCachedString, getElementById, isElementDisplayedById, scrollToItem, waitForDisappear, waitForVisible, waitWithHeartbeat } from '../helpers/uiHelpers.js';

import { loadStrings } from '../helpers/i18n.js';
import { logStep, logStepMessage } from '../helpers/logger.js';

// config
import config from '../helpers/config.js';
import { flowState, saveState } from '../helpers/flowState.js';

import allureReporter from '@wdio/allure-reporter';

/*
Precondition:
Pump parameter DELAY_PRIOR_FILLING = 0

Pump and CS after FTU, paired and connected

Pump is coupled

Cartridge is connected to the pump

CS shows HS “Medication is empty”
*/

/*
GATT: Acknowledgement status = 1 (true)  / 0 (false)
Check [GAT] updt: 19 : 00 00 00 00 00 00 00 00 00 00 00 00 06 / 00 00 00 00 00 01 00 00 00 00 00 00 06 in pump logs
Acknowledge status in 6th byte: 00 / 01 for Alarm code in 13th byte : 06
*/
const testKey = "TM-141";
let preconditionsPassed = false;

describe(`${testKey} - Fill process interrupted alarm during filling`, () => {
    const { apiBaseUrl, globalParams } = config;
    const { pumpName, portName, lowBattery124For100Percent, lowBattery92For5Percent } = { ...globalParams };

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

            await logStep('Update pump parameters to reduce filling time', async () => {
                await updateParameterValue(apiBaseUrl, "VIAL_DETECT_MIN_CURRENT_DIFF_FOR_SUCCESS_DEFAULT", 8, 0);

                await updateParameterValue(apiBaseUrl, "VIAL_DETECT_MIN_CURRENT_SAMPLES_PER_MOTOR_BURST_DEFAULT", 9, 100);

                await updateParameterValue(apiBaseUrl, "ENCODER_FILLING_HARD_STOP_VALUE", 14, 55000);

                await updateParameterValue(apiBaseUrl, "FILING_MIN_ENCODER_FOR_REMOVE_AIR_STAGE", 53, 10000);

                await updateParameterValue(apiBaseUrl, "FILLING_STEP_2_MIN_DRUG_VOLUME_ENC", 4, 0);
            });

            await logStep('Set DELAY_PRIOR_FILLING_TH_SEC_DEFAULT to 0', async () => {
                await updateParameterValue(apiBaseUrl, "DELAY_PRIOR_FILLING_TH_SEC_DEFAULT", 79, 0);
            });

            await logStep('Start prepare treatment until filling', async () => {
                await startPrepareTreatment(apiBaseUrl);
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

        await logStep('Step 1 - Before start filling change CRITICALLY_LOW_BATT to 124 through TwikoGUI and Start filling', async () => {
            await step1(apiBaseUrl, lowBattery124For100Percent);
        });

        await logStep('Step 2 - Within filling is executed, decouple the pump', async () => {
            await step2(apiBaseUrl);
        });

        await logStep('Step 3 - Press the pump push button to acknowledge the alarm', async () => {
            await step3(apiBaseUrl);
        });

        await logStep('Step 4 - Couple the pump', async () => {
            await step4(apiBaseUrl);
        });

        await logStep('Step 5 - Reset the pump via TwikoGUI, Reset the CS via Hidden Menu → Scroll down → Restart application', async () => {
            await step5(apiBaseUrl);
        });

        await logStep('Step 6 - Change back the CRITICAL_LOW_BATT to 92 and restart the filling process', async () => {
            await step6(apiBaseUrl, lowBattery92For5Percent);
        });

        await logStep('Step 7 - Uncouple the pump', async () => {
            await step7(apiBaseUrl);
        });

        await logStep('Step 8 - Couple the pump, disable WC via PowerShell command', async () => {
            await step8(apiBaseUrl);
        });

        await logStep('Step 9 - Enable the WC charger', async () => {
            await step9(apiBaseUrl);
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
    await updateParameterValue(apiBaseUrl, "CRITICALLY_LOW_BATT", 23, lowBattery124For100Percent);

    const startFillingBtn = await getElementById('tvSecond', 'common.cmn_start_filling');

    await startFillingBtn.click();
    await browser.pause(1000);

    await getElementById('tvHeaderTitle', 'screens.FILLING_MEDICATION.filling_medication_ftu');

    await waitWithHeartbeat(20000);
    await verifyLogsContain(apiBaseUrl, `[FSM] New state: Filling\`||[FIL] started event\`||Start Motor\``, 3000, "error");
    logStepMessage("✅ Step 1");
}

async function step2(apiBaseUrl) {
    logStepMessage("▶️ Step 2");
    adbDecouplePump();

    await waitForVisible(
        buildSelectorById('tvAlarmTitle'),
        'alerts.PUMP_BATTERY_CRITICAL.alert_title_pump_battery_critical',
        20000,
        300
    );

    logStepMessage("✅ Alarm PUMP BATTERY IS EMPTY shown [alerts.PUMP_BATTERY_CRITICAL.alert_title_pump_battery_critical] upper case");

    await checkAlarm(
        'alerts.PUMP_BATTERY_CRITICAL.alert_title_pump_battery_critical',
        'alerts.PUMP_BATTERY_CRITICAL.alert_description_pump_battery_critical',
        { expectedStr: 'ID 2 ' }
    );

    // Alarms ON: ID2 and ID8
    // Alarms: 2 1 2 2 2 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2
    // [Alarm] Bat empty (high): 124`
    // [Alarm] Fill process interrupted`

    // Acknowledge status 0
    // [GAT] updt: 19 : 00 00 00 00 00 00 00 00 00 00 00 00 02
    await verifyLogsContain(apiBaseUrl, `Start Motor\`||Stop Motor||Alarms: 2 1 2 2 2 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2||[GAT] updt: 19 : 00 00 00 00 00 00 00 00 00 00 00 00 02||[Alarm] Priority ID: 2\`||[Alarm] Bat empty (high)||[Alarm] Fill process interrupted\`||Current state is: Filling`, 5000, "error");

    // motor stopped
    await verifyLogsContain(apiBaseUrl, `Current state is: Filling`, 10000, "error", false, `Start Motor\`||Stop Motor`);
    logStepMessage("✅ Step 2");
}

async function step3(apiBaseUrl) {
    logStepMessage("▶️ Step 3");
    await pressPumpButton(apiBaseUrl);
    await browser.pause(10000);

    await checkAlarm(
        'alerts.PUMP_BATTERY_CRITICAL.alert_title_pump_battery_critical',
        'alerts.PUMP_BATTERY_CRITICAL.alert_description_pump_battery_critical',
        { expectedStr: 'ID 2 ' }
    );

    // Acknowledge status 0
    // [GAT] updt: 19 : 00 00 00 00 00 01 00 00 00 00 00 00 02
    await verifyLogsContain(apiBaseUrl, `[GAT] updt: 19 : 00 00 00 00 00 01 00 00 00 00 00 00 02`, 3000, "error");
    logStepMessage("✅ Step 3");
}

async function step4(apiBaseUrl) {
    logStepMessage("▶️ Step 4");
    adbCouplePump();

    await waitForDisappear(buildSelectorById('tvAlarmTitle'), 30000);
    logStepMessage("✅ Alarm PUMP BATTERY IS EMPTY disappeared");

    await getElementById('tvHeaderTitle', 'screens.FILLING_MEDICATION.filling_medication_ftu');

    // Alarms OFF
    // Alarms: 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2
    // [Alarm] Alarm cleared: 8`
    // [Alarm] Alarm cleared: 2, Bat: 124`

    // Acknowledge status 0
    // [GAT] updt: 19 : 00 00 00 00 00 00 00 00 00 00 00 00 00
    await verifyLogsContain(apiBaseUrl, `Alarms: 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2||[Alarm] Alarm cleared: 8\`||[Alarm] Alarm cleared: 2||[GAT] updt: 19 : 00 00 00 00 00 00 00 00 00 00 00 00 00`, 5000, "error");
    logStepMessage("✅ Step 4");
}

async function step5(apiBaseUrl) {
    logStepMessage("▶️ Step 5");
    await resetPump(apiBaseUrl);

    // await browser.pause(40000);
    await browser.pause(30000); // stop - continue  --> continue with retry of display hidden..

    await displayHiddenMenu();

    const csRestartApplication = await scrollToItem('Restart application');
    await csRestartApplication.click();

    await waitForVisible(
        buildSelectorById('tvAlertTitle'),
        'alerts.EMPTY_DRUG.alert_title_empty_drug',
        30000,
        300,
        true
    );
    logStepMessage("✅ Alert MEDICATION IS EMPTY shown [alerts.EMPTY_DRUG.alert_title_empty_drug] upper case");

    await checkAlert(
        'alerts.EMPTY_DRUG.alert_title_empty_drug',
        'alerts.EMPTY_DRUG.alert_description_empty_drug',
        { expectedStr: 'ID 3 ' }
    );
    if (await isElementDisplayedById('tvDismissAlert')) {
        const audioBtn = await getElementById('tvDismissAlert');
        await audioBtn.click();
    }
    logStepMessage("✅ Step 5");
}

async function step6(apiBaseUrl, lowBattery92For5Percent) {
    logStepMessage("▶️ Step 6");
    await updateParameterValue(apiBaseUrl, "CRITICALLY_LOW_BATT", 23, lowBattery92For5Percent);

    await startPrepareTreatment(apiBaseUrl);

    await clearPumpLogs(apiBaseUrl);

    const startFillingBtn = await getElementById('tvSecond', 'common.cmn_start_filling');

    await startFillingBtn.click();
    await browser.pause(1000);

    await getElementById('tvHeaderTitle', 'screens.FILLING_MEDICATION.filling_medication_ftu');

    await waitWithHeartbeat(20000);
    await verifyLogsContain(apiBaseUrl, `[FSM] New state: Filling\`||[FIL] started event\`||Start Motor\``, 5000, "error");
    logStepMessage("✅ Step 6");
}

async function step7(apiBaseUrl) {
    logStepMessage("▶️ Step 7");
    adbDecouplePump();

    await waitForVisible(
        buildSelectorById('tvAlarmTitle'),
        'alerts.FILL_PROCESS_INTERRUPTED.alert_title_fill_process_interrupted',
        10000,
        300
    );

    logStepMessage("✅ Alarm Process interrupted shown [alerts.FILL_PROCESS_INTERRUPTED.alert_title_fill_process_interrupted]");

    await checkAlarm(
        'alerts.FILL_PROCESS_INTERRUPTED.alert_title_fill_process_interrupted',
        'alerts.FILL_PROCESS_INTERRUPTED.alert_description_fill_process_interrupted',
        { expectedStr: 'ID 31 ' }
    );

    await verifyLogsContain(apiBaseUrl, `[Alarm] Priority ID: 8\`||[Alarm] Fill process interrupted\``, 3000, "error");
    logStepMessage("✅ Step 7");
}

async function step8(apiBaseUrl) {
    logStepMessage("▶️ Step 8");
    adbCouplePump();
    await browser.pause(7000);

    // Alarms OFF and filling starts

    // [Alarm] Alarm cleared: 8`
    // Alarms: 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2
    // [GAT] updt: 19 : 00 00 00 00 00 00 00 00 00 00 00 00 00
    // Start Motor`

    await verifyLogsContain(apiBaseUrl, `[Alarm] Alarm cleared: 8\`||Alarms: 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2||[GAT] updt: 19 : 00 00 00 00 00 00 00 00 00 00 00 00 00||Start Motor\``, 1000, "error", true);

    adbDisconnectWC();

    await waitForVisible(
        buildSelectorById('tvAlarmTitle'),
        'alerts.FILL_PROCESS_INTERRUPTED.alert_title_fill_process_interrupted',
        10000,
        300
    );

    logStepMessage("✅ Alarm Process interrupted shown [alerts.FILL_PROCESS_INTERRUPTED.alert_title_fill_process_interrupted]");

    await checkAlarm(
        'alerts.FILL_PROCESS_INTERRUPTED.alert_title_fill_process_interrupted',
        'alerts.FILL_PROCESS_INTERRUPTED.alert_description_fill_process_interrupted',
        { expectedStr: 'ID 31 ' }
    );

    // Alarms ON: ID8
    // Alarms: 2 2 2 2 2 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2
    // [Alarm] Priority ID: 8`
    // [Alarm] Fill process interrupted`

    // Acknowledge status 0
    // [GAT] updt: 19 : 00 00 00 00 00 00 00 00 00 00 00 00 08

    await verifyLogsContain(apiBaseUrl, `Alarms: 2 2 2 2 2 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2||[Alarm] Priority ID: 8\`||[Alarm] Fill process interrupted\`||[GAT] updt: 19 : 00 00 00 00 00 00 00 00 00 00 00 00 08`, 1000, "error", true);

    logStepMessage("✅ Step 8");
}

async function step9(apiBaseUrl) {
    logStepMessage("▶️ Step 9");
    adbConnectWC();

    await waitForDisappear(buildSelectorByText(getCachedString('alerts.PUMP_BATTERY_CRITICAL.alert_title_pump_battery_critical')), 10000);
    logStepMessage("✅ Alarm Pump battery is empty disappeared");

    // Alarms OFF
    // Alarms: 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2
    // [Alarm] Alarm cleared: 8`

    // Acknowledge status 0
    // [GAT] updt: 19 : 00 00 00 00 00 00 00 00 00 00 00 00 08

    await verifyLogsContain(apiBaseUrl, `Alarms: 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2||[Alarm] Alarm cleared: 8\`||[GAT] updt: 19 : 00 00 00 00 00 00 00 00 00 00 00 00 00`, 5000, "error");

    await getElementById('tvHeaderTitle', 'screens.FILLING_MEDICATION.filling_medication_ftu');

    await getElementById('progressFilingMedicine');

    await waitForDisappear(buildSelectorById('progressFilingMedicine'), 150000);

    await getElementById('tvHeaderTitle', 'screens.REMOVE_VIAL_ADAPTERS.remove_vial_adapters_title');
    logStepMessage("✅ Step 9");
}

async function startPrepareTreatment(apiBaseUrl) {
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
    await browser.pause(1000);

    await getElementById('tvHeaderTitle', 'screens.PREPARE_FOR_FILLING.prepare_for_filling_screen');

    const startFillingBtn = await getElementById('tvSecond', 'common.cmn_start_filling');
    await browser.waitUntil(async () => await startFillingBtn.isEnabled(), {
        timeout: 5000,
        timeoutMsg: "❌ START FILLING did not enable"
    });
}