// helpers
import { connectTwico, disconnectTwico, updateParameterValue, verifyLogsContain } from '../helpers/apiHelpers.js';
import { activateRegimenAndStart, pairPump, resetToFTU } from '../helpers/preConditionsHelpers.js';
import { buildSelectorById, checkAlarm, enterPinRegimen, getElementById, isElementDisplayedById, openDosingRegimenSettings, updateValueWithPlusMinusClicks } from '../helpers/uiHelpers.js';

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

Pump and CS after FTU
*/

// user_default_key 1 => use defaultRegimenPinCode: "06120000"

const testKey = "TM-103";

let preconditionsPassed = false;

describe(`${testKey} - Total volume exceeded threshold`, () => {
  const { apiBaseUrl, globalParams } = config;
  const { pumpName, portName, defaultRegimenPinCode } = { ...globalParams };

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
        await logStep('Activate regimen and start (until medication empty)', async () => {
            await activateRegimenAndStart();
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

        await logStep('Step 1 - Update MAX_CARTRIDGE_ALLOWED_VOLUME_UL', async () => {
            await step1(apiBaseUrl);
        });

        await logStep('Step 2 - Open Dosing regimen settings', async () => {
            ({ segmentsValues } = await step2());
        });

        initialSegments = segmentsValues;
        logPretty("Initial regimen", initialSegments);

        await logStep('Step 3 - Enter default correct PIN code', async () => {
            await step3(defaultRegimenPinCode);
        });

        await logStep('Step 4 - Set Total daily dose 720 mg', async () => {
            await step4(apiBaseUrl, initialSegments.totalDose, "720");
        });

        await logStep('Step 5 - Update MAX_CARTRIDGE_ALLOWED_VOLUME_UL and MIN_CARTRIDGE_ALLOWED_VOLUME_UL', async () => {
            await step5(apiBaseUrl);
        });

        await logStep('Step 6 - Enter default correct PIN code and set Total daily dose 670mg', async () => {
            await step6(apiBaseUrl, defaultRegimenPinCode, initialSegments.totalDose, "670");
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
    await updateParameterValue(apiBaseUrl, "MAX_CARTRIDGE_ALLOWED_VOLUME_UL", 60, 6000);
    logStepMessage("✅ Step 1");
}

async function step2() {
    logStepMessage("▶️ Step 2");
    const segmentsValues = await openDosingRegimenSettings();

    const editRegimenBtn =  await getElementById('tvSecond', 'common.cmn_regimen_edit_changes');
    await editRegimenBtn.click();

    logStepMessage("✅ Step 2");
    return segmentsValues;
}

async function step3(pinCode) {
    logStepMessage("▶️ Step 3");
    await enterPinRegimen(pinCode);
    if (await isElementDisplayedById('tvPinError')) {
        const pinError = await browser.$(buildSelectorById('tvPinError'));
        const pinErrorStr = await pinError.getText();
        throw new Error(`❌ ${pinErrorStr} [screens.REGIMEN_MENU.regiment_wrong_pin]`);
    }
    await getElementById('tvHeaderTitle', 'screens.REGIMEN_OVERVIEW.title_single_regimen_edit');
    logStepMessage("✅ Step 3");
}

async function step4(apiBaseUrl, actualTotalDose, newTotalDose) {
    logStepMessage("▶️ Step 4");

    await updateValueWithPlusMinusClicks({
        mode: 'dose',
        actualValue: actualTotalDose,
        newValue: newTotalDose
    });

    const doneBtn = await getElementById('tvSecond', 'common.cmn_text_done');
    await doneBtn.click();

    const saveRegimenBtn =  await getElementById('tvSecond', 'common.cmn_regimen_save_changes');
    await saveRegimenBtn.click();
    await checkAlarm(
        'dialogs.ALERT_REGIMEN_UPLOAD_FAILED.alert_type_regimen_upload_failed_title',
        'dialogs.ALERT_REGIMEN_UPLOAD_FAILED.alert_type_regimen_upload_failed_info',
        { expectedStr: 'ID 1036 ' }
    );

    await verifyLogsContain(apiBaseUrl, `[REGIMENS] Info tst: 5\``, 3000, "error");

    const tryAgainBtn = await getElementById('tvThird', 'common.cmn_text_try_again');
    await tryAgainBtn.click();

    // segments not saved 
    const totalDose =  await getElementById('tvMessageContainerFlow');
    const totalDoseTxt = await totalDose.getText();
    if (totalDoseTxt !== actualTotalDose) {
        throw new Error(`❌ Segments should not be saved: expected "${actualTotalDose}", got "${totalDoseTxt}"`);
    }
    logStepMessage(`✅ Segments not saved: Regimen total daily dose still "${actualTotalDose}"`);

    logStepMessage("✅ Step 4");    
}

async function step5(apiBaseUrl) {
    logStepMessage("▶️ Step 5");
    logStepMessage(`▶️ Update MAX_CARTRIDGE_ALLOWED_VOLUME_UL`);   
    await updateParameterValue(apiBaseUrl, "MAX_CARTRIDGE_ALLOWED_VOLUME_UL", 60, 12000);
    logStepMessage(`▶️ Update MIN_CARTRIDGE_ALLOWED_VOLUME_UL`);  
    await updateParameterValue(apiBaseUrl, "MIN_CARTRIDGE_ALLOWED_VOLUME_UL", 61, 12000);
    await browser.pause(1000);
    logStepMessage("✅ Step 5");    
}

async function step6(apiBaseUrl, pinCode, actualTotalDose, newTotalDose) {
    logStepMessage("▶️ Step 6");
    await browser.pause(1000);
    const editRegimenBtn =  await getElementById('tvSecond', 'common.cmn_regimen_edit_changes');
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

    const saveRegimenBtn =  await getElementById('tvSecond', 'common.cmn_regimen_save_changes');
    await saveRegimenBtn.click();

    await checkAlarm(
        'dialogs.ALERT_REGIMEN_UPLOAD_FAILED.alert_type_regimen_upload_failed_title',
        'dialogs.ALERT_REGIMEN_UPLOAD_FAILED.alert_type_regimen_upload_failed_info',
        { expectedStr: 'ID 1036 ' }
    );

    await verifyLogsContain(apiBaseUrl, `[REGIMENS] Info tst: 5\``, 3000, "error");

    const tryAgainBtn = await getElementById('tvThird', 'common.cmn_text_try_again');
    await tryAgainBtn.click();

    // segments not saved
    const totalDose =  await getElementById('tvMessageContainerFlow');
    const totalDoseTxt = await totalDose.getText();
    if (totalDoseTxt !== actualTotalDose) {
        throw new Error(`❌ Segments should not be saved: expected "${actualTotalDose}", got "${totalDoseTxt}"`);
    }
    logStepMessage(`✅ Segments not saved: Regimen total daily dose still "${actualTotalDose}"`); 
    logStepMessage("✅ Step 6");
}
