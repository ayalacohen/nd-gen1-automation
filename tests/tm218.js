// helpers
import { clearPumpLogs, connectCartridgeToPump, connectTwico, disconnectCartridgeFromPump, disconnectTwico, updateParameterValue, verifyLogsContain, vibratorOnOff } from '../helpers/apiHelpers.js';
import { activateRegimenAndStart, pairPump, resetToFTU } from '../helpers/preConditionsHelpers.js';
import { buildSelectorById, checkAlarm, getCachedString, getElementById, isElementDisplayedByText, waitForDisappear, waitForScreenWithHeartbeat, waitWithHeartbeat } from '../helpers/uiHelpers.js';

import { loadStrings } from '../helpers/i18n.js';
import { logStep, logStepMessage } from '../helpers/logger.js';

// config
import config from '../helpers/config.js';
import { flowState, saveState } from '../helpers/flowState.js';

import allureReporter from '@wdio/allure-reporter';
import { adbDecouplePump, adbUpdateConfigFilesAndMainSn } from '../helpers/adbHelpers.js';

/*
Precondition:
Pump is in the CS cradle

Cartridge isn’t attached to the pump

Plungers are on the top of the cartridge

Pump battery level is 20%

Pump and CS after FTU, in “Medication is empty” alarm

Using Nerudoerm UI tool decrease threshold for Process Incomplete notification to 2 min
*/
const testKey = "TM-218";
let preconditionsPassed = false;

describe(`${testKey} - "Process incomplete" notification during treatment preparation`, () => {
    const { apiBaseUrl, globalParams } = config;
    const { pumpName, portName } = { ...globalParams };

  const apkLocalConfigFile = "adb-config-files/HCP_ALARM_120_cs_config.json";
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

            await logStep('Update HCP_120 config files and relaunch', async () => {
                if (flowState.lastCategory == "HCP_120_1") {
                    logStepMessage("Skipping these update config steps...");
                } else {
                    await adbUpdateConfigFilesAndMainSn(apkLocalConfigFile, fwLocalConfigFile);
                    flowState.lastCategory = "HCP_120_1";
                }
            });

            await logStep('Connect TWICO', async () => {
                await connectTwico(apiBaseUrl, portName);
            });

            await logStep('Reset to FTU', async () => {
                await resetToFTU(apiBaseUrl);
            });

            // await logStep('Vibrator On/Off for 40 mn to lower pump battery voltage', async () => {
            //     adbDecouplePump();
            //     await vibratorOnOff(apiBaseUrl, 1);
            //     // await waitWithHeartbeat(3600000); // 1 h
            //     // await waitWithHeartbeat(2700000); // 45 mn
            //     await waitWithHeartbeat(2400000); // 40 mn
            //     await vibratorOnOff(apiBaseUrl, 0);
            // });

            await logStep('Pair pump', async () => {
                await pairPump(pumpName);
            });

            await logStep('Activate regimen and start (until medication empty)', async () => {
                await activateRegimenAndStart();
            });

            await logStep('Update pump parameters to reduce filling time', async () => {
                await updateParameterValue(apiBaseUrl, "VIAL_DETECT_MIN_CURRENT_DIFF_FOR_SUCCESS_DEFAULT", 8, 0);

                await updateParameterValue(apiBaseUrl, "VIAL_DETECT_MIN_CURRENT_SAMPLES_PER_MOTOR_BURST_DEFAULT", 9, 100);

                await updateParameterValue(apiBaseUrl, "ENCODER_FILLING_HARD_STOP_VALUE", 14, 220000);          // 55000 * 4

                await updateParameterValue(apiBaseUrl, "FILING_MIN_ENCODER_FOR_REMOVE_AIR_STAGE", 53, 40000);   // 10000 * 4

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

        await logStep('Step 1 - Press on "Prepare treatment" button', async () => {
            await step1();
        });

        await logStep('Step 2 - Stay on "Dispose of used materials" for 2 mins', async () => {
            await step2();
        });

        await logStep('Step 3 - Stay on "Dispose of used materials" for 2 mins', async () => {
            await step3();
        });

        await logStep('Step 4 - Continue treatment preparation flow and stay on "Connect a new cartridge" screen for 2 min', async () => {
            await step4();
        });

        await logStep('Step 5 - Press on "Resume process" button', async () => {
            await step5();
        });

        await logStep('Step 6 - Continue treatment preparation flow and stay on "Insert new vials" screen for 2 min', async () => {
            await step6(apiBaseUrl);
        });

        await logStep('Step 7 - Close "Process incomplete" message, Continue treatment preparation flow and stay on "Fill medication" screen for 2 min', async () => {
            await step7();
        });

        await logStep('Step 8 - Close "Process incomplete" message and continue treatment preparation flow, Complete filling flow', async () => {
            await step8();
        });

        await logStep('Step 9 - Close the message and continue with treatment preparation On "Connect infusion sets" screen wait for 2 min', async () => {
            await step9();
        });

        await logStep('Step 10 - Close the message and complete priming, After priming stay on "Prepare infusion sites" screen for 2 min', async () => {
            await step10();
        });

        await logStep('Step 11 - Close the message, Continue with treatment preparation On "Insert cannulas" screen wait for 2 min', async () => {
            await step11();
        });

        await logStep('Step 12 - Close the message, Press "Next" on "Insert cannulas" screen On "Pump battery charging" screen wait for 2 min', async () => {
            await step12();
        });

        await logStep('Step 13 - Close the message, Wait till app moves to the "Connect tubes to cannulas" screen, Wait for 2 min on "Connect tubes to cannulas" screen', async () => {
            await step13();
        });

        await logStep('Step 14 - Close the notification, Press "Next" button on "Connect tubes to cannulas" screen, Wait for 2 min on "Remove pump" screen', async () => {
            await step14();
        });

        await logStep('Step 15 - Close the notification, Decouple the pump, On "Start medication delivery" screen wait for 2 min', async () => {
            await step15(apiBaseUrl);
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
    const prepareTreatment = await getElementById('tvSecond', 'common.cmn_text_start_treatment');
    await prepareTreatment.click();
    await browser.pause(500);

    await getElementById('tvHeaderTitle', 'screens.REMOVE_OLD_DISPOSABLE.remove_old_disposable_title');
    logStepMessage("✅ Step 1");
}

async function step2() {
    logStepMessage("▶️ Step 2");
    await waitWithHeartbeat(120000);

    await checkAlarm(
        'alerts.FILL_PROCESS_INCOMPLETE.alert_title_fill_process_incomplete',
        'alerts.FILL_PROCESS_INCOMPLETE.alert_description_fill_process_incomplete',
        { expectedStr: 'ID 32 ' }
    );

    await getElementById('tvThird', 'common.cmn_resume_process');
    logStepMessage("✅ Step 2");
}

async function step3() {
    logStepMessage("▶️ Step 3");
    const resumeProcessBtn = await getElementById('tvThird', 'common.cmn_resume_process');
    await resumeProcessBtn.click();
    await browser.pause(100);

    await waitForDisappear(buildSelectorById('tvAlarmTitle'));
    logStepMessage("✅ Notification disappeared");
    logStepMessage("✅ Step 3");
}

async function step4() {
    logStepMessage("▶️ Step 4");
    const fillDetailNextBtn = await getElementById('tvFillDetailNext', 'common.cmn_text_next');
    await fillDetailNextBtn.click();
    await browser.pause(1000);

    await getElementById('tvHeaderTitle', 'screens.CONNECT_A_NEW_CARTRIDGE.connect_new_cartridge_title');

    await waitWithHeartbeat(120000);

    await checkAlarm(
        'alerts.FILL_PROCESS_INCOMPLETE.alert_title_fill_process_incomplete',
        'alerts.FILL_PROCESS_INCOMPLETE.alert_description_fill_process_incomplete',
        { expectedStr: 'ID 32 ' }
    );

    await getElementById('tvThird', 'common.cmn_resume_process');
    logStepMessage("✅ Step 4");
}

async function step5() {
    logStepMessage("▶️ Step 5");
    const resumeProcessBtn = await getElementById('tvThird', 'common.cmn_resume_process');
    await resumeProcessBtn.click();
    await browser.pause(100);

    await waitForDisappear(buildSelectorById('tvAlarmTitle'));
    logStepMessage("✅ Notification disappeared");
    logStepMessage("✅ Step 5");
}

async function step6(apiBaseUrl) {
    logStepMessage("▶️ Step 6");
    await disconnectCartridgeFromPump(apiBaseUrl);
    await browser.pause(1000);

    await connectCartridgeToPump(apiBaseUrl);

    const nextBtn = await getElementById('tvSecond', 'common.cmn_text_next');
    await browser.waitUntil(async () => await nextBtn.isEnabled(), {
        timeout: 10000,
        timeoutMsg: "❌ NEXT did not enable"
    });

    await nextBtn.click();
    await browser.pause(1000);

    await getElementById('tvHeaderTitle', 'screens.CONNECT_VIAL.connect_vial_screen_title');
    await waitWithHeartbeat(120000);

    await checkAlarm(
        'alerts.FILL_PROCESS_INCOMPLETE.alert_title_fill_process_incomplete',
        'alerts.FILL_PROCESS_INCOMPLETE.alert_description_fill_process_incomplete',
        { expectedStr: 'ID 32 ' }
    );

    await getElementById('tvThird', 'common.cmn_resume_process');
    logStepMessage("✅ Step 6");
}

async function step7() {
    logStepMessage("▶️ Step 7");
    const resumeProcessBtn = await getElementById('tvThird', 'common.cmn_resume_process');
    await resumeProcessBtn.click();
    await browser.pause(100);

    await waitForDisappear(buildSelectorById('tvAlarmTitle'));
    logStepMessage("✅ Notification disappeared");

    const nextBtn = await getElementById('tvSecond', 'common.cmn_text_next');
    await nextBtn.click();
    await browser.pause(1000);

    await getElementById('tvHeaderTitle', 'screens.PREPARE_FOR_FILLING.prepare_for_filling_screen');

    await waitWithHeartbeat(120000);

    await checkAlarm(
        'alerts.FILL_PROCESS_INCOMPLETE.alert_title_fill_process_incomplete',
        'alerts.FILL_PROCESS_INCOMPLETE.alert_description_fill_process_incomplete',
        { expectedStr: 'ID 32 ' }
    );

    await getElementById('tvThird', 'common.cmn_resume_process');
    logStepMessage("✅ Step 7");
}

async function step8() {
    logStepMessage("▶️ Step 8");
    let resumeProcessBtn = await getElementById('tvThird', 'common.cmn_resume_process');
    await resumeProcessBtn.click();
    await browser.pause(100);

    await waitForDisappear(buildSelectorById('tvAlarmTitle'));
    logStepMessage("✅ Notification disappeared");

    const startFillingBtn = await getElementById('tvSecond', 'common.cmn_start_filling');
    await browser.waitUntil(async () => await startFillingBtn.isEnabled(), {
        timeout: 5000,
        timeoutMsg: "❌ START FILLING did not enable"
    });

    await startFillingBtn.click();
    await browser.pause(1000);

    await getElementById('tvHeaderTitle', 'screens.FILLING_MEDICATION.filling_medication_ftu');

    await waitForDisappear(buildSelectorById('progressFilingMedicine'), 420000);

    await checkAlarm(
        'alerts.FILL_PROCESS_INCOMPLETE.alert_title_fill_process_incomplete',
        'alerts.FILL_PROCESS_INCOMPLETE.alert_description_fill_process_incomplete',
        { expectedStr: 'ID 32 ' }
    );

    await getElementById('tvThird', 'common.cmn_resume_process');

    logStepMessage("✅ Step 8");
}

async function step9() {
    logStepMessage("▶️ Step 9");
    const resumeProcessBtn = await getElementById('tvThird', 'common.cmn_resume_process');
    await resumeProcessBtn.click();
    await browser.pause(100);

    await waitForDisappear(buildSelectorById('tvAlarmTitle'));
    logStepMessage("✅ Notification disappeared");

    await getElementById('tvHeaderTitle', 'screens.REMOVE_VIAL_ADAPTERS.remove_vial_adapters_title');

    const nextBtn = await getElementById('tvSecond', 'common.cmn_text_next');
    await nextBtn.click();
    await browser.pause(1000);

    await getElementById('tvHeaderTitle', 'screens.CONNECT_TUBING_SCREEN.connect_tubing_title');

    await waitWithHeartbeat(120000);

    await checkAlarm(
        'alerts.FILL_PROCESS_INCOMPLETE.alert_title_fill_process_incomplete',
        'alerts.FILL_PROCESS_INCOMPLETE.alert_description_fill_process_incomplete',
        { expectedStr: 'ID 32 ' }
    );

    await getElementById('tvThird', 'common.cmn_resume_process');
    logStepMessage("✅ Step 9");
}

async function step10() {
    logStepMessage("▶️ Step 10");
    const resumeProcessBtn = await getElementById('tvThird', 'common.cmn_resume_process');
    await resumeProcessBtn.click();
    await browser.pause(100);

    await waitForDisappear(buildSelectorById('tvAlarmTitle'));
    logStepMessage("✅ Notification disappeared");

    const primeTubbingBtn = await getElementById('tvSecond', 'screens.CONNECT_TUBING_SCREEN.connect_tubing_prime_button');
    await primeTubbingBtn.click();
    await browser.pause(1000);

    await getElementById('tvHeaderTitle', 'screens.PREPARE_INFUSION_SITES.screen_prepare_infusion_sites_title');

    await waitWithHeartbeat(120000);

    await checkAlarm(
        'alerts.FILL_PROCESS_INCOMPLETE.alert_title_fill_process_incomplete',
        'alerts.FILL_PROCESS_INCOMPLETE.alert_description_fill_process_incomplete',
        { expectedStr: 'ID 32 ' }
    );

    await getElementById('tvThird', 'common.cmn_resume_process');
    logStepMessage("✅ Step 10");
}

async function step11() {
    logStepMessage("▶️ Step 11");
    const resumeProcessBtn = await getElementById('tvThird', 'common.cmn_resume_process');
    await resumeProcessBtn.click();
    await browser.pause(100);

    await waitForDisappear(buildSelectorById('tvAlarmTitle'));
    logStepMessage("✅ Notification disappeared");

    const nextBtn = await getElementById('tvFillDetailNext', 'common.cmn_text_next');
    await nextBtn.click();
    await browser.pause(1000);

    await getElementById('tvHeaderTitle', 'screens.INSERT_CANNULA.insert_cannula_screen_title');

    await waitWithHeartbeat(120000);

    await checkAlarm(
        'alerts.FILL_PROCESS_INCOMPLETE.alert_title_fill_process_incomplete',
        'alerts.FILL_PROCESS_INCOMPLETE.alert_description_fill_process_incomplete',
        { expectedStr: 'ID 32 ' }
    );

    await getElementById('tvThird', 'common.cmn_resume_process');
    logStepMessage("✅ Step 11");
}

async function step12() {
    logStepMessage("▶️ Step 12");
    const resumeProcessBtn = await getElementById('tvThird', 'common.cmn_resume_process');
    await resumeProcessBtn.click();
    await browser.pause(100);

    await waitForDisappear(buildSelectorById('tvAlarmTitle'));
    logStepMessage("✅ Notification disappeared");

    const nextBtn = await getElementById('tvFillDetailNext', 'common.cmn_text_next');
    await nextBtn.click();
    await browser.pause(1000);

    // Do not fail even if no pump battery charging screen
    const headerTitle = await getElementById('tvHeaderTitle');
    const headerTitleText = await headerTitle.getText();
    const pumpBatteryChargingTitleText = getCachedString('screens.CHARGING.charging_screen_title');
    if (headerTitleText == pumpBatteryChargingTitleText) {
        logStepMessage(`▶️ ${pumpBatteryChargingTitleText} screen - waiting for pump battery charging`);}
    else {
        logStepMessage(`${headerTitleText} screen displayed`);
    }

    // await getElementById('tvHeaderTitle', 'screens.CHARGING.charging_screen_title');

    await waitWithHeartbeat(120000);

    await checkAlarm(
        'alerts.FILL_PROCESS_INCOMPLETE.alert_title_fill_process_incomplete',
        'alerts.FILL_PROCESS_INCOMPLETE.alert_description_fill_process_incomplete',
        { expectedStr: 'ID 32 ' }
    );

    await getElementById('tvThird', 'common.cmn_resume_process');
    logStepMessage("✅ Step 12");
}

async function step13() {
    logStepMessage("▶️ Step 13");
    const resumeProcessBtn = await getElementById('tvThird', 'common.cmn_resume_process');
    await resumeProcessBtn.click();
    await browser.pause(100);

    await waitForDisappear(buildSelectorById('tvAlarmTitle'));
    logStepMessage("✅ Notification disappeared");

    // wait 1h
    await waitForScreenWithHeartbeat(
      buildSelectorById('tvHeaderTitle') + `.text("${getCachedString('screens.CONNECT_TUBES.connect_tubes_screen_title')}")`,
      buildSelectorById('tvThird') + `.text("${getCachedString('common.cmn_resume_process')}")`,
      3600000
    );

    await getElementById('tvHeaderTitle', 'screens.CONNECT_TUBES.connect_tubes_screen_title');

    await waitWithHeartbeat(120000);

    await checkAlarm(
        'alerts.FILL_PROCESS_INCOMPLETE.alert_title_fill_process_incomplete',
        'alerts.FILL_PROCESS_INCOMPLETE.alert_description_fill_process_incomplete',
        { expectedStr: 'ID 32 ' }
    );

    await getElementById('tvThird', 'common.cmn_resume_process');
    logStepMessage("✅ Step 13");
}

async function step14() {
    logStepMessage("▶️ Step 14");
    const resumeProcessBtn = await getElementById('tvThird', 'common.cmn_resume_process');
    await resumeProcessBtn.click();
    await browser.pause(100);

    await waitForDisappear(buildSelectorById('tvAlarmTitle'));
    logStepMessage("✅ Notification disappeared");

    const nextBtn = await getElementById('tvFillDetailNext', 'common.cmn_text_next');
    await nextBtn.click();
    await browser.pause(1000);

    await getElementById('tvHeaderTitle', 'screens.PUMP_READY.remove_pump_screen_title');

    await waitWithHeartbeat(120000);

    await checkAlarm(
        'alerts.FILL_PROCESS_INCOMPLETE.alert_title_fill_process_incomplete',
        'alerts.FILL_PROCESS_INCOMPLETE.alert_description_fill_process_incomplete',
        { expectedStr: 'ID 32 ' }
    );

    await getElementById('tvThird', 'common.cmn_resume_process');
    logStepMessage("✅ Step 14");
}

async function step15(apiBaseUrl) {
    logStepMessage("▶️ Step 15");
    const resumeProcessBtn = await getElementById('tvThird', 'common.cmn_resume_process');
    await resumeProcessBtn.click();
    await browser.pause(100);

    await waitForDisappear(buildSelectorById('tvAlarmTitle'));
    logStepMessage("✅ Notification disappeared");

    await clearPumpLogs(apiBaseUrl);

    adbDecouplePump();
    await browser.pause(7000);

    await getElementById('tvHeaderTitle', 'screens.PUMP_READY.pump_ready_screen_title');

    await waitWithHeartbeat(120000);

    await checkAlarm(
        'alerts.FILL_PROCESS_INCOMPLETE.alert_title_fill_process_incomplete',
        'alerts.FILL_PROCESS_INCOMPLETE.alert_description_fill_process_incomplete',
        { expectedStr: 'ID 32 ' }
    );

    await getElementById('tvThird', 'common.cmn_resume_process');

    // Alarms ON: ID21
    // Alarms: 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 1 2 2 2 2 2 2
    // Current state is: Ready
    await verifyLogsContain(apiBaseUrl, `Alarms: 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 1 2 2 2 2 2 2||Current state is: Ready`, 0, "error");

    const treatementPauseTxt = getCachedString('alerts.LOW_TREATMENT_PAUSED.alert_title_low_treatment_paused').toUpperCase();
    if (await isElementDisplayedByText(treatementPauseTxt)) {
        throw new Error("❌ TREATMENT PAUSED alarm displayed [alerts.LOW_TREATMENT_PAUSED.alert_title_low_treatment_paused] upper case");
    }
    logStepMessage("✅ TREATMENT PAUSED alarm NOT displayed [alerts.LOW_TREATMENT_PAUSED.alert_title_low_treatment_paused] upper case");
    logStepMessage("✅ Step 15");
}