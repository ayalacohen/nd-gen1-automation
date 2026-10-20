// helpers
import { adbUpdateConfigFilesAndMainSn } from '../helpers/adbHelpers.js';
import { clearPumpLogs, connectTwico, disconnectTwico, verifyLogsContain } from '../helpers/apiHelpers.js';
import { pairPump, resetToFTU } from '../helpers/preConditionsHelpers.js';
import { buildSelectorById, checkAlarm, csVnVHiddenMenu, enterPinCode, getCachedString, getElementById, getElementByIdAndText, isElementDisplayedById, openDosingRegimenSettings, waitForVisible } from '../helpers/uiHelpers.js';

import { loadStrings } from '../helpers/i18n.js';
import { logStep, logStepMessage } from '../helpers/logger.js';

// config
import config from '../helpers/config.js';
import { flowState, saveState } from '../helpers/flowState.js';

import allureReporter from '@wdio/allure-reporter';

/*
Precondition:
HCP mode

Use dedicated CS VnV Apk version

Pump and CS on FTU

Complete the pairing phase
*/

const testKey = "TM-99";

let preconditionsPassed = false;

describe(`${testKey} - Cannot save two regimens (VnV apk)`, () => {
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
            await logStep('Clear pump logs', async () => {
                await clearPumpLogs(apiBaseUrl);
            });
            await logStep('Reset to FTU, Pair pump', async () => {
                if (flowState.lastSuccess && ["tm98"].includes(flowState.lastTest)) {
                    logStepMessage("Skipping these reset steps...");
                } else {
                    await resetToFTU(apiBaseUrl);
                    await pairPump(pumpName);
                }
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
            await logStep('Step 1 - Upload 2 regimens', async () => {
                await step1();
            });

            await logStep('Step 2 - Activate regimen', async () => {
                await step2(apiBaseUrl);
            });

            await logStep('Step 3 - Try again', async () => {
                await step3();
            });

            await logStep('Step 4 - Uncheck Upload 2 regimens and finish FTU', async () => {
                await step4();
            });
            // return;

            await logStep('Step 5 - Check Upload 2 regimens and edit dosing regimen', async () => {
                await step5(defaultRegimenPinCode, apiBaseUrl);
            });

            await logStep('Uncheck Upload 2 regimens', async () => {
                await step6();
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
    await csVnVHiddenMenu('Upload 2 Regimens');
    await getElementById('tvHeaderTitle', 'screens.FTU_STARTUP.title_start_up_ftu');
    await getElementByIdAndText('tvStartupItemTitle', 'screens.FTU_STARTUP.set_regimens_title');
    logStepMessage("✅ Step 1");
}

async function step2(apiBaseUrl) {
    logStepMessage("▶️ Step 2");
    const nextBtn = await getElementById('tvSecond');
    await nextBtn.click();
    await browser.pause(100);

    const activateRegimenBtn = await waitForVisible(
        buildSelectorById('tvSecond'),
        'common.cmn_regimen_activate_changes',
        10000
    );
    await activateRegimenBtn.click();

    await browser.pause(2000);

    await checkAlarm(
        'dialogs.ALERT_REGIMEN_UPLOAD_FAILED.alert_type_regimen_upload_failed_title',
        'dialogs.ALERT_REGIMEN_UPLOAD_FAILED.alert_type_regimen_upload_failed_info',
        { expectedStr: 'ID 1036 ' }
    );

    await verifyLogsContain(apiBaseUrl, `[REGIMENS] Info tst: 2\``, 3000, "error");

    logStepMessage("✅ Step 2");
}

async function step3() {
    logStepMessage("▶️ Step 3");
    const tryAgainBtn = await getElementById('tvThird', 'common.cmn_text_try_again');
    await tryAgainBtn.click();

    await waitForVisible(
        buildSelectorById('tvHeaderTitle'),
        'screens.REGIMEN_OVERVIEW.title_single_regimen_overview',
        15000
    );
    logStepMessage("✅ Step 3");
}

async function step4() {
    logStepMessage("▶️ Step 4");
    await csVnVHiddenMenu('Upload 2 Regimens');

    const activateRegimenBtn = await waitForVisible(
        buildSelectorById('tvSecond'),
        'common.cmn_regimen_activate_changes',
        10000
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

async function step5(pinCode, apiBaseUrl) {
    logStepMessage("▶️ Step 5");
    await csVnVHiddenMenu('Upload 2 Regimens');

    openDosingRegimenSettings();

    const editRegimenBtn = await browser.$(buildSelectorById('tvSecond') + `.text("${getCachedString('common.cmn_regimen_edit_changes')}")`);
    await editRegimenBtn.click();
    await getElementById('tvHeaderTitle', 'screens.REGIMEN_MENU.regimen_pin_title');
    await enterPinCode(pinCode);

    const doneBtn = await getElementById('tvSecond', 'common.cmn_text_done');
    await doneBtn.click();

    const saveBtn = await getElementById('tvSecond', 'common.cmn_regimen_save_changes');
    await saveBtn.click();

    await browser.pause(2000);

    await checkAlarm(
        'dialogs.ALERT_REGIMEN_UPLOAD_FAILED.alert_type_regimen_upload_failed_title',
        'dialogs.ALERT_REGIMEN_UPLOAD_FAILED.alert_type_regimen_upload_failed_info',
        { expectedStr: 'ID 1036 ' }
    );

    const tryAgainBtn = await getElementById('tvThird', 'common.cmn_text_try_again');
    await tryAgainBtn.click();

    await verifyLogsContain(apiBaseUrl, `[REGIMENS] Info tst: 2\``, 3000, "error");
    logStepMessage("✅ Step 5");
}

async function step6() {
    logStepMessage("▶️ Step 6");
    await csVnVHiddenMenu('Upload 2 Regimens');
    logStepMessage("✅ Step 6");
}