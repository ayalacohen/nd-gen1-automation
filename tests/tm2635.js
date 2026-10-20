// helpers
import { adbCouplePump, adbDecouplePump, adbDownloadCSLogs } from '../helpers/adbHelpers.js';
import { clearPumpLogs, connectCartridgeToPump, connectTwico, disconnectCartridgeFromPump, disconnectTwico, pressPumpButton, updateParameterValue, verifyLogsContain } from '../helpers/apiHelpers.js';
import { verifyStartFillingAfterNoResetOfLastFillingPercentage } from '../helpers/dbHelpers.js';
import { activateRegimenAndStart, pairPump, resetToFTU } from '../helpers/preConditionsHelpers.js';
import { buildSelectorById, checkAlert, csClearCSLogs, getElementById, pumpBatteryChargingOrConnectTubes, waitForDisappear, waitForVisible, waitWithHeartbeat } from '../helpers/uiHelpers.js';

import { loadStrings } from '../helpers/i18n.js';
import { logStep, logStepMessage } from '../helpers/logger.js';

// config
import config from '../helpers/config.js';
import { flowState, saveState } from '../helpers/flowState.js';

import allureReporter from '@wdio/allure-reporter';

/*
Precondition:
Use VnV pump version ( Device SW Shared\0 Releases\0 Version H\0 Formal Version H builds\Pump FW\H.1.0\H.1.0_VnV)

Perform Pump FTU reset via TwikoGUI

Complete FTU flow, Pump and CS are paired and connected

CS shows Home screen with Medication is empty” alarm

Set “Treatment cycle ended” parameter to 5 minutes - via TwikoGUI
*/
const testKey = "TM-2635";
let preconditionsPassed = false;

describe(`${testKey} - Application behaviour in case of pump doesn't reset the last filling status peresentage - pump VnV version`, () => {
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

            await logStep('Update pump parameters to reduce filling time andtreatement cycle ended to 5mn', async () => {
                await updateParameterValue(apiBaseUrl, "VIAL_DETECT_MIN_CURRENT_DIFF_FOR_SUCCESS_DEFAULT", 8, 0);

                await updateParameterValue(apiBaseUrl, "VIAL_DETECT_MIN_CURRENT_SAMPLES_PER_MOTOR_BURST_DEFAULT", 9, 100);

                await updateParameterValue(apiBaseUrl, "ENCODER_FILLING_HARD_STOP_VALUE", 14, 55000);

                await updateParameterValue(apiBaseUrl, "FILING_MIN_ENCODER_FOR_REMOVE_AIR_STAGE", 53, 10000);

                await updateParameterValue(apiBaseUrl, "FILLING_STEP_2_MIN_DRUG_VOLUME_ENC", 4, 0);

                await updateParameterValue(apiBaseUrl, "TREATMENT_CYCLE_ENDED_TH_SEC", 22, 300);

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

        await logStep('Step 1 - Set VALIDATION to 282, prepare treatment and start delivery', async () => {
            await step1(apiBaseUrl);
        });

        await logStep('Step 2 - Start new prepare treatment, start filling', async () => {
            await step2(apiBaseUrl);
        });

        await logStep('Step 3 - Wait until filling is completed', async () => {
            await step3();
        });

        await logStep('Step 4 - Complete treatment preparation and start delivery', async () => {
            await step4(apiBaseUrl);
        });

        await logStep('Step 5 - Check CS Logs', async () => {
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
    await updateParameterValue(apiBaseUrl, "VALIDATION", 1012, 282);

    await startPrepareTreatment(apiBaseUrl);

    const startFillingBtn = await getElementById('tvSecond', 'common.cmn_start_filling');

    await browser.waitUntil(async () => await startFillingBtn.isEnabled(), {
        timeout: 5000,
        timeoutMsg: "❌ START FILLING did not enable"
    });

    await startFillingBtn.click();
    await browser.pause(1000);

    await getElementById('tvHeaderTitle', 'screens.FILLING_MEDICATION.filling_medication_ftu');

    await getElementById('progressFilingMedicine');

    await waitForDisappear(buildSelectorById('progressFilingMedicine'), 120000);

    await getElementById('tvHeaderTitle', 'screens.REMOVE_VIAL_ADAPTERS.remove_vial_adapters_title');

    let nextBtn = await getElementById('tvSecond', 'common.cmn_text_next');
    await nextBtn.click();
    await browser.pause(500);

    await getElementById('tvHeaderTitle', 'screens.CONNECT_TUBING_SCREEN.connect_tubing_title');

    const primeTubbingBtn = await getElementById('tvSecond', 'screens.CONNECT_TUBING_SCREEN.connect_tubing_prime_button');
    await primeTubbingBtn.click();
    await browser.pause(1000);

    await getElementById('tvHeaderTitle', 'screens.PREPARE_INFUSION_SITES.screen_prepare_infusion_sites_title');

    nextBtn = await getElementById('tvFillDetailNext', 'common.cmn_text_next');
    await nextBtn.click();
    await browser.pause(1000);

    await getElementById('tvHeaderTitle', 'screens.INSERT_CANNULA.insert_cannula_screen_title');

    nextBtn = await getElementById('tvFillDetailNext', 'common.cmn_text_next');
    await nextBtn.click();
    await browser.pause(1000);

    await pumpBatteryChargingOrConnectTubes();

    await getElementById('tvHeaderTitle', 'screens.CONNECT_TUBES.connect_tubes_screen_title');

    nextBtn = await getElementById('tvFillDetailNext', 'common.cmn_text_next');
    await nextBtn.click();
    await browser.pause(1000);

    await getElementById('tvHeaderTitle', 'screens.PUMP_READY.remove_pump_screen_title');

    adbCouplePump();
    await browser.pause(2000);

    adbDecouplePump();
    await browser.pause(7000);

    await clearPumpLogs(apiBaseUrl);

    await getElementById('tvHeaderTitle', 'screens.PUMP_READY.pump_ready_screen_title');

    await pressPumpButton(apiBaseUrl);

    await getElementById('tvHeaderTitle', 'screens.HOME.home_title');

    // med stop soon id 23
    await waitForVisible(
        buildSelectorById('tvAlertTitle'),
        'alerts.LOW_DRUG_VOLUME.alert_title_pump_cartridge_low_volume',
        15000,
        300,
        true
    );

    logStepMessage("✅ Alert MEDICATION DELIVERY WILL STOP SOON shown [alerts.LOW_DRUG_VOLUME.alert_title_pump_cartridge_low_volume] upper case");

    logStepMessage("▶️ Waiting for 5mn to reach end of treatment");
    await waitWithHeartbeat(300000);

    await waitForVisible(
        buildSelectorById('tvAlertTitle'),
        'alerts.DP_EXPIRED_NEED_REPLACEMENT.alert_title_pump_medication_expired',
        10000,
        300,
        true
    );

    logStepMessage("✅ Alert TREATMENT CYCLE ENDED shown [alerts.DP_EXPIRED_NEED_REPLACEMENT.alert_title_pump_medication_expired] upper case");

    await checkAlert(
        'alerts.DP_EXPIRED_NEED_REPLACEMENT.alert_title_pump_medication_expired',
        'alerts.DP_EXPIRED_NEED_REPLACEMENT.alert_description_pump_medication_expired',
        {
            localizedTemplateKey: 'alerts.STRINGS_FOR_ALERT_TYPES.alert_info_default',
            requiredId: '4'
        }
    );

    await waitWithHeartbeat(60000);

    // Alarms ON: ID21 and ID4  4 treatment cycle ended  - 21 treatment paused
    // Alarms: 2 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 1 2 2 2 2 2 2
    // [Alarm] Treatment cycle ended (high)\`
    await verifyLogsContain(apiBaseUrl, `Alarms: 2 2 2 1 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 1 2 2 2 2 2 2||[Alarm] Priority ID: 4\`||[Alarm] Treatment cycle ended (high)\``, 0, "error");

    logStepMessage("✅ Step 1");
}

async function step2(apiBaseUrl) {
    logStepMessage("▶️ Step 2");
    adbCouplePump();
    await browser.pause(7000);

    await csClearCSLogs();

    await startPrepareTreatment(apiBaseUrl);

    const startFillingBtn = await getElementById('tvSecond', 'common.cmn_start_filling');

    await browser.waitUntil(async () => await startFillingBtn.isEnabled(), {
        timeout: 5000,
        timeoutMsg: "❌ START FILLING did not enable"
    });

    await startFillingBtn.click();
    await browser.pause(1000);

    await getElementById('tvHeaderTitle', 'screens.FILLING_MEDICATION.filling_medication_ftu');

    await waitWithHeartbeat(90000);

    await verifyLogsContain(apiBaseUrl, `[WDT] Start\`||[RST] WDTst\`||[WDT] End\`||[BIT] ALL Tst PASS\`||[FSM] New state: Filling\`||[FIL] started event\``, 3000, "error");
    logStepMessage("✅ Step 2");
}

async function step3() {
    logStepMessage("▶️ Step 3");
    await waitForDisappear(buildSelectorById('progressFilingMedicine'), 120000);

    await getElementById('tvHeaderTitle', 'screens.REMOVE_VIAL_ADAPTERS.remove_vial_adapters_title');

    let nextBtn = await getElementById('tvSecond', 'common.cmn_text_next');
    await nextBtn.click();
    await browser.pause(500);

    await getElementById('tvHeaderTitle', 'screens.CONNECT_TUBING_SCREEN.connect_tubing_title');

    const primeTubbingBtn = await getElementById('tvSecond', 'screens.CONNECT_TUBING_SCREEN.connect_tubing_prime_button');
    await primeTubbingBtn.click();
    await browser.pause(1000);

    await getElementById('tvHeaderTitle', 'screens.PREPARE_INFUSION_SITES.screen_prepare_infusion_sites_title');

    nextBtn = await getElementById('tvFillDetailNext', 'common.cmn_text_next');
    await nextBtn.click();
    await browser.pause(1000);

    await getElementById('tvHeaderTitle', 'screens.INSERT_CANNULA.insert_cannula_screen_title');

    nextBtn = await getElementById('tvFillDetailNext', 'common.cmn_text_next');
    await nextBtn.click();
    await browser.pause(1000);

    await getElementById('tvHeaderTitle', 'screens.CONNECT_TUBES.connect_tubes_screen_title');
    logStepMessage("✅ Step 3");
}
async function step4(apiBaseUrl) {
    logStepMessage("▶️ Step 4");

    const nextBtn = await getElementById('tvFillDetailNext', 'common.cmn_text_next');
    await nextBtn.click();
    await browser.pause(1000);

    await getElementById('tvHeaderTitle', 'screens.PUMP_READY.remove_pump_screen_title');

    adbCouplePump();
    await browser.pause(2000);

    adbDecouplePump();
    await browser.pause(7000);

    await getElementById('tvHeaderTitle', 'screens.PUMP_READY.pump_ready_screen_title');

    await pressPumpButton(apiBaseUrl);

    await getElementById('tvHeaderTitle', 'screens.HOME.home_title');

    await waitForVisible(
        buildSelectorById('tvAlertTitle'),
        'alerts.LOW_DRUG_VOLUME.alert_title_pump_cartridge_low_volume',
        15000,
        300,
        true
    );

    logStepMessage("✅ Alert MEDICATION DELIVERY WILL STOP SOON shown [alerts.LOW_DRUG_VOLUME.alert_title_pump_cartridge_low_volume] upper case");

    await getElementById('tvThird', 'screens.HOME.home_screen_action_pump_status');

    logStepMessage("▶️ Waiting for 90s to check delivery");
    await waitWithHeartbeat(90000);

    logStepMessage("✅ Step 4");
}

async function step5() {
    logStepMessage("▶️ Step 5");
    const dbFile = "db/2635_5_control_station_logs.db";
    adbDownloadCSLogs(dbFile);

    verifyStartFillingAfterNoResetOfLastFillingPercentage(dbFile);
    logStepMessage("✅ Step 5");
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
}
