// helpers
import { adbCouplePump } from '../helpers/adbHelpers.js';
import { clearPumpLogs, connectTwico, disconnectTwico, updateParameterValue, verifyLogsContain } from '../helpers/apiHelpers.js';
import { buildSelectorById, checkAlarm, csVnVHiddenMenu, enterPinRegimen, getCachedString, getElementById, getElementByIdAndText, isElementDisplayedById, isElementDisplayedByText, updateValueWithPlusMinusClicks } from '../helpers/uiHelpers.js';

import { loadStrings } from '../helpers/i18n.js';
import { logStep, logStepMessage } from '../helpers/logger.js';

// config
import config from '../helpers/config.js';
import { flowState, saveState } from '../helpers/flowState.js';

import allureReporter from '@wdio/allure-reporter';


/*
Precondition:

HCP mode

Use dedicated VnV apk version

Set up  in TwikoGUI parameter PERFORMANCE_MODE_FLAG = 1

Start Delivery

Pump is coupled
*/
const testKey = "TM-97";
let preconditionsPassed = false;

describe(`${testKey} - Regimen edit during Active delivery (apk VnV)`, () => {
    const { apiBaseUrl, globalParams } = config;
    const { portName, defaultRegimenPinCode } = { ...globalParams };

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

            await logStep('Clear pump logs', async () => {
                await clearPumpLogs(apiBaseUrl);
            });

            await logStep('Click GET STARTED', async () => {
                if (await isElementDisplayedByText(getCachedString('common.cmn_get_started'), 20000)) {
                    logStepMessage("Click GET STARTED");
                    const getStarted = await getElementById('tvThird');
                    await getStarted.click();
                    await browser.pause(2000);
                } else {
                    logStepMessage("Skipping this step...");
                }
            });

            await logStep('Couple the pump', async () => {
                adbCouplePump();
                await browser.pause(7000);
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

        await logStep('Step 1 - Check Upload during active delivery, edit regimen with day start time 02:00 AM ', async () => {
            await step1(apiBaseUrl, defaultRegimenPinCode, "3:00 AM", "2:00 AM");
        });

        await logStep('Uncheck Upload during active delivery and set PERFORMANCE_MODE_FLAG back to 0', async () => {
            const tryAgainBtn = await getElementById('tvThird', 'common.cmn_text_try_again');
            await tryAgainBtn.click();

            const backBtn = await getElementById('ivHeaderBack');
            await backBtn.click();

            await csVnVHiddenMenu('Upload during active delivery');

            await updateParameterValue(apiBaseUrl, "PERFORMANCE_MODE_FLAG", 70, 0);
            await browser.pause(3000);

            if (await isElementDisplayedById('tvAlarmTitle')) {
                const turnOffBtn = await getElementById('tvThird');
                await turnOffBtn.click();
            }
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

async function step1(apiBaseUrl, pinCode, actualStartDay, newStartDay) {
    logStepMessage("▶️ Step 1");
    await csVnVHiddenMenu('Upload during active delivery');
    await browser.pause(2000);

    const headerMenu = await getElementById('ivHeaderMenu');
    await headerMenu.click();

    const dosingRegimenSettings = await getElementByIdAndText('tvItemTitle', 'screens.MENU.menu_item_regimen_settings');
    await dosingRegimenSettings.click();

    const editRegimenBtn =  await getElementById('tvSecond', 'common.cmn_regimen_edit_changes');
    await editRegimenBtn.click();

    await enterPinRegimen(pinCode);
    if (await isElementDisplayedById('tvPinError')) {
        const pinError = await browser.$(buildSelectorById('tvPinError'));
        const pinErrorStr = await pinError.getText();
        throw new Error(`❌ ${pinErrorStr} [screens.REGIMEN_MENU.regiment_wrong_pin]`);
    }
    await getElementById('tvHeaderTitle', 'screens.REGIMEN_OVERVIEW.title_single_regimen_edit');

    await updateValueWithPlusMinusClicks({
        mode: 'hour',
        actualValue: actualStartDay,
        newValue: newStartDay
    });

    const doneBtn = await getElementById('tvSecond', 'common.cmn_text_done');
    await doneBtn.click();

    const saveRegimenBtn = await getElementById('tvSecond', 'common.cmn_regimen_save_changes');
    await saveRegimenBtn.click();
    await browser.pause(200);

    await checkAlarm(
        'dialogs.ALERT_REGIMEN_UPLOAD_FAILED.alert_type_regimen_upload_failed_title',
        'dialogs.ALERT_REGIMEN_UPLOAD_FAILED.alert_type_regimen_upload_failed_info',
        { expectedStr: 'ID 1036 ' }
    );

    await verifyLogsContain(apiBaseUrl, `[REGIMENS] Info tst: 1\``, 3000, "error");
    logStepMessage("✅ Step 1");
}
