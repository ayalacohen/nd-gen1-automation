// helpers
import { clearPumpLogs, connectTwico, disconnectTwico, verifyLogsContain } from '../helpers/apiHelpers.js';
import { resetToFTU } from '../helpers/preConditionsHelpers.js';
import { buildSelectorById, buildSelectorByText, getCachedString, getElementById, waitForDisappear, waitForPumpDetected, waitForVisibleWithRetry, waitWithHeartbeat } from '../helpers/uiHelpers.js';

import { loadStrings } from '../helpers/i18n.js';
import { logStep, logStepMessage } from '../helpers/logger.js';

// config
import config from '../helpers/config.js';
import { flowState, saveState } from '../helpers/flowState.js';

import allureReporter from '@wdio/allure-reporter';
import { adbCouplePump, adbDecouplePump } from '../helpers/adbHelpers.js';

/*
Precondition:
Pump and CS are before FTU.

Date and time are set correctly Startup screen is displayed.

the pump is uncoupled.
*/
const testKey = "TM-264";
let preconditionsPassed = false;

describe(`${testKey} - Pair Pump - pump detection`, () => {
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

            await logStep('Clear pump logs', async () => {
                await clearPumpLogs(apiBaseUrl);
            });

            await logStep('Reset to FTU', async () => {
                await resetToFTU(apiBaseUrl);
            });

            await logStep('Set language, date and time', async () => {
                await setLanguageDateAndTime();
            });

            await logStep('Decouple the pump', async () => {
                adbDecouplePump();
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

        await logStep('Step 1 - Click Next', async () => {
            await step1();
        });

        await logStep('Step 2 - Do not insert the pump', async () => {
            await step2();
        });

        await logStep('Step 3 - Insert the pump', async () => {
            await step3(apiBaseUrl, pumpName);
        });

        await logStep('Step 4 - Remove the pump from the cradle', async () => {
            await step4();
        });

        await logStep('Step 5 - Insert the pump into the cradle and click OK to confirm the dialog', async () => {
            await step5();
        });

        // return;
        await logStep('Step 6 - Decouple the pump and wait 30s', async () => {
            await step6();
        });

        await logStep('Step 7 - Press OK and couple the pump', async () => {
            await step7(pumpName);
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
    const nextBtn = await getElementById('tvSecond');
    await nextBtn.click();
    await browser.pause(1000);

    await getElementById('tvHeaderTitle', 'common.cmn_insert_pump');
    await getElementById('tvMessageContainerInfo', 'common.cmn_insert_pump_more_info');
    logStepMessage("✅ Step 1");
}

async function step2() {
    logStepMessage("▶️ Step 2");
    logStepMessage("Wait for 10s");
    await browser.pause(10000);
    await getElementById('tvHeaderTitle', 'common.cmn_insert_pump');
    logStepMessage(`"Insert pump" screen remains on the CS screen`);
    logStepMessage("✅ Step 2");
}

async function step3(apiBaseUrl, pumpName) {
    logStepMessage("▶️ Step 3");
    adbCouplePump();

    await waitForPumpDetected();
    await browser.pause(3000);

    const headerTitle = await getElementById('tvHeaderTitle');
    const headerTitleTxt = await headerTitle.getText();
    const selectPumpTxt1 = getCachedString('screens.FTU_PUMP_LIST.ftu_pump_list_title');
    const selectPumpTxt2 = getCachedString('screens.FTU_PUMP_LIST.ftu_pump_list_title_search');

    if (headerTitleTxt == selectPumpTxt1) {
        logStepMessage(`✅ Element "tvHeaderTitle" text as expected: "${selectPumpTxt1}" [screens.FTU_PUMP_LIST.ftu_pump_list_title]`);
    }
    else if (headerTitleTxt == selectPumpTxt2){
        logStepMessage(`✅ Element "tvHeaderTitle" text as expected: "${selectPumpTxt2}" [screens.FTU_PUMP_LIST.ftu_pump_list_title_search]`);
    }
    else {
        throw new Error(`❌ Element text mismatch: expected "${selectPumpTxt1}" or "${selectPumpTxt2}", got "${headerTitleTxt}" `);
    }

    try {
        const pump = await waitForVisibleWithRetry(
            buildSelectorById('tvTitle') + `.text("${pumpName}")`,
            buildSelectorById('tvThird') + `.text("${getCachedString('common.cmn_text_try_again')}")`,
            60000
        );
    }
    catch {
        throw new Error(`❌ ${pumpName} doesn't appear in the list`);
    }
    logStepMessage(`✅ ${pumpName} appears in the list`);

    await verifyLogsContain(apiBaseUrl, `coupled evnt:||[INFO]:PWR Mode:0`, 3000, "error");
    logStepMessage("✅ Step 3");
}

async function step4() {
    logStepMessage("▶️ Step 4");
    adbDecouplePump();
    await browser.pause(5000);

    await getElementById('tvAlarmTitle', 'dialogs.UNEXPECTED_DECOUPLE_FTU.alert_type_pump_decoupled_general_title_ftu');
    logStepMessage("✅ Step 4");
}

async function step5() {
    logStepMessage("▶️ Step 5");
    adbCouplePump();

    const nextBtn = await getElementById('tvThird', 'common.cmn_text_ok');
    await nextBtn.click();

    await waitForPumpDetected();
    await browser.pause(3000);
    const headerTitle = await getElementById('tvHeaderTitle');
    const headerTitleTxt = await headerTitle.getText();
    const selectPumpTxt1 = getCachedString('screens.FTU_PUMP_LIST.ftu_pump_list_title');
    const selectPumpTxt2 = getCachedString('screens.FTU_PUMP_LIST.ftu_pump_list_title_search');

    if (headerTitleTxt == selectPumpTxt1) {
        logStepMessage(`✅ Element "tvHeaderTitle" text as expected: "${selectPumpTxt1}" [screens.FTU_PUMP_LIST.ftu_pump_list_title]`);
    }
    else if (headerTitleTxt == selectPumpTxt2){
        logStepMessage(`✅ Element "tvHeaderTitle" text as expected: "${selectPumpTxt2}" [screens.FTU_PUMP_LIST.ftu_pump_list_title_search]`);
    }
    else {
        throw new Error(`❌ Element text mismatch: expected "${selectPumpTxt1}" or "${selectPumpTxt2}", got "${headerTitleTxt}" `);
    }
    logStepMessage("✅ Step 5");
}

async function step6() {
    logStepMessage("▶️ Step 6");
    adbDecouplePump();
    await waitWithHeartbeat(30000);

    await getElementById('tvAlarmTitle', 'dialogs.UNEXPECTED_DECOUPLE_FTU.alert_type_pump_decoupled_general_title_ftu');
    logStepMessage("✅ Step 6");
}

async function step7(pumpName) {
    logStepMessage("▶️ Step 7");
    adbCouplePump();

    const nextBtn = await getElementById('tvThird', 'common.cmn_text_ok');
    await nextBtn.click();
    await browser.pause(100);

    await waitForDisappear(buildSelectorById('tvAlarmTitle'));

    await waitForPumpDetected();
    await browser.pause(3000);
    const headerTitle = await getElementById('tvHeaderTitle');
    const headerTitleTxt = await headerTitle.getText();
    const selectPumpTxt1 = getCachedString('screens.FTU_PUMP_LIST.ftu_pump_list_title');
    const selectPumpTxt2 = getCachedString('screens.FTU_PUMP_LIST.ftu_pump_list_title_search');

    if (headerTitleTxt == selectPumpTxt1) {
        logStepMessage(`✅ Element "tvHeaderTitle" text as expected: "${selectPumpTxt1}" [screens.FTU_PUMP_LIST.ftu_pump_list_title]`);
    }
    else if (headerTitleTxt == selectPumpTxt2){
        logStepMessage(`✅ Element "tvHeaderTitle" text as expected: "${selectPumpTxt2}" [screens.FTU_PUMP_LIST.ftu_pump_list_title_search]`);
    }
    else {
        throw new Error(`❌ Element text mismatch: expected "${selectPumpTxt1}" or "${selectPumpTxt2}", got "${headerTitleTxt}" `);
    }

    try {
        const pump = await waitForVisibleWithRetry(
            buildSelectorById('tvTitle') + `.text("${pumpName}")`,
            buildSelectorById('tvThird') + `.text("${getCachedString('common.cmn_text_try_again')}")`,
            60000
        );
    }
    catch {
        throw new Error(`❌ ${pumpName} doesn't appear in the list`);
    }
    logStepMessage(`✅ ${pumpName} appears in the list`);
    logStepMessage("✅ Step 7");
}


export async function setLanguageDateAndTime() {
    // try to select language first (according to config.languageLabels for current config.language)
    try {
        const langLabel = config.languageLabels && config.languageLabels[config.language];
        if (langLabel) {
            const selector = buildSelectorByText(langLabel);
            const langEl = await browser.$(selector);
            if (await langEl.isDisplayed()) {
                await langEl.click();
                await browser.pause(500);
            }
        }
    } catch (err) {
        // if language selection fails, continue the flow silently
    }

    let nextBtn = await getElementById('tvSecond');

    for (let i = 0; i < 4; i++) {
        await nextBtn.click();
        await browser.pause(1000);
    }
}