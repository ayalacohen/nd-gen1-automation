// helpers
import { adbUpdateConfigFilesAndMainSn } from '../helpers/adbHelpers.js';
import { connectTwico, disconnectTwico, verifyLogsContain } from '../helpers/apiHelpers.js';
import { pairPump, resetToFTU } from '../helpers/preConditionsHelpers.js';
import { buildSelectorById, checkAlarm, csVnVHiddenMenu, getElementById, getElementByIdAndText, isElementDisplayedById, updateVnVValueWithPlusMinusClicks, waitForVisible } from '../helpers/uiHelpers.js';

import { loadStrings } from '../helpers/i18n.js';
import { logStep, logStepMessage } from '../helpers/logger.js';

// config
import config from '../helpers/config.js';
import { flowState, saveState } from '../helpers/flowState.js';
import { attachScreenshotFn } from '../helpers/screenshot.js';

import allureReporter from '@wdio/allure-reporter';

/*
Precondition:
CS with VV-VnV version

CS Hidden menu is available

Both pump and CS in FTU state

CS with active HCP mode 
*/

const testKey = "TM-2627";

let preconditionsPassed = false;

describe(`${testKey} - Save regimen with identical regimen start time for both segments - Test with apk VnV`, () => {
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

    it(`${testKey}`, async function () {
        try {
            allureReporter.addLabel('testKey', testKey);
            if (!preconditionsPassed) {
                // mark test as skipped in Mocha
                this.skip();
            }
            await logStep('Step 1 - Pair pump, VnV Edit Regimen screen with same day and night start 9:00 AM, Upload regimen', async () => {
                await step1(apiBaseUrl, pumpName, "09");
            });
            await logStep('Step 2 - Try again, Upload  valid regimen', async () => {
                await step2();
            });

            await logStep('Step 3 - Open dosing regimen settings, VnV Edit Regimen screen with same day and night start 9:00 AM, Upload regimen', async () => {
                await step3(apiBaseUrl, "08");
            });

            await logStep('Step 4 - Try again, Upload  valid regimen', async () => {
                await step4("04", "22");
            });

            await logStep('Uncheck Use VnV Edit Regimen screen', async () => {
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
async function step1(apiBaseUrl, pumpName, newStart) {
    logStepMessage("▶️ Step 1");
    await pairPump(pumpName);

    await csVnVHiddenMenu('Use VnV Edit Regimen screen');

    const nextBtn = await getElementById('tvSecond');
    await nextBtn.click();
    await browser.pause(100);

    await getElementByIdAndText('tvHeaderTitle', 'VnV Edit Regimen', false);

    const actualStartDay = "03:00";
    const actualStartNight = "21:00";

    await updateVnVValueWithPlusMinusClicks({
        mode: 'startHour',
        actualValue: actualStartDay,
        newValue: newStart
    });

    await updateVnVValueWithPlusMinusClicks({
        mode: 'startHour',
        actualValue: actualStartNight,
        newValue: newStart
    });

    await browser.pause(1000);
    await attachScreenshotFn("Step 1 - After updating start times");

    const uploadRegimensBtn = await getElementById('tvVnvUploadRegimens');
    await uploadRegimensBtn.click();

    await browser.pause(2000);

    await checkAlarm(
        'dialogs.ALERT_REGIMEN_UPLOAD_FAILED.alert_type_regimen_upload_failed_title',
        'dialogs.ALERT_REGIMEN_UPLOAD_FAILED.alert_type_regimen_upload_failed_info',
        { expectedStr: 'ID 1036 ' }
    );

    await verifyLogsContain(apiBaseUrl, `[REGIMENS] Info tst: 8\``, 3000, "error");
    logStepMessage("✅ Step 1");
}
async function step2() {
    logStepMessage("▶️ Step 2");
    const tryAgainBtn = await getElementById('tvThird', 'common.cmn_text_try_again');
    await tryAgainBtn.click();

    const uploadRegimensBtn = await getElementById('tvVnvUploadRegimens');
    await uploadRegimensBtn.click();

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
    logStepMessage("✅ Step 2");
}
async function step3(apiBaseUrl, newStart) {
    logStepMessage("▶️ Step 3");
    const headerMenu = await getElementById('ivHeaderMenu');
    await headerMenu.click();

    const dosingRegimenSettings = await getElementByIdAndText('tvItemTitle', 'screens.MENU.menu_item_regimen_settings');
    await dosingRegimenSettings.click();

    await getElementByIdAndText('tvHeaderTitle', 'VnV Edit Regimen', false);

    const actualStartDay = "03:00";
    const actualStartNight = "21:00";

    await updateVnVValueWithPlusMinusClicks({
        mode: 'startHour',
        actualValue: actualStartDay,
        newValue: newStart
    });

    await updateVnVValueWithPlusMinusClicks({
        mode: 'startHour',
        actualValue: actualStartNight,
        newValue: newStart
    });

    await browser.pause(1000);
    await attachScreenshotFn("Step 3 - After updating start times");

    const uploadRegimensBtn = await getElementById('tvVnvUploadRegimens');
    await uploadRegimensBtn.click();

    await browser.pause(2000);

    await checkAlarm(
        'dialogs.ALERT_REGIMEN_UPLOAD_FAILED.alert_type_regimen_upload_failed_title',
        'dialogs.ALERT_REGIMEN_UPLOAD_FAILED.alert_type_regimen_upload_failed_info',
        { expectedStr: 'ID 1036 ' }
    );

    await verifyLogsContain(apiBaseUrl, `[REGIMENS] Info tst: 8\``, 3000, "error");
    logStepMessage("✅ Step 3");
}
async function step4(newStartDay, newStartNight) {
    logStepMessage("▶️ Step 4");
    const tryAgainBtn = await getElementById('tvThird', 'common.cmn_text_try_again');
    await tryAgainBtn.click();

    const actualStartDay = "03:00";
    const actualStartNight = "21:00";

    await updateVnVValueWithPlusMinusClicks({
        mode: 'startHour',
        actualValue: actualStartDay,
        newValue: newStartDay
    });

    await updateVnVValueWithPlusMinusClicks({
        mode: 'startHour',
        actualValue: actualStartNight,
        newValue: newStartNight
    });

    const uploadRegimensBtn = await getElementById('tvVnvUploadRegimens');
    await uploadRegimensBtn.click();

    await getElementById('tvHeaderTitle', 'screens.BASAL_UPLOAD.basal_upload_screen_title');
    await getElementById('tvSettingsSyncInfo', 'screens.BASAL_UPLOAD.basal_upload_screen_content');

    await browser.pause(10000);

    const newStartDayHour = newStartDay + ":00";
    const newStartNightHour = newStartNight + ":00";
    await getElementByIdAndText('tvVnvSegmentStartTime', newStartDayHour, false);
    await getElementByIdAndText('tvVnvSegmentStartTime', newStartNightHour, false);
    logStepMessage(`✅ Regimen updated with Day start time ${newStartDayHour} and Night start time ${newStartNightHour}`);

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
    logStepMessage("✅ Step 4");
}

async function step5() {
    logStepMessage("▶️ Step 5");
    await csVnVHiddenMenu('Use VnV Edit Regimen screen');
    logStepMessage("✅ Step 5");
}
