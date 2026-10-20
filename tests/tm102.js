// helpers
import { connectTwico, disconnectTwico, resetPump, updateParameterValue, verifyLogsContain } from '../helpers/apiHelpers.js';
import { pairPump, resetToFTU } from '../helpers/preConditionsHelpers.js';
import { buildSelectorById, checkAlarm, enterPinRegimen, getElementById, getSegmentsValues, isElementDisplayedById, reconnectPump, updateValueWithPlusMinusClicks, waitForVisible, waitUntilAlarmAfterEstablishing } from '../helpers/uiHelpers.js';

import { loadStrings } from '../helpers/i18n.js';
import { logPretty, logStep, logStepMessage } from '../helpers/logger.js';

// config
import config from '../helpers/config.js';
import { adbUpdateConfigFilesAndMainSn } from '../helpers/adbHelpers.js';
import { flowState, saveState } from '../helpers/flowState.js';

import allureReporter from '@wdio/allure-reporter';

/*
Precondition:
Using CS configuration tool NDUI to change: “FW Configuration File”-> user_default_key= 1, “APK Configuration File”-> HcpUser = True,
Pump and CS on FTU
Complete the pairing phase
In TwikoGUI set in SCD General tab parameter
MAX_FLOW_RATE to 360
MIN_FLOW_RATE to 500
*/

// user_default_key 1 => use defaultRegimenPinCode: "06120000"

const testKey = "TM-102";

let preconditionsPassed = false;

describe(`${testKey} - Flow rates exceeded threshold`, () => {
  const { apiBaseUrl, globalParams, testParams } = config;
  const { pumpName, portName, defaultRegimenPinCode} = { ...globalParams };

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
        await logStep('Update HCP_1 config files and relaunch', async () => {
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

            preconditionsPassed = true;
        } catch (err) {
            throw new Error(`PRECONDITION FAILED: ${err.message}`);
        }
    });

  let segmentsValues, initialSegments;

  it(`${testKey}`, async function () {
    try {
            allureReporter.addLabel('testKey', testKey);
            if (!preconditionsPassed) {
                // mark test as skipped in Mocha
                this.skip(); 
            }
        await logStep('Update MAX_FLOW_RATE to 360', async () => {
            await updateParameterValue(apiBaseUrl, "MAX_FLOW_RATE", 31, 360);
        });

        await logStep('Update MIN_FLOW_RATE to 500', async () => {
            await updateParameterValue(apiBaseUrl, "MIN_FLOW_RATE", 32, 500);
        });

        await browser.pause(1000);

        const nextBtn = await getElementById('tvSecond');
        await nextBtn.click();

        ({ segmentsValues } = await getSegmentsValues());
        initialSegments = segmentsValues;
        logPretty("Initial regimen", initialSegments);

        await logStep('Step 1 - Open Dosing regimen settings and activate regimen', async () => {
        // dosing regimen overview screen
            await step1(apiBaseUrl);
        });

        await logStep('Step 2 - Try again, edit regimen, set total daily dose 370 mg and activate regimen', async () => {
            await step2(apiBaseUrl, defaultRegimenPinCode, initialSegments.totalDose, "370");
        });
        // return;
        await logStep('Step 3 - Reset the pump, edit dosing regimen, set total daily dose 720 mg and save regimen', async () => {
            await step3(apiBaseUrl, pumpName, defaultRegimenPinCode, initialSegments.totalDose, "720");
        });

        await logStep('Step 4 - Adjust value', async () => {
            await step4();
        });

        await logStep('Step 5 - Edit regimen, set total daily dose 370 mg and activate regimen', async () => {
            await step5(initialSegments.totalDose, "370");
        });

        await logStep('Step 6 - Update MAX_FLOW_RATE/MIN_FLOW_RATE, reset the pump and regimen settings', async () => {
            await step6(apiBaseUrl, pumpName);
        });

        await logStep('Step 7 - Update MAX_FLOW_RATE/MIN_FLOW_RATE, reset the pump and regimen settings', async () => {
            await step7(apiBaseUrl, pumpName);
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
    await getElementById('tvHeaderTitle', 'screens.REGIMEN_OVERVIEW.title_single_regimen_overview');

    const activateRegimenBtn =  await getElementById('tvSecond', 'common.cmn_regimen_activate_changes');
    await activateRegimenBtn.click();

    await checkAlarm(
        'dialogs.ALERT_REGIMEN_UPLOAD_FAILED.alert_type_regimen_upload_failed_title',
        'dialogs.ALERT_REGIMEN_UPLOAD_FAILED.alert_type_regimen_upload_failed_info',
        { expectedStr: 'ID 1036 ' }
    );

    await verifyLogsContain(apiBaseUrl, `[REGIMENS] Info tst: 4\``, 3000, "error");
    // maybe wait more
    logStepMessage("✅ Step 1");
}

async function step2(apiBaseUrl, pinCode, actualTotalDose, newTotalDose) {
    logStepMessage("▶️ Step 2");

    const tryAgainBtn = await getElementById('tvThird', 'common.cmn_text_try_again');
    await tryAgainBtn.click();

    // await getElementById('tvHeaderTitle', 'screens.REGIMEN_OVERVIEW.title_single_regimen_overview');
    const editRegimenBtn =  await getElementById('tvEditSegments', 'common.cmn_regimen_edit_changes');
    await editRegimenBtn.click();

    await enterPinRegimen(pinCode);
    if (await isElementDisplayedById('tvPinError')) {
        const pinError = await browser.$(buildSelectorById('tvPinError'));
        const pinErrorStr = await pinError.getText();
        throw new Error(`❌ ${pinErrorStr} [screens.REGIMEN_MENU.regiment_wrong_pin]`);
    }

    await updateValueWithPlusMinusClicks({
        mode: 'dose',
        actualValue: actualTotalDose,
        newValue: newTotalDose
    });

    const doneBtn = await getElementById('tvSecond', 'common.cmn_text_done');
    await doneBtn.click();

    const activateRegimenBtn =  await getElementById('tvSecond', 'common.cmn_regimen_activate_changes');
    await activateRegimenBtn.click();

    await checkAlarm(
        'dialogs.ALERT_REGIMEN_UPLOAD_FAILED.alert_type_regimen_upload_failed_title',
        'dialogs.ALERT_REGIMEN_UPLOAD_FAILED.alert_type_regimen_upload_failed_info',
        { expectedStr: 'ID 1036 ' }
    );

    await verifyLogsContain(apiBaseUrl, `[REGIMENS] Info tst: 4\``, 3000, "error");
    logStepMessage("✅ Step 2");    
}

async function step3(apiBaseUrl, pumpName, pinCode, actualTotalDose, newTotalDose) {
    logStepMessage("▶️ Step 3");

    const tryAgainBtn = await getElementById('tvThird', 'common.cmn_text_try_again');
    await tryAgainBtn.click();

    await browser.pause(1000);

    await resetPump(apiBaseUrl);

    await browser.pause(40000);

    await waitUntilAlarmAfterEstablishing();

    await reconnectPump(pumpName);

    const nextBtn = await getElementById('tvSecond', 'common.cmn_text_next');
    await nextBtn.click();

    const editRegimenBtn = await waitForVisible(
        buildSelectorById('tvEditSegments'),
        'common.cmn_regimen_edit_changes',
        10000
      );
    await editRegimenBtn.click();

    await enterPinRegimen(pinCode);

    await updateValueWithPlusMinusClicks({
        mode: 'dose',
        actualValue: actualTotalDose,
        newValue: newTotalDose
    });

    const doneBtn = await getElementById('tvSecond', 'common.cmn_text_done');
    await doneBtn.click();

    const activateRegimenBtn =  await getElementById('tvSecond', 'common.cmn_regimen_activate_changes');
    await activateRegimenBtn.click();

    await checkAlarm(
        'dialogs.FLOW_VALUES_NOT_CORRECT.regime_segment_flow_value_title',
        'dialogs.FLOW_VALUES_NOT_CORRECT.regime_segment_flow_value_content',
        { expectedStr: 'ID 1026 ' }
    );

    const adjustValueBtn =  await getElementById('tvThird', 'common.cmn_text_adjust_value');

    logStepMessage("✅ Step 3");

}

async function step4() {
    logStepMessage("▶️ Step 4");
    const adjustValueBtn =  await getElementById('tvThird', 'common.cmn_text_adjust_value');
    await adjustValueBtn.click();
    const activateRegimenBtn =  await getElementById('tvSecond', 'common.cmn_regimen_activate_changes');
    if (await activateRegimenBtn.isEnabled()) {
        throw new Error("❌ ACTIVATE REGIMEN enabled");
    }
    logStepMessage("✅ ACTIVATE REGIMEN disabled");  
    logStepMessage("✅ Step 4");
}

async function step5(actualTotalDose, newTotalDose) {
    logStepMessage("▶️ Step 5");

    const editRegimenBtn =  await getElementById('tvEditSegments', 'common.cmn_regimen_edit_changes');
    await editRegimenBtn.click();

    await updateValueWithPlusMinusClicks({
        mode: 'dose',
        actualValue: actualTotalDose,
        newValue: newTotalDose
    });

    const doneBtn = await getElementById('tvSecond', 'common.cmn_text_done');
    await doneBtn.click();

    const activateRegimenBtn =  await getElementById('tvSecond', 'common.cmn_regimen_activate_changes');
    await activateRegimenBtn.click();

    await checkAlarm(
        'dialogs.FLOW_VALUES_NOT_CORRECT.regime_segment_flow_value_title',
        'dialogs.FLOW_VALUES_NOT_CORRECT.regime_segment_flow_value_content',
        { expectedStr: 'ID 1026 ' }
    );

    const adjustValueBtn =  await getElementById('tvThird', 'common.cmn_text_adjust_value');

    logStepMessage("✅ Step 5");

}

async function step6(apiBaseUrl, pumpName) {
    logStepMessage("▶️ Step 6");

    const adjustValueBtn =  await getElementById('tvThird', 'common.cmn_text_adjust_value');
    await adjustValueBtn.click();

    await updateParameterValue(apiBaseUrl, "MAX_FLOW_RATE", 31, 1000);

    await updateParameterValue(apiBaseUrl, "MIN_FLOW_RATE", 32, 80);

    await browser.pause(1000);

    await resetPump(apiBaseUrl);

    await browser.pause(40000);

    let editRegimenBtn = await waitForVisible(
        buildSelectorById('tvEditSegments'),
        'common.cmn_regimen_edit_changes',
        10000
      );
    await editRegimenBtn.click();

    await waitUntilAlarmAfterEstablishing();

    await reconnectPump(pumpName);

    let nextBtn = await getElementById('tvSecond', 'common.cmn_text_next');
    await nextBtn.click();

    await checkAlarm(
        'alerts.CS_BATTERY_CHARGER_STATUS.alert_title_pump_wrong_data',
        'alerts.CS_BATTERY_CHARGER_STATUS.alert_description_pump_wrong_data',
        { expectedStr: 'ID 1044 ' }
    );

    await getElementById('tvThird', 'common.cmn_text_ok');

    logStepMessage("✅ Step 6");
}

async function step7(apiBaseUrl, pumpName) {
    logStepMessage("▶️ Step 7");

    let okBtn = await getElementById('tvThird', 'common.cmn_text_ok');
    await okBtn.click();

    await updateParameterValue(apiBaseUrl, "MAX_FLOW_RATE", 31, 750);

    await updateParameterValue(apiBaseUrl, "MIN_FLOW_RATE", 32, 1000);

    await browser.pause(1000);

    await resetPump(apiBaseUrl);

    await browser.pause(40000);

    let nextBtn = await getElementById('tvSecond', 'common.cmn_text_next');
    await nextBtn.click();

    await waitUntilAlarmAfterEstablishing();

    await reconnectPump(pumpName);

    nextBtn = await getElementById('tvSecond', 'common.cmn_text_next');
    await nextBtn.click();

    await checkAlarm(
        'alerts.CS_BATTERY_CHARGER_STATUS.alert_title_pump_wrong_data',
        'alerts.CS_BATTERY_CHARGER_STATUS.alert_description_pump_wrong_data',
        { expectedStr: 'ID 1044 ' }
    );

    okBtn = await getElementById('tvThird', 'common.cmn_text_ok');
    await okBtn.click();

    logStepMessage("✅ Step 7");
}

