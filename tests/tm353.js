// helpers
import { adbCouplePump, adbDecouplePump } from '../helpers/adbHelpers.js';
import { clearPumpLogs, connectTwico, disconnectCartridgeFromPump, disconnectTwico, updateParameterValue, verifyLogsContain } from '../helpers/apiHelpers.js';
import { activateRegimenAndStart, pairPump, resetToFTU } from '../helpers/preConditionsHelpers.js';
import { buildSelectorById, checkAlarm, checkAlert, getCachedString, getElementById, isElementDisplayedByText, waitForVisible } from '../helpers/uiHelpers.js';

import { loadStrings } from '../helpers/i18n.js';
import { logStep, logStepMessage } from '../helpers/logger.js';

// config
import config from '../helpers/config.js';
import { flowState, saveState } from '../helpers/flowState.js';

import allureReporter from '@wdio/allure-reporter';

/*
Precondition:
Pump and CS after FTU, paired and connected

CS shows HP “Medication is empty”

Pump is coupled

Pump is connected to DebugBoard
*/
const testKey = "TM-353";
let preconditionsPassed = false;

describe(`${testKey} - Alarm masking CS: Allowed alarm before completion of “Connect new Cartridge” step`, () => {
    const { apiBaseUrl, globalParams } = config;
    const { pumpName, portName, lowBattery124For100Percent } = { ...globalParams };

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

        await logStep('Step 1 - Start treatment preparation and disconnnect the cartridge', async () => {
            await step1(apiBaseUrl);
        });

        await logStep('Step 2 - Simulate low pump battery', async () => {
            await step2(apiBaseUrl, lowBattery124For100Percent);
        });

        await logStep('Step 3 - Decouple the pump', async () => {
            await step3();
        });

        await logStep('Step 4 - Couple the pump and simulate malfunction', async () => {
            await step4(apiBaseUrl);
        });

        await logStep('Step 5 - Confirm the dialog', async () => {
            await step5();
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
    await browser.pause(1000);

    await getElementById('tvHeaderTitle', 'screens.REMOVE_OLD_DISPOSABLE.remove_old_disposable_title');

    const fillDetailNextBtn = await getElementById('tvFillDetailNext', 'common.cmn_text_next');
    await fillDetailNextBtn.click();
    await browser.pause(1000);

    await getElementById('tvHeaderTitle', 'screens.CONNECT_A_NEW_CARTRIDGE.connect_new_cartridge_title');
    await getElementById('tvMessageContainerInfo', 'screens.CONNECT_A_NEW_CARTRIDGE.connect_new_cartridge_info');

    await disconnectCartridgeFromPump(apiBaseUrl);

    const medicationEmptyTxt = getCachedString('alerts.EMPTY_DRUG.alert_title_empty_drug').toUpperCase();
    if (await isElementDisplayedByText(medicationEmptyTxt)) {
        throw new Error("❌ MEDICATION EMPTY alarm displayed [alerts.EMPTY_DRUG.alert_title_empty_drug] upper case");
    }
    logStepMessage("✅ MEDICATION EMPTY alarm NOT displayed [alerts.EMPTY_DRUG.alert_title_empty_drug] upper case");

    const cartridgeDisconnectedTxt = getCachedString('alerts.DP_DISCONNECTED.alert_title_pump_disconnected').toUpperCase();
    if (await isElementDisplayedByText(cartridgeDisconnectedTxt)) {
        throw new Error("❌ CARTRIDGE DISCONNECTED alarm displayed [alerts.DP_DISCONNECTED.alert_title_pump_disconnected] upper case");
    }
    logStepMessage("✅ CARTRIDGE DISCONNECTED alarm NOT displayed [alerts.DP_DISCONNECTED.alert_title_pump_disconnected] upper case");

    const nextBtn = await getElementById('tvSecond', 'common.cmn_text_next');
    if ((await nextBtn.isEnabled())) {
        throw new Error("❌ NEXT enabled");
    }
    logStepMessage("✅ NEXT disabled");

    // Alarms ON: ID3 and ID6
    // Alarms: 2 2 1 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2
    await verifyLogsContain(apiBaseUrl, `Alarms: 2 2 1 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2||[Alarm] DP disconnected alarm (high)\`||[Alarm] Med is empty (high): 3\``, 2000, "error");
    logStepMessage("✅ Step 1");
}

async function step2(apiBaseUrl, lowBattery124For100Percent) {
    logStepMessage("▶️ Step 2");
    await updateParameterValue(apiBaseUrl, "LOW_BATT", 24, lowBattery124For100Percent);

    const lowPumpBatteryTxt = getCachedString('alerts.LOW_PUMP_BATTERY.alert_title_pump_battery_low').toUpperCase();
    if (await isElementDisplayedByText(lowPumpBatteryTxt)) {
        throw new Error("❌ LOW PUMP BATTERY alarm displayed [alerts.LOW_PUMP_BATTERY.alert_title_pump_battery_low] upper case");
    }
    logStepMessage("✅ LOW PUMP BATTERY alarm NOT displayed [alerts.LOW_PUMP_BATTERY.alert_title_pump_battery_low] upper case");
    // Alarms ON: ID3, ID6 and ID22
    // Alarms: 2 2 1 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 1 2 2 2 2 2
    // [Alarm] Priority ID: 3`
    //[Alarm] Bat low (low): 108`
    await verifyLogsContain(apiBaseUrl, `Alarms: 2 2 1 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 1 2 2 2 2 2||[Alarm] Bat low (low)`, 2000, "error");
    logStepMessage("✅ Step 2");
}

async function step3() {
    logStepMessage("▶️ Step 3");
    adbDecouplePump();

    const processInterruptedTxt = getCachedString('alerts.FILL_PROCESS_INTERRUPTED.alert_title_fill_process_interrupted');
    if (await isElementDisplayedByText(processInterruptedTxt)) {
        throw new Error("❌ Process interrupted alarm displayed");
    }
    logStepMessage("✅ Process interrupted alarm NOT displayed");
    logStepMessage("✅ Step 3");
}

async function step4(apiBaseUrl) {
    logStepMessage("▶️ Step 4");
    adbCouplePump();
    await browser.pause(5000);

    await updateParameterValue(apiBaseUrl, "MAX_ALLOWED_TEMPERATURE", 34, 10);

    await waitForVisible(
        buildSelectorById('tvAlarmTitle'),
        'alerts.PUMP_MALFUNCTION.alert_title_pump_malfunction',
        30000,
        300
    );
    logStepMessage("✅ Alarm Pump malfunction shown [alerts.PUMP_MALFUNCTION.alert_title_pump_malfunction]");

    await checkAlarm(
        'alerts.PUMP_MALFUNCTION.alert_title_pump_malfunction',
        'alerts.PUMP_MALFUNCTION.alert_description_pump_malfunction',
        {
            templateKey: 'alerts.STRINGS_FOR_ALERT_TYPES.alert_cs_hw_malfunction_info',
            templateValues: ['1', '29']
        }
    );

    // Alarms ON: ID1, ID3, ID6 and ID22
    // Alarms: 1 2 1 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 1 2 2 2 2 2
    // [Alarm] Priority ID: 1`
    await verifyLogsContain(apiBaseUrl, `Alarms: 1 2 1 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 1 2 2 2 2 2||[Alarm] Priority ID: 1\``, 2000, "error");
    logStepMessage("✅ Step 4");
}

async function step5() {
    logStepMessage("▶️ Step 5");
    const audioBtn = await getElementById('tvThird');
    await audioBtn.click();
    await browser.pause(1000);

    await getElementById('tvHeaderTitle', 'screens.HOME.home_title');

    await checkAlert(
        'alerts.PUMP_MALFUNCTION.alert_title_pump_malfunction',
        'alerts.PUMP_MALFUNCTION.alert_description_pump_malfunction',
        {
            templateKey: 'alerts.STRINGS_FOR_ALERT_TYPES.alert_cs_hw_malfunction_info',
            templateValues: ['1', '29']
        }
    );
    logStepMessage("✅ Step 5");
}