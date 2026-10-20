// helpers
import { adbCouplePump, adbDecouplePump, adbUpdateConfigFilesAndMainSn } from '../helpers/adbHelpers.js';
import { blePumpCommand, clearPumpLogs, connectTwico, disconnectTwico, resetPumpToFTU, updateParameterValue, verifyLogsContain } from '../helpers/apiHelpers.js';
import { activateRegimenAndStart, pairPump, resetToFTU } from '../helpers/preConditionsHelpers.js';
import { buildSelectorById, checkAlarm, checkAlert, enterPinCode, getCachedString, getElementById, isElementDisplayedById, openDosingRegimenSettings, updateValueWithPlusMinusClicks, waitForVisible, waitForVisibleWithRetry } from '../helpers/uiHelpers.js';

import { loadStrings } from '../helpers/i18n.js';
import { logStep, logStepMessage } from '../helpers/logger.js';

// config
import config from '../helpers/config.js';
import { flowState, saveState } from '../helpers/flowState.js';

import allureReporter from '@wdio/allure-reporter';

/*
Precondition:
Using CS configuration tool NDUI to change: “FW Configuration File”-> user_default_key= 1, “APK Configuration File”-> HcpUser = True,

Pump and CS after FTU

Pump doesn’t get power (pump is out of cradle)

Use dedicated CS VnV Apk version
*/

const testKey = "TM-435";

let preconditionsPassed = false;

describe(`${testKey} - RAM Integrity after regimen upload - Test with VnV version`, () => {
    const { apiBaseUrl, globalParams } = config;
    const { pumpName, portName, defaultPumpPinCode, defaultRegimenPinCode } = { ...globalParams };

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
            await logStep('Decouple pump - no power', async () => {
                adbDecouplePump();
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

            await logStep('Step 1 - Update VALIDATION parameters', async () => {
                await step1(apiBaseUrl);
            });

            await logStep('Step 2 - Couple pump', async () => {
                await step2();
            });

            await logStep('Step 3 - Reset Pump to FTU', async () => {
                await step3(apiBaseUrl);
            });

            await logStep('Step 4 - Pair pump, activate regimen and start (until medication empty)', async () => {
                await step4(pumpName, defaultPumpPinCode);
            });

            await logStep('Step 5 - Update VALIDATION parameters', async () => {
                await step5(apiBaseUrl);
            });

            await logStep('Step 6 - Dosing regimen settings, edit regimen with default correct PIN, set total dose 620mg and save - SAVED', async () => {
                await step6(defaultRegimenPinCode, "620");
            });

            await logStep('Step 7 - Reset Pump to FTU', async () => {
                await step7(apiBaseUrl);
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
    await blePumpCommand(apiBaseUrl, "12 0");
    await updateParameterValue(apiBaseUrl, "VALIDATION", 1012, 70);
    await updateParameterValue(apiBaseUrl, "VALIDATION2", 1015, 5);
    logStepMessage("✅ Step 1");
}

async function step2() {
    logStepMessage("▶️ Step 2");
    adbCouplePump();
    await browser.pause(7000);
    await waitForVisible(
        buildSelectorById('tvAlertTitle'),
        'alerts.PUMP_MALFUNCTION.alert_title_pump_malfunction',
        20000,
        300,
        true
    );
    logStepMessage("✅ Alert PUMP MALFUNCTION shown [alerts.PUMP_MALFUNCTION.alert_title_pump_malfunction] upper case");

    if (await isElementDisplayedById('tvDismissAlert')) {
        const audioBtn = await getElementById('tvDismissAlert');
        await audioBtn.click();
    }

    await checkAlert(
        'alerts.PUMP_MALFUNCTION.alert_title_pump_malfunction',
        'alerts.PUMP_MALFUNCTION.alert_description_pump_malfunction',
        {
            templateKey: 'alerts.STRINGS_FOR_ALERT_TYPES.alert_cs_hw_malfunction_info',
            templateValues: ['1', '70']
        }
    );
    logStepMessage("✅ Step 2");
}

async function step3(apiBaseUrl) {
    logStepMessage("▶️ Step 3");
    await resetPumpToFTU(apiBaseUrl);
    // no more alert

    await waitForVisible(
        buildSelectorById('tvAlarmTitle'),
        'dialogs.TRY_TO_PAIR_NEW_PUMP.dialog_alert_title_pair_new_pump',
        30000,
        300
    );

    const yesBtn = await getElementById('tvThird', 'common.cmn_text_yes');
    await yesBtn.click();
    logStepMessage("▶️ Trying to pair the pump");

    await browser.pause(3000);

    if (await isElementDisplayedById('tvDismissAlert')) {
        throw new Error(`❌ Pump malfunction alert still displayed`);
    }
    logStepMessage("✅ Pump malfunction alert cleared");

    await verifyLogsContain(apiBaseUrl, `[FSM] New state: FTU\``, 1000, "error");
    logStepMessage("✅ Step 3");
}

async function step4(pumpName, pinCode) {
    logStepMessage("▶️ Step 4");
    // complete pairing until med empty

    const pump = await waitForVisibleWithRetry(
        buildSelectorById('tvTitle') + `.text("${pumpName}")`,
        buildSelectorById('tvThird'),
        60000
    );
    await pump.click();

    let nextBtn = await getElementById('tvSecond');

    await nextBtn.click();
    await browser.pause(100);

    await enterPinCode(pinCode);

    nextBtn = await getElementById('tvSecond');
    await nextBtn.click();
    await browser.pause(200);

    const replaceBtn = await getElementById('tvThird', 'common.cmn_text_replace');
    await replaceBtn.click();
    await browser.pause(200);

    const activateRegimenBtn = await waitForVisible(
        buildSelectorById('tvSecond'),
        'common.cmn_regimen_activate_changes',
        15000
    );
    await activateRegimenBtn.click();

    let getStarted = await waitForVisible(
        buildSelectorById('tvSecond'),
        'common.cmn_get_started',
        12000
    );
    await getStarted.click();
    await browser.pause(1000);

    getStarted = await waitForVisible(
        buildSelectorById('tvThird'),
        'common.cmn_get_started',
        10000
    );
    await getStarted.click();
    await browser.pause(1000);

    if (await isElementDisplayedById('tvDismissAlert')) {
        const audioBtn = await getElementById('tvDismissAlert');
        await audioBtn.click();
    }
    logStepMessage("✅ Step 4");
}

async function step5(apiBaseUrl) {
    logStepMessage("▶️ Step 5");
    await updateParameterValue(apiBaseUrl, "VALIDATION", 1012, 70);
    await updateParameterValue(apiBaseUrl, "VALIDATION2", 1015, 5);
    logStepMessage("✅ Step 5");
}

async function step6(pinCode, newTotalDose) {
    logStepMessage("▶️ Step 6");
    const { segmentsValues: initialSegments } = await openDosingRegimenSettings();
    const editRegimenBtn = await browser.$(buildSelectorById('tvSecond') + `.text("${getCachedString('common.cmn_regimen_edit_changes')}")`);
    await editRegimenBtn.click();
    await getElementById('tvHeaderTitle', 'screens.REGIMEN_MENU.regimen_pin_title');
    await enterPinCode(pinCode);

    await updateValueWithPlusMinusClicks({
        mode: 'dose',
        actualValue: initialSegments.totalDose,
        newValue: newTotalDose
    });

    const doneBtn = await getElementById('tvSecond', 'common.cmn_text_done');
    await doneBtn.click();

    const saveBtn = await getElementById('tvSecond', 'common.cmn_regimen_save_changes');
    await saveBtn.click();

    await getElementById('tvHeaderTitle', 'screens.BASAL_UPLOAD.basal_upload_screen_title');

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
            templateValues: ['1', '70']
        }
    );

    if (await isElementDisplayedById('tvThird')) {
        const audioBtn = await getElementById('tvThird');
        await audioBtn.click();
    }
    logStepMessage("✅ Step 6");
}

async function step7(apiBaseUrl) {
    logStepMessage("▶️ Step 7");
    await resetPumpToFTU(apiBaseUrl);
    // no more alert
    await browser.pause(10000);
    await waitForVisible(
        buildSelectorById('tvAlarmTitle'),
        'dialogs.TRY_TO_PAIR_NEW_PUMP.dialog_alert_title_pair_new_pump',
        20000,
        300
    );

    const yesBtn = await getElementById('tvThird', 'common.cmn_text_yes');
    await yesBtn.click();
    logStepMessage("▶️ Trying to pair the pump");

    await browser.pause(3000);

    if (await isElementDisplayedById('tvDismissAlert')) {
        throw new Error(`❌ Pump malfunction alert still displayed`);
    }
    logStepMessage("✅ Pump malfunction alert cleared");

    await verifyLogsContain(apiBaseUrl, `[FSM] New state: FTU\``, 1000, "error");
    logStepMessage("✅ Step 7");
}