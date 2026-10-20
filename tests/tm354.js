// helpers
import { adbConnectWC, adbCouplePump, adbDecouplePump, adbDisconnectWC, adbUpdateConfigFilesAndMainSn } from '../helpers/adbHelpers.js';
import { clearPumpLogs, connectCartridgeToPump, connectTwico, disconnectCartridgeFromPump, disconnectTwico, updateParameterValue, verifyLogsContain } from '../helpers/apiHelpers.js';
import { activateRegimenAndStart, pairPump, resetToFTU } from '../helpers/preConditionsHelpers.js';
import { buildSelectorById, buildSelectorByText, checkAlarm, checkAlert, getCachedString, getElementById, isElementDisplayedById, isElementDisplayedByText, waitForDisappear, waitForVisible, waitWithHeartbeat } from '../helpers/uiHelpers.js';

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

Pump is coupled to DebugBoard

Change the following parameter in TwikoGUI:   ESCALATE _TO_HIGH_PRIORITY ALARM to 600sec 

Change via NeurodermUI tool - ProcessIncompleteAlarmSeconds to 300 
*/
const testKey = "TM-354";
let preconditionsPassed = false;

describe(`${testKey} - Alarm masking CS: Allowed alarms during filling state`, () => {
    const { apiBaseUrl, globalParams } = config;
    const { pumpName, portName, lowBattery124For100Percent, lowBattery92For5Percent } = { ...globalParams };

    const apkLocalConfigFile = "adb-config-files/HCP_ALARM_300_cs_config.json";
    const fwLocalConfigFile = "adb-config-files/DEFAULT_1_config.file";

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

            await logStep('Set ESCALATE_TO_HIGH_PRIORITY_ALARM to 600', async () => {
                await updateParameterValue(apiBaseUrl, "ESCALATE_TO_HIGH_PRIORITY_ALARM", 19, 600);
            });

            await logStep('Update HCP_300 config files and relaunch', async () => {
                if (flowState.lastCategory == "HCP_300_1") {
                    logStepMessage("Skipping these update config steps...");
                } else {
                    await adbUpdateConfigFilesAndMainSn(apkLocalConfigFile, fwLocalConfigFile);
                    flowState.lastCategory = "HCP_300_1";
                }
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

        await logStep('Step 1 - Start treatment preparation', async () => {
            await step1(apiBaseUrl);
        });

        await logStep('Step 2 - Decouple the pump and connect the cartridge', async () => {
            await step2(apiBaseUrl);
        });

        await logStep('Step 3 - Simulate low pump battery', async () => {
            await step3(apiBaseUrl, lowBattery124For100Percent);
        });

        await logStep('Step 4 - Couple the pump, disable CS WC, disconnect the cartridge and simulate critically low pump battery', async () => {
            await step4(apiBaseUrl, lowBattery124For100Percent);
        });

        await logStep('Step 5 - Set critically low pump battery back to default, connect the cartridge and enable CS WC', async () => {
            await step5(apiBaseUrl, lowBattery92For5Percent);
        });

        await logStep('Step 6 - Press Next on "Insert new vials" screen and decouple the pump', async () => {
            await step6(apiBaseUrl);
        });

        await logStep('Step 7 - Disconnect the cartridge on "Fill Medication" screen', async () => {
            await step7(apiBaseUrl);
        });

        await logStep('Step 8 - Connect the cartridge', async () => {
            await step8(apiBaseUrl);
        });

        await logStep('Step 9 - Couple the pump', async () => {
            await step9();
        });

        await logStep('Step 10 - Press on "Start filling" button', async () => {
            await step10(apiBaseUrl);
        });

        await logStep('Step 11 - Withing filling state, decouple the pump', async () => {
            await step11(apiBaseUrl);
        });

        await logStep('Step 12 - Couple the pump', async () => {
            await step12();
        });

        await logStep('Step 13 - Disconnect the cartridge during filling', async () => {
            await step13(apiBaseUrl);
        });

        await logStep('Step 14 - Simulate malfunction updating max allowed temperature', async () => {
            await step14(apiBaseUrl);
        });

        await logStep('Step 15 - Press on "Pause audio" button', async () => {
            await step15();
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

    await clearPumpLogs(apiBaseUrl);

    await disconnectCartridgeFromPump(apiBaseUrl);

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

    const medicationEmptyTxt = getCachedString('alerts.EMPTY_DRUG.alert_title_empty_drug').toUpperCase();
    if (await isElementDisplayedByText(medicationEmptyTxt)) {
        throw new Error("❌ MEDICATION EMPTY alarm displayed [alerts.EMPTY_DRUG.alert_title_empty_drug] upper case");
    }
    logStepMessage("✅ MEDICATION EMPTY alarm NOT displayed [alerts.EMPTY_DRUG.alert_title_empty_drug] upper case");

    // Alarms ON: ID3 and ID6
    // Alarms: 2 2 1 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2
    await verifyLogsContain(apiBaseUrl, `Alarms: 2 2 1 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2||[Alarm] Priority ID: 6\`||[Alarm] DP disconnected alarm (high)\``, 3000, "error");
    logStepMessage("✅ Step 1");
}

async function step2(apiBaseUrl) {
    logStepMessage("▶️ Step 2");
    adbDecouplePump();
    await browser.pause(7000);

    await connectCartridgeToPump(apiBaseUrl);
    await browser.pause(2000);

    await waitForDisappear(buildSelectorByText(getCachedString('alerts.DP_DISCONNECTED.alert_title_pump_disconnected')), 10000);
    logStepMessage("✅ Alarm Cartridge disconnected disappeared");

    await checkAlarm(
        'alerts.FILL_PROCESS_INTERRUPTED.alert_title_fill_process_interrupted',
        'alerts.FILL_PROCESS_INTERRUPTED.alert_description_fill_process_interrupted',
        { expectedStr: 'ID 31 ' }
    );

    // Alarms ON: ID3 (ID6 cleared)
    // Alarms: 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2
    await verifyLogsContain(apiBaseUrl, `Alarms: 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2||[Alarm] Alarm cleared: 6\`||[Alarm] Priority ID: 3\``, 3000, "error");

    logStepMessage("✅ Step 2");
}

async function step3(apiBaseUrl, lowBattery124For100Percent) {
    logStepMessage("▶️ Step 3");
    await updateParameterValue(apiBaseUrl, "LOW_BATT", 24, lowBattery124For100Percent);
    await browser.pause(3000);

    await checkAlarm(
        'alerts.FILL_PROCESS_INTERRUPTED.alert_title_fill_process_interrupted',
        'alerts.FILL_PROCESS_INTERRUPTED.alert_description_fill_process_interrupted',
        { expectedStr: 'ID 31 ' }
    );

    const lowPumpBatteryTxt = getCachedString('alerts.LOW_PUMP_BATTERY.alert_title_pump_battery_low').toUpperCase();
    if (await isElementDisplayedByText(lowPumpBatteryTxt)) {
        throw new Error("❌ PUMP BATTERY IS LOW alarm displayed [alerts.LOW_PUMP_BATTERY.alert_title_pump_battery_low] upper case");
    }
    logStepMessage("✅ PUMP BATTERY IS LOW alarm NOT displayed [alerts.LOW_PUMP_BATTERY.alert_title_pump_battery_low] upper case");

    // [Alarm] Bat low (low): 120`
    // Alarms ON: ID3 and ID22
    // Alarms: 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 1 2 2 2 2 2
    await verifyLogsContain(apiBaseUrl, `Alarms: 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 1 2 2 2 2 2||[Alarm] Bat low (low)`, 3000, "error");
    logStepMessage("✅ Step 3");
}

async function step4(apiBaseUrl, lowBattery124For100Percent) {
    logStepMessage("▶️ Step 4");
    adbCouplePump();
    await browser.pause(5000);

    adbDisconnectWC();
    await browser.pause(2000);

    await disconnectCartridgeFromPump(apiBaseUrl);
    await browser.pause(5000);
    await updateParameterValue(apiBaseUrl, "CRITICALLY_LOW_BATT", 23, lowBattery124For100Percent);
    await browser.pause(5000);

    await waitForVisible(
        buildSelectorById('tvAlarmTitle'),
        'alerts.PUMP_BATTERY_CRITICAL.alert_title_pump_battery_critical',
        10000,
        300
    );

    logStepMessage("✅ Alert Pump battery is empty shown [alerts.PUMP_BATTERY_CRITICAL.alert_title_pump_battery_critical]");

    await checkAlarm(
        'alerts.PUMP_BATTERY_CRITICAL.alert_title_pump_battery_critical',
        'alerts.PUMP_BATTERY_CRITICAL.alert_description_pump_battery_critical',
        { expectedStr: 'ID 2 ' }
    );

    if (await isElementDisplayedById('tvThird')) {
        throw new Error("❌ ack button displayed");
    }
    logStepMessage("✅ ack button NOT displayed");

    // [Alarm] Priority ID: 2`
    // [Alarm] Bat empty (high): 120`
    // Alarms ON: ID2, ID3, ID6 and ID22
    // Alarms: 2 1 1 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 1 2 2 2 2 2
    await verifyLogsContain(apiBaseUrl, `Alarms: 2 1 1 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 1 2 2 2 2 2||[Alarm] Priority ID: 2\`||[Alarm] Bat empty (high)`, 3000, "error");
    logStepMessage("✅ Step 4");
}

async function step5(apiBaseUrl, lowBattery92For5Percent) {
    logStepMessage("▶️ Step 5");
    await updateParameterValue(apiBaseUrl, "CRITICALLY_LOW_BATT", 23, lowBattery92For5Percent);

    await connectCartridgeToPump(apiBaseUrl);
    await browser.pause(5000);

    adbConnectWC();
    await browser.pause(5000);

    await waitForDisappear(buildSelectorByText(getCachedString('alerts.PUMP_BATTERY_CRITICAL.alert_title_pump_battery_critical')), 10000);
    logStepMessage("✅ Alarm Pump battery is empty disappeared");

    // [Alarm] Alarm cleared: 2, Bat: 124`
    // [Alarm] Alarm cleared: 6`
    // Alarms ON: ID3 and ID22 (ID2 and ID6 cleared)
    // Alarms: 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 1 2 2 2 2 2
    await verifyLogsContain(apiBaseUrl, `Alarms: 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 1 2 2 2 2 2||Alarm cleared: 2||Alarm cleared: 6\``, 3000, "error");
    logStepMessage("✅ Step 5");
}

async function step6(apiBaseUrl) {
    logStepMessage("▶️ Step 6");
    const nextBtn = await getElementById('tvSecond', 'common.cmn_text_next');
    await nextBtn.click();
    await browser.pause(1000);

    await getElementById('tvHeaderTitle', 'screens.PREPARE_FOR_FILLING.prepare_for_filling_screen');

    adbDecouplePump();
    await browser.pause(7000);

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

    // Alarms ON: ID3 and ID22
    // Alarms: 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 1 2 2 2 2 2
    await verifyLogsContain(apiBaseUrl, `Alarms: 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 1 2 2 2 2 2`, 3000, "error");
    logStepMessage("✅ Step 6");
}

async function step7(apiBaseUrl) {
    logStepMessage("▶️ Step 7");
    await disconnectCartridgeFromPump(apiBaseUrl);

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

    // [Alarm] Priority ID: 6`
    // [Alarm] DP disconnected alarm (high)`
    // Alarms ON: ID3, ID6 and ID22
    // Alarms: 2 2 1 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 1 2 2 2 2 2
    await verifyLogsContain(apiBaseUrl, `Alarms: 2 2 1 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 1 2 2 2 2 2||[Alarm] Priority ID: 6\`||[Alarm] DP disconnected alarm (high)\``, 3000, "error");
    logStepMessage("✅ Step 7");
}

async function step8(apiBaseUrl) {
    logStepMessage("▶️ Step 8");
    await connectCartridgeToPump(apiBaseUrl);
    await browser.pause(5000);

    await waitForDisappear(buildSelectorByText(getCachedString('alerts.DP_DISCONNECTED.alert_title_pump_disconnected')), 10000);
    logStepMessage("✅ Alarm Cartridge disconnected disappeared");

    await checkAlarm(
        'alerts.FILL_PROCESS_INTERRUPTED.alert_title_fill_process_interrupted',
        'alerts.FILL_PROCESS_INTERRUPTED.alert_description_fill_process_interrupted',
        { expectedStr: 'ID 31 ' }
    );
    // [Alarm] Alarm cleared: 6`
    // [Alarm] Priority ID: 3`
    // Alarms ON: ID3 and ID22 (ID6 cleared)
    // Alarms: 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 1 2 2 2 2 2
    await verifyLogsContain(apiBaseUrl, `Alarms: 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 1 2 2 2 2 2||[Alarm] Alarm cleared: 6\`||[Alarm] Priority ID: 3\``, 3000, "error");
    logStepMessage("✅ Step 8");
}

async function step9() {
    logStepMessage("▶️ Step 9");
    adbCouplePump();
    await browser.pause(5000);
    await waitForDisappear(buildSelectorByText(getCachedString('alerts.FILL_PROCESS_INTERRUPTED.alert_title_fill_process_interrupted')), 10000);
    logStepMessage("✅ Alarm Process interrupted disappeared");
    logStepMessage("✅ Step 9");
}

async function step10(apiBaseUrl) {
    logStepMessage("▶️ Step 10");
    const startFillingBtn = await getElementById('tvSecond', 'common.cmn_start_filling');
    await startFillingBtn.click();

    await getElementById('tvHeaderTitle', 'screens.FILLING_MEDICATION.filling_medication_ftu');

    // 30 seconds filling
    await waitWithHeartbeat(30000);

    // Alarms OFF: ID3 cleared
    // Alarms: 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2
    await verifyLogsContain(apiBaseUrl, `Alarms: 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2||[Alarm] Alarm cleared: 3\``, 3000, "error");
    logStepMessage("✅ Step 10");
}

async function step11(apiBaseUrl) {
    logStepMessage("▶️ Step 11");
    await getElementById('progressFilingMedicine');
    await browser.pause(2000);

    adbDecouplePump();
    await browser.pause(7000);

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
    // [Alarm] Priority ID: 8\`
    // [Alarm] Fill process interrupted\`
    // Alarms ON: ID8
    // Alarms: 2 2 2 2 2 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2
    await verifyLogsContain(apiBaseUrl, `Alarms: 2 2 2 2 2 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2||[Alarm] Priority ID: 8\`||[Alarm] Fill process interrupted\``, 8000, "error");
    logStepMessage("✅ Step 11");
}

async function step12() {
    logStepMessage("▶️ Step 12");
    adbCouplePump();
    await browser.pause(5000);

    await waitForDisappear(buildSelectorByText(getCachedString('alerts.FILL_PROCESS_INTERRUPTED.alert_title_fill_process_interrupted')), 10000);
    logStepMessage("✅ Alarm Process interrupted disappeared");

    await getElementById('progressFilingMedicine');
    await browser.pause(3000);
    logStepMessage("✅ Step 12");
}

async function step13(apiBaseUrl) {
    logStepMessage("▶️ Step 13");
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

    // Alarms ON: ID6
    // Alarms: 2 2 2 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2
    await verifyLogsContain(apiBaseUrl, `Alarms: 2 2 2 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2||[Alarm] Priority ID: 6\`||[Alarm] DP disconnected alarm (high)\``, 3000, "error");
    logStepMessage("✅ Step 13");
}

async function step14(apiBaseUrl) {
    logStepMessage("▶️ Step 14");
    await updateParameterValue(apiBaseUrl, "MAX_ALLOWED_TEMPERATURE", 34, 10);

    await waitForVisible(
        buildSelectorById('tvAlarmTitle'),
        'alerts.PUMP_MALFUNCTION.alert_title_pump_malfunction',
        10000,
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

    // [Alarm] Priority ID: 1`
    // [Alarm] MAL (high)`
    // Alarms ON: ID1 and ID6
    // Alarms: 1 2 2 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2
    await verifyLogsContain(apiBaseUrl, `Alarms: 1 2 2 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2||[Alarm] Priority ID: 1\`||[Alarm] MAL (high)\``, 3000, "error");
    logStepMessage("✅ Step 14");
}

async function step15() {
    logStepMessage("▶️ Step 15");
    let audioBtn = await getElementById('tvThird');
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

    audioBtn = await getElementById('tvDismissAlert');
    if (await audioBtn.isDisplayed()) {
        const text = await audioBtn.getText();
        if (text === getCachedString('common.text_pause_audio_ack')) {
            logStepMessage("✅ Already paused");
        } else
            if (text === getCachedString('common.text_pause_audio')) {
                throw new Error("❌ Audio button NOT paused yet");
            } else {
                throw new Error(`❌ Unexpected text: ${text}`);
            }
    } else {
        throw new Error("❌ Audio button not displayed");
    }
    logStepMessage("✅ Step 15");
}