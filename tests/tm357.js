// helpers
import { adbConnectWC, adbCouplePump, adbDecouplePump, adbDisconnectWC, adbUpdateConfigFilesAndMainSn } from '../helpers/adbHelpers.js';
import { clearPumpLogs, connectCartridgeToPump, connectTwico, disconnectCartridgeFromPump, disconnectTwico, updateParameterValue, verifyLogsContain } from '../helpers/apiHelpers.js';
import { activateRegimenAndStart, pairPump, resetToFTU } from '../helpers/preConditionsHelpers.js';
import { buildSelectorById, buildSelectorByText, checkAlarm, checkAlert, getCachedString, getElementById, isElementDisplayedById, waitForDisappear, waitForVisible, waitWithHeartbeat } from '../helpers/uiHelpers.js';

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
const testKey = "TM-357";
let preconditionsPassed = false;

describe(`${testKey} -  Alarm masking CS:  Allowed alarm in Filling (Priming) state`, () => {
    const { apiBaseUrl, globalParams } = config;
    const { pumpName, portName, lowBattery124For100Percent } = { ...globalParams };

    const apkLocalConfigFile = "adb-config-files/HCP_cs_config.json";
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

            await logStep('Update HCP config files and relaunch', async () => {
                if (flowState.lastCategory == "HCP_1") {
                    logStepMessage("Skipping these update config steps...");
                } else {
                    await adbUpdateConfigFilesAndMainSn(apkLocalConfigFile, fwLocalConfigFile);
                    flowState.lastCategory = "HCP_1";
                }
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

        await logStep('Step 1 - Simulate low pump battery', async () => {
            await step1(apiBaseUrl, lowBattery124For100Percent);
        });

        await logStep('Step 2 - Start filling', async () => {
            await step2(apiBaseUrl);
        });

        await logStep('Step 3 - Complete filling, Decouple the pump on "Connect infusion sets" screen', async () => {
            await step3(apiBaseUrl);
        });

        await logStep('Step 4 - Disconnect the cartridge', async () => {
            await step4(apiBaseUrl);
        });

        await logStep('Step 5 - Connect the cartridge', async () => {
            await step5(apiBaseUrl);
        });

        await logStep('Step 6 - Couple the pump, Disable CS WC and simulate critically low battery', async () => {
            await step6(apiBaseUrl, lowBattery124For100Percent);
        });

        await logStep('Step 7 - Enable CS WC and simulate malfunction updating max allowed temperature', async () => {
            await step7(apiBaseUrl);
        });

        await logStep('Step 8 - Press on "Pause audio" button', async () => {
            await step8();
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
    await updateParameterValue(apiBaseUrl, "LOW_BATT", 24, lowBattery124For100Percent);
    await browser.pause(3000);

    if (await isElementDisplayedById('tvAlarmTitle')) {
        throw new Error("❌ Alarm shown on CS");
    }
    logStepMessage("✅ No alarm shown on CS");

    // Alarms ON: ID3 and ID22
    // Alarms: 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 1 2 2 2 2 2
    await verifyLogsContain(apiBaseUrl, `Alarms: 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 1 2 2 2 2 2||[Alarm] Bat low (low)`, 5000, "error");
    logStepMessage("✅ Step 1");
}

async function step2(apiBaseUrl) {
    logStepMessage("▶️ Step 2");
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

    await startFillingBtn.click();

    await getElementById('tvHeaderTitle', 'screens.FILLING_MEDICATION.filling_medication_ftu');

    // 30 seconds filling
    await waitWithHeartbeat(30000);

    // Alarms OFF: ID3 cleared
    // Alarms: 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2
    await verifyLogsContain(apiBaseUrl, `Alarms: 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2||[Alarm] Alarm cleared: 3\``, 3000, "error");
    logStepMessage("✅ Step 2");
}

async function step3(apiBaseUrl) {
    logStepMessage("▶️ Step 3");
    const progressFilingMedicine = await getElementById('progressFilingMedicine');

    await waitForDisappear(buildSelectorById('progressFilingMedicine'), 120000);

    await getElementById('tvHeaderTitle', 'screens.REMOVE_VIAL_ADAPTERS.remove_vial_adapters_title');

    const nextBtn = await getElementById('tvSecond', 'common.cmn_text_next');
    await nextBtn.click();
    await browser.pause(1000);

    await getElementById('tvHeaderTitle', 'screens.CONNECT_TUBING_SCREEN.connect_tubing_title');
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

    // Alarms ON: ID8
    // Alarms: 2 2 2 2 2 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2
    await verifyLogsContain(apiBaseUrl, `Alarms: 2 2 2 2 2 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2||[Alarm] Priority ID: 8\`||[Alarm] Fill process interrupted\``, 3000, "error");
    logStepMessage("✅ Step 3");
}

async function step4(apiBaseUrl) {
    logStepMessage("▶️ Step 4");
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

    // Alarms ON: ID6 and ID8
    // Alarms: 2 2 2 2 2 1 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2
    await verifyLogsContain(apiBaseUrl, `Alarms: 2 2 2 2 2 1 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2||[Alarm] Priority ID: 6\`||[Alarm] DP disconnected alarm (high)\``, 3000, "error");
    logStepMessage("✅ Step 4");
}

async function step5(apiBaseUrl) {
    logStepMessage("▶️ Step 5");
    await connectCartridgeToPump(apiBaseUrl);
    await browser.pause(2000);

    await waitForDisappear(buildSelectorByText(getCachedString('alerts.DP_DISCONNECTED.alert_title_pump_disconnected')), 10000);
    logStepMessage("✅ Alarm Cartridge disconnected disappeared");

    await checkAlarm(
        'alerts.FILL_PROCESS_INTERRUPTED.alert_title_fill_process_interrupted',
        'alerts.FILL_PROCESS_INTERRUPTED.alert_description_fill_process_interrupted',
        { expectedStr: 'ID 31 ' }
    );

    // Alarms ON: ID8 (ID6 cleared)
    // Alarms: 2 2 2 2 2 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2
    await verifyLogsContain(apiBaseUrl, `Alarms: 2 2 2 2 2 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2||[Alarm] Alarm cleared: 6\``, 3000, "error");
    logStepMessage("✅ Step 5");
}

async function step6(apiBaseUrl, lowBattery124For100Percent) {
    logStepMessage("▶️ Step 6");
    adbCouplePump();
    await browser.pause(7000);

    adbDisconnectWC();
    await browser.pause(2000);

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

    // [Alarm] Priority ID: 2\`
    // [Alarm] Bat empty (high)
    // Alarms ON: ID2 and ID8
    // Alarms: 2 1 2 2 2 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2
    await verifyLogsContain(apiBaseUrl, `Alarms: 2 1 2 2 2 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2||[Alarm] Priority ID: 2\`||[Alarm] Bat empty (high)`, 3000, "error");

    logStepMessage("✅ Step 6");
}

async function step7(apiBaseUrl) {
    logStepMessage("▶️ Step 7");
    adbConnectWC();
    await browser.pause(2000);

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
    // Alarms ON: ID1 (ID2 and ID8 cleared)
    // Alarms: 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2
    await verifyLogsContain(apiBaseUrl, `Alarms: 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2||[Alarm] Priority ID: 1\`||[Alarm] MAL (high)\``, 3000, "error");
    logStepMessage("✅ Step 7");
}
async function step8() {
    logStepMessage("▶️ Step 8");
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
    logStepMessage("✅ Step 8");
}