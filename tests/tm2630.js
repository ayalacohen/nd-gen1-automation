// helpers
import { adbUpdateConfigFilesAndMainSn } from '../helpers/adbHelpers.js';
import { connectTwico, disconnectTwico, verifyLogsContain } from '../helpers/apiHelpers.js';
import { pairPump, resetToFTU } from '../helpers/preConditionsHelpers.js';
import { buildSelectorById, checkAlarm, csVnVHiddenMenu, getElementById, getElementByIdAndText, isElementDisplayedById, updateVnVFlowRateValue, waitForVisible } from '../helpers/uiHelpers.js';

import { loadStrings } from '../helpers/i18n.js';
import { logStep, logStepMessage } from '../helpers/logger.js';

// config
import config from '../helpers/config.js';
import { flowState, saveState } from '../helpers/flowState.js';
import { attachScreenshotFn } from '../helpers/screenshot.js';

import allureReporter from '@wdio/allure-reporter';
import { formatFlowRate } from '../helpers/generalHelpers.js';

/*
Precondition:
CS with VV-VnV version

CS Hidden menu is available

Both pump and CS in FTU state

CS with active HCP mode 
*/

const testKey = "TM-2630";

let preconditionsPassed = false;

describe(`${testKey} - Pump doesn't save flow rate out of eligible list - Test with apk VnV version`, () => {
    const { apiBaseUrl, globalParams } = config;
    const { pumpName, portName } = { ...globalParams };

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

            await logStep('Update HCP_1 config files, main sn and relaunch', async () => {
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
            preconditionsPassed = true;
        } catch (err) {
            throw new Error(`PRECONDITION FAILED: ${err.message}`);
        }
    });

    it("TM-2630", async function () {
        try {
            allureReporter.addLabel('testKey', testKey);
            if (!preconditionsPassed) {
                // mark test as skipped in Mocha
                this.skip();
            }
            await logStep('Step 1 - Pair pump, VnV Edit Regimen screen with day flow rate 0.63, Upload regimen', async () => {
                await step1(apiBaseUrl, pumpName, "0.640", "0.63");
            });
            await logStep('Step 2 - Try again, VnV Edit Regimen screen with day flow rate 0.58, Upload regimen', async () => {
                await step2(apiBaseUrl, "0.640", "0.58");
            });
            await logStep('Step 3 - Try again, VnV Edit Regimen screen with day flow rate 0.33, Upload regimen', async () => {
                await step3(apiBaseUrl, "0.640", "0.33");
            });

            await logStep('Step 4 - Try again, VnV Edit Regimen screen with day flow rate 0.32, Upload  valid regimen', async () => {
                await step4("0.640", "0.32");
            });

            await logStep('Step 5 - Complete FTU until medication empty', async () => {
                await step5();
            });

            await logStep('Step 6 - Open dosing regimen settings, VnV Edit Regimen screen with day flow rate 0.63, Upload regimen', async () => {
                await step6(apiBaseUrl, "0.320", "0.63");
            });

            await logStep('Step 7 -Try again, VnV Edit Regimen screen with day flow rate 0.58, Upload regimen', async () => {
                await step7(apiBaseUrl, "0.320", "0.58");
            });

            await logStep('Step 8 -Try again, VnV Edit Regimen screen with day flow rate 0.33, Upload regimen', async () => {
                await step8(apiBaseUrl, "0.320", "0.33");
            });

            await logStep('Step 9 -Try again, VnV Edit Regimen screen with day flow rate 0.32, Upload valid regimen', async () => {
                await step9("0.320", "0.32");
            });

            await logStep('Uncheck Use VnV Edit Regimen screen', async () => {
                await step10();
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
async function step1(apiBaseUrl, pumpName, actualDayFlowRate, newDayFlowRate) {
    logStepMessage("▶️ Step 1");
    await pairPump(pumpName);

    await csVnVHiddenMenu('Use VnV Edit Regimen screen');

    const nextBtn = await getElementById('tvSecond');
    await nextBtn.click();
    await browser.pause(100);

    await getElementByIdAndText('tvHeaderTitle', 'VnV Edit Regimen', false);

    await updateFlowRate(apiBaseUrl, actualDayFlowRate, newDayFlowRate, 1);
    logStepMessage("✅ Step 1");
}

async function step2(apiBaseUrl, actualDayFlowRate, newDayFlowRate) {
    logStepMessage("▶️ Step 2");
    const tryAgainBtn = await getElementById('tvThird', 'common.cmn_text_try_again');
    await tryAgainBtn.click();

    await updateFlowRate(apiBaseUrl, actualDayFlowRate, newDayFlowRate, 2);
    logStepMessage("✅ Step 2");
}

async function step3(apiBaseUrl, actualDayFlowRate, newDayFlowRate) {
    logStepMessage("▶️ Step 3");
    const tryAgainBtn = await getElementById('tvThird', 'common.cmn_text_try_again');
    await tryAgainBtn.click();

    await updateFlowRate(apiBaseUrl, actualDayFlowRate, newDayFlowRate, 3);
    logStepMessage("✅ Step 3");
}

async function step4(actualDayFlowRate, newDayFlowRate) {
    logStepMessage("▶️ Step 4");
    const tryAgainBtn = await getElementById('tvThird', 'common.cmn_text_try_again');
    await tryAgainBtn.click();

    await updateFlowRate(null, actualDayFlowRate, newDayFlowRate, 4, false);

    logStepMessage("✅ Step 4");
}
async function step5() {
    logStepMessage("▶️ Step 5");

    let getStarted = await waitForVisible(
        buildSelectorById('tvSecond'),
        'common.cmn_get_started',
        15000
    );
    await getStarted.click();

    getStarted = await waitForVisible(
        buildSelectorById('tvThird'),
        'common.cmn_get_started',
        10000
    );
    await getStarted.click();
    await browser.pause(1000);

    const alert = await waitForVisible(
        buildSelectorById('tvAlertTitle'),
        'alerts.EMPTY_DRUG.alert_title_empty_drug',
        10000,
        300,
        true
    );
    logStepMessage("✅ Alert MEDICATION IS EMPTY shown [alerts.EMPTY_DRUG.alert_title_empty_drug] upper case");

    if (await isElementDisplayedById('tvDismissAlert')) {
        const audioBtn = await getElementById('tvDismissAlert');
        await audioBtn.click();
    }
    logStepMessage("✅ Step 5");
}
async function step6(apiBaseUrl, actualDayFlowRate, newDayFlowRate) {
    logStepMessage("▶️ Step 6");
    const headerMenu = await getElementById('ivHeaderMenu');
    await headerMenu.click();

    const dosingRegimenSettings = await getElementByIdAndText('tvItemTitle', 'screens.MENU.menu_item_regimen_settings');
    await dosingRegimenSettings.click();

    await getElementByIdAndText('tvHeaderTitle', 'VnV Edit Regimen', false);

    await updateFlowRate(apiBaseUrl, actualDayFlowRate, newDayFlowRate, 6);
    logStepMessage("✅ Step 6");
}

async function step7(apiBaseUrl, actualDayFlowRate, newDayFlowRate) {
    logStepMessage("▶️ Step 7");
    const tryAgainBtn = await getElementById('tvThird', 'common.cmn_text_try_again');
    await tryAgainBtn.click();

    await updateFlowRate(apiBaseUrl, actualDayFlowRate, newDayFlowRate, 7);
    logStepMessage("✅ Step 7");
}

async function step8(apiBaseUrl, actualDayFlowRate, newDayFlowRate) {
    logStepMessage("▶️ Step 8");
    const tryAgainBtn = await getElementById('tvThird', 'common.cmn_text_try_again');
    await tryAgainBtn.click();

    await updateFlowRate(apiBaseUrl, actualDayFlowRate, newDayFlowRate, 8);

    logStepMessage("✅ Step 8");
}

async function step9(actualDayFlowRate, newDayFlowRate) {
    logStepMessage("▶️ Step 9");
    const tryAgainBtn = await getElementById('tvThird', 'common.cmn_text_try_again');
    await tryAgainBtn.click();

    await updateFlowRate(null, actualDayFlowRate, newDayFlowRate, 9, false);

    await getElementById('tvHeaderTitle', 'screens.BASAL_UPLOAD.basal_upload_screen_title');
    await getElementById('tvSettingsSyncInfo', 'screens.BASAL_UPLOAD.basal_upload_screen_content');

    await browser.pause(10000);

    const newDayFlowRateStr = Number(newDayFlowRate).toFixed(3);
    const formattedValue = formatFlowRate(newDayFlowRateStr);
    await getElementByIdAndText('tvVnvSegmentFlowRate', formattedValue + " ml/h", false);
    logStepMessage(`✅ Regimen updated with Day flow rate ${formattedValue} ml/h`);

    const backBtn = await getElementById('ivHeaderBack');
    await backBtn.click();
    await getElementById('tvHeaderTitle', 'screens.HOME.home_title');
    await waitForVisible(
        buildSelectorById('tvAlertTitle'),
        'alerts.EMPTY_DRUG.alert_title_empty_drug',
        10000,
        300,
        true
    );
    logStepMessage("✅ Alert MEDICATION IS EMPTY shown [alerts.EMPTY_DRUG.alert_title_empty_drug] upper case");
    logStepMessage("✅ Step 9");
}

async function step10() {
    logStepMessage("▶️ Step 10");
    await csVnVHiddenMenu('Use VnV Edit Regimen screen');
    logStepMessage("✅ Step 10");
}


async function updateFlowRate(apiBaseUrl, actualDayFlowRate, newDayFlowRate, stepNumber, uploadFailed = true) {
    await updateVnVFlowRateValue({
        actualValue: actualDayFlowRate,
        newValue: newDayFlowRate
    });

    await browser.pause(1000);
    await attachScreenshotFn(`Step ${stepNumber} - After updating day flow rate`);

    const uploadRegimensBtn = await getElementById('tvVnvUploadRegimens');
    await uploadRegimensBtn.click();

    await browser.pause(2000);

    if (uploadFailed) {
        await checkAlarm(
            'dialogs.ALERT_REGIMEN_UPLOAD_FAILED.alert_type_regimen_upload_failed_title',
            'dialogs.ALERT_REGIMEN_UPLOAD_FAILED.alert_type_regimen_upload_failed_info',
            { expectedStr: 'ID 1036 ' }
        );

        await verifyLogsContain(apiBaseUrl, `[REGIMENS] Info tst: 9\``, 3000, "error");
    }
}