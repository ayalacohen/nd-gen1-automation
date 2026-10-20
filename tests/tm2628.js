// helpers
import { clearPumpLogs, connectTwico, disconnectTwico } from '../helpers/apiHelpers.js';
import { resetToFTU } from '../helpers/preConditionsHelpers.js';
import { buildSelectorById, buildSelectorByText, enterPinCode, getElementById, getElementByIdAndText, isElementDisplayedById, scrollToItem, updateDateValueWithPlusMinusClicks, updateTimeValueWithPlusMinusClicks, waitForVisible, waitForVisibleWithRetry } from '../helpers/uiHelpers.js';

import { loadStrings } from '../helpers/i18n.js';
import { logStep, logStepMessage } from '../helpers/logger.js';

// config
import config from '../helpers/config.js';
import { formatDay, getMonthNameByLanguage, getPeriodFromHour, getRealDateTime, isStrictValidDateTime, parseFtuDate, parseStrictDateTime } from '../helpers/generalHelpers.js';
import { flowState, saveState } from '../helpers/flowState.js';

import allureReporter from '@wdio/allure-reporter';
import { adbCouplePump, adbGetDeviceDateTime, adbGetNonvolatileData } from '../helpers/adbHelpers.js';

/*
Precondition:
CS on version H3

CS on FTU state

Pump on FTU state

Pump is coupled
*/
const testKey = "TM-2628";
let preconditionsPassed = false;

describe(`${testKey} - CS upon FTU successful completion - CS should save FTU date in NVM`, () => {
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

            adbCouplePump();

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

        await logStep(`Step 1 - Pick "${config.languageLabels[config.language]}" language, Tap on "NEXT" button`, async () => {
            await step1();
        });

        await logStep('Step 2 - Tap on "NEXT" button, Set month, day and year, Tap on "DONE", Set current hour, Tap on "DONE"', async () => {
            await step2();
        });

        await logStep('Step 3 - Tap on "NEXT", Fully pair your pump to CS', async () => {
            await step3(pumpName);
        });

        await logStep('Step 4 - Tap on "NEXT" button, Set any regimen, Tap on "Activate Regimen"', async () => {
            await step4();
        });

        await logStep('Step 5 - Tap on "Get started" button on "Set up completed" screen, Tap on "Get started" button on "Disclaimer" screen,adb shell server_daemon_nonvolotile print', async () => {
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

async function step1() {
    logStepMessage("▶️ Step 1");
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

    const nextBtn = await getElementById('tvSecond');
    await nextBtn.click();
    await browser.pause(100);

    await getElementById('tvHeaderTitle', 'screens.FTU_STARTUP.title_start_up_ftu');

    await getElementByIdAndText('tvStartupItemTitle', 'screens.FTU_STARTUP.ftu_set_date_time');

    await getElementByIdAndText('tvStartupItemTitle', 'screens.FTU_STARTUP.pair_pump_ftu');

    await getElementByIdAndText('tvStartupItemTitle', 'screens.FTU_STARTUP.set_regimens_title');

    await getElementById('tvSecond', 'common.cmn_text_next');
    logStepMessage("✅ Step 1");
}

async function step2() {
    logStepMessage("▶️ Step 2");
    const nextBtn = await getElementById('tvSecond', 'common.cmn_text_next');
    await nextBtn.click();
    await browser.pause(1000);
    await getElementById('tvHeaderTitle', 'screens.DATE_TIME.ftu_select_month');

    await getElementById('tvMessageContainerInfo', 'screens.DATE_TIME.ftu_select_date_info');

    const realDateTime = getRealDateTime();

    let fieldToUpdate= await getElementById('tvYear');
    let fieldToUpdateValue= await fieldToUpdate.getText();
    await fieldToUpdate.click();
    await browser.pause(100);

    await updateDateValueWithPlusMinusClicks({
        field: 'year',
        actualValue: fieldToUpdateValue,
        newValue: realDateTime.year.toString()
    });

    fieldToUpdate= await getElementById('tvMonth');
    fieldToUpdateValue= await fieldToUpdate.getText();
    await fieldToUpdate.click();
    await browser.pause(100);

    await updateDateValueWithPlusMinusClicks({
        field: 'month',
        actualValue: fieldToUpdateValue, 
        newValue: getMonthNameByLanguage(realDateTime.month)
    });

    fieldToUpdate= await getElementById('tvDay');
    fieldToUpdateValue= await fieldToUpdate.getText();
    await fieldToUpdate.click();
    await browser.pause(100);

    await updateDateValueWithPlusMinusClicks({
        field: 'day',
        actualValue: fieldToUpdateValue,
        newValue: formatDay(realDateTime.day)
    });

    let doneBtn = await getElementById('tvSecond', 'common.cmn_text_done');
    await doneBtn.click();
    await browser.pause(1000);

    await getElementById('tvHeaderTitle', 'screens.DATE_TIME.ftu_set_time');

    let expectedTextKey;
    if (config.language === 'en_US') {
        expectedTextKey = 'screens.DATE_TIME.ftu_select_time_info';
    } else {
        expectedTextKey = 'screens.DATE_TIME.ftu_select_time_info_regular';
    }
    await getElementById('tvMessageContainerInfo', expectedTextKey);

    // AM/PM if needed
    if (config.language === "en_US") {
        const previousAdbDateTime = adbGetDeviceDateTime();

        const previousDeviceTimePeriod = getPeriodFromHour(previousAdbDateTime.hour);
        const reaTimePeriod = getPeriodFromHour(realDateTime.hour);

        logStepMessage(`🕒 Previous device period: ${previousDeviceTimePeriod}, Real period: ${reaTimePeriod}`);

        if (previousDeviceTimePeriod !== reaTimePeriod) {
            logStepMessage(`🔁 Switching period ${previousDeviceTimePeriod} → ${reaTimePeriod}`);
            const periodSwitch = await getElementById('ivTimePeriodSwitch');
            await periodSwitch.click();
            await browser.pause(100);
        } else {
            logStepMessage(`✅ Period already correct (${previousDeviceTimePeriod})`);
        }
    }

    fieldToUpdate= await getElementById('tvHour');
    fieldToUpdateValue= await fieldToUpdate.getText();
    await fieldToUpdate.click();
    await browser.pause(100);

    await updateTimeValueWithPlusMinusClicks({
        field: 'hour',
        actualValue: fieldToUpdateValue,
        newValue: realDateTime.hour.toString()
    });

    fieldToUpdate= await getElementById('tvMinutes');
    fieldToUpdateValue= await fieldToUpdate.getText();
    await fieldToUpdate.click();
    await browser.pause(100);

    await updateTimeValueWithPlusMinusClicks({
        field: 'minute',
        actualValue: fieldToUpdateValue,
        newValue: realDateTime.minute.toString()
    });

    doneBtn = await getElementById('tvSecond', 'common.cmn_text_done');
    await doneBtn.click();

    await getElementById('tvHeaderTitle', 'screens.FTU_STARTUP.ftu_set_date_time_prepared');

    await getElementById('tvDoneText', 'screens.FTU_STARTUP.ftu_set_date_time_prepared');

    await browser.pause(2000);

    await getElementById('tvHeaderTitle', 'screens.FTU_STARTUP.title_start_up_ftu');

    await getElementByIdAndText('tvStartupItemTitle', 'screens.FTU_STARTUP.ftu_set_date_time_prepared');

    await getElementByIdAndText('tvStartupItemTitle', 'screens.FTU_STARTUP.pair_pump_ftu');

    await getElementByIdAndText('tvStartupItemTitle', 'screens.FTU_STARTUP.set_regimens_title');
    logStepMessage("✅ Step 2");
}

async function step3(pumpName) {
    logStepMessage("▶️ Step 3");
    let nextBtn = await getElementById('tvSecond', 'common.cmn_text_next');
    await nextBtn.click();
    await browser.pause(1000);

    const pump = await waitForVisibleWithRetry(
        buildSelectorById('tvTitle') + `.text("${pumpName}")`,
        buildSelectorById('tvThird'),
        60000
    );
    await pump.click();

    await nextBtn.click();
    await browser.pause(100);

    await enterPinCode(config.globalParams.defaultPumpPinCode);

    nextBtn = await getElementById('tvSecond');
    await nextBtn.click();
    await browser.pause(200);

    await getElementById('tvHeaderTitle', 'screens.FTU_PUMP_PAIRING.ftu_pump_pair_title_completed');
    await getElementById('tvDoneText', 'common.cmn_action_finished');

    await waitForVisible(
        buildSelectorById('tvSecond'),
        null,
        20000
    );

    await getElementById('tvHeaderTitle', 'screens.FTU_STARTUP.title_start_up_ftu');
    await getElementByIdAndText('tvStartupItemTitle', 'screens.FTU_STARTUP.pair_pump_ftu_prepared');
    await getElementByIdAndText('tvStartupItemTitle', 'screens.FTU_STARTUP.set_regimens_title');

    logStepMessage("✅ Step 3");
}

async function step4() {
    logStepMessage("▶️ Step 4");
    const nextBtn = await getElementById('tvSecond', 'common.cmn_text_next');
    await nextBtn.click();
    await browser.pause(100);

    await waitForVisible(
        buildSelectorById('tvHeaderTitle'),
        'screens.REGIMEN_OVERVIEW.title_single_regimen_overview',
        15000
    );

    const activateRegimenBtn = await waitForVisible(
        buildSelectorById('tvSecond'),
        'common.cmn_regimen_activate_changes',
        15000
    );

    await activateRegimenBtn.click();

    await waitForVisible(
        buildSelectorById('tvHeaderTitle'),
        'screens.FTU_SYNC_DATA.ftu_sync_data_title'
    );

    await waitForVisible(
        buildSelectorById('tvHeaderTitle'),
        'screens.FTU_SETUP_DONE.set_up_done_title'
    );

    await getElementById('tvSecond', 'common.cmn_get_started');
    logStepMessage("✅ Step 4");
}

async function step5() {
    logStepMessage("▶️ Step 5");
    let getStarted = await getElementById('tvSecond','common.cmn_get_started');
    await getStarted.click();
    await browser.pause(100);

    await getElementById('tvCurrentPumpStatusTitle', 'screens.DISCLAIMER_SCREEN.text_mandatory_disclaimer');

    await waitForVisible(
        buildSelectorById('tvThird'),
        'common.cmn_get_started',
        10000
    );

    getStarted = await getElementById('tvThird','common.cmn_get_started');
    await getStarted.click();
    await browser.pause(100);

    await getElementById('tvHeaderTitle', 'screens.HOME.home_title');

    if (await isElementDisplayedById('tvDismissAlert')) {
        const audioBtn = await getElementById('tvDismissAlert');
        await audioBtn.click();
    }

    const headerMenu = await getElementById('ivHeaderMenu');
    await headerMenu.click();

    const versionDetails = await scrollToItem('screens.MENU.menu_item_version_details', true);
    await versionDetails.click();

    await scrollToItem('screens.ABOUT_SCREENS.about_pump_ftu_date', true);
    const pumpFtuDate = await getElementById('tvPumpFtuDate');
    const pumpFtuDateStr = await pumpFtuDate.getText();

    if (isStrictValidDateTime(pumpFtuDateStr, "pumpFtuDate")) {
        logStepMessage(`✅ Pump FTU date "${pumpFtuDateStr}" is in expected format`);
    } else {
        throw new Error(`❌ Pump FTU date "${pumpFtuDateStr}" is NOT in expected format`);
    }

    const backBtn = await getElementById('ivHeaderBack');
    await backBtn.click();

    const pumpFtuDateObj = parseStrictDateTime(pumpFtuDateStr, "pumpFtuDate");

    const nvData = adbGetNonvolatileData();
    logStepMessage(JSON.stringify(nvData));

    const requiredFields = [
        'main_sn',
        'main_sn',
        'som_sn',
        'cradle_sn',
        'ftu_date',
        'crc'
    ];

    for (const field of requiredFields) {
        if (!nvData[field]) {
        throw new Error(`❌ Missing field: ${field}`);
        }
    }
    logStepMessage(`✅ All required fields are present: ${requiredFields}`);

    // Validate FTU date format: yyyy-mm-dd:hh:mm:ss
    const ftuRegex = /^\d{4}-\d{2}-\d{2}:\d{2}:\d{2}:\d{2}$/;
    if (!ftuRegex.test(nvData.ftu_date)) {
        throw new Error(`❌ Invalid FTU date format: ${nvData.ftu_date}`);
    }
    logStepMessage(`✅ Valid FTU date format yyyy-mm-dd:hh:mm:ss: ${nvData.ftu_date}`);

    if (!/^\d+$/.test(nvData.crc)) {
        throw new Error(`❌ CRC is not numeric: ${nvData.crc}`);
    }
    logStepMessage(`✅ CRC is numeric: ${nvData.crc}`);

    const ftuDateObj = parseFtuDate(nvData.ftu_date);

    const nvFtuDateObj = new Date(
        ftuDateObj.getFullYear(),
        ftuDateObj.getMonth(),
        ftuDateObj.getDate(),
        ftuDateObj.getHours(),
        ftuDateObj.getMinutes(),
        0
    )

    const diffMs = Math.abs(pumpFtuDateObj.getTime() - nvFtuDateObj.getTime());
    const diffSec = diffMs / 1000;

    logStepMessage(
        `🆚 Comparing FTU dates:
        UI: ${pumpFtuDateObj}
        NV: ${nvFtuDateObj}
        Diff: ${diffSec.toFixed(1)} sec`
    );

    const toleranceSec = 120;

    if (diffSec > toleranceSec) {
        throw new Error(
            `❌ Pump FTU ≠ NV FTU (diff ${diffSec.toFixed(1)} sec, tolerance ${toleranceSec}s)`
        );
    }

    logStepMessage(`✅ Pump FTU matches NV FTU (within ${toleranceSec}s)`);
    logStepMessage("✅ Step 5");
}
