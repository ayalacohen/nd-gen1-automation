// helpers
import { adbCouplePump, adbDecouplePump, adbDownloadCSLogs } from '../helpers/adbHelpers.js';
import { clearPumpLogs, connectCartridgeToPump, connectTwico, disconnectCartridgeFromPump, disconnectTwico, pressPumpButton, updateParameterValue, verifyLogsContain } from '../helpers/apiHelpers.js';
import { buildSelectorById, checkAlarm, csClearCSLogs, getCachedString, getElementById, isElementDisplayedByText, scrollToItem, waitForDisappear, waitForVisible, waitWithHeartbeat } from '../helpers/uiHelpers.js';

import { loadStrings } from '../helpers/i18n.js';
import { logStep, logStepMessage } from '../helpers/logger.js';

// config
import config from '../helpers/config.js';
import { flowState, saveState } from '../helpers/flowState.js';

import allureReporter from '@wdio/allure-reporter';
import { verifyStartFilling } from '../helpers/dbHelpers.js';

/*
Precondition:
Pump is paired to the CS and out of the cradle

Cartridge isn’t attached to the pump

Pump is after FTU, in “Medication is empty” alarm

DELAY_PRIOR_FILLING = 0

Push all 6 English_US video files to CS

       .\adb.exe shell

        mkdir -p /data/NEURODERM/LANGUAGES/VIDEO/en_US

     .\adb.exe push .\en_US_Cleaning_infusion_sites.mp4 /data/NEURODERM/LANGUAGES/VIDEO/en_US

Recalculate md5

      .\adb.exe shell

     server_daemon_monitor_language_create

     reboot
*/
const testKey = "TM-194";
let preconditionsPassed = false;

describe(`${testKey} - Treatment preparation - positive flow`, () => {
    const { apiBaseUrl, globalParams } = config;
    const { portName } = { ...globalParams };

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

            await logStep('Decouple the pump', async () => {
                adbDecouplePump();
                await browser.pause(7000);
            });

            await logStep('Disconnect cartridge from pump', async () => {
                await disconnectCartridgeFromPump(apiBaseUrl);
            });

            await logStep('Set DELAY_PRIOR_FILLING_TH_SEC_DEFAULT to 0', async () => {
                await updateParameterValue(apiBaseUrl, "DELAY_PRIOR_FILLING_TH_SEC_DEFAULT", 79, 0);
            });

            await logStep('Clear CS logs', async () => {
                await csClearCSLogs();
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

        // Ensure we are on HOME screen
        await logStep('Click GET STARTED / Back to Home', async () => {
            if (await isElementDisplayedByText(getCachedString('common.cmn_get_started'), 20000)) {
            logStepMessage("Click GET STARTED");
            const getStarted = await getElementById('tvThird');
            await getStarted.click();
            }

            if (!await isElementDisplayedByText(getCachedString('screens.HOME.home_title'), 20000)) {
            logStepMessage("Click Back to Home");
            const backBtn = await getElementById('ivHeaderBack');
            await backBtn.click();
            }
        });

        await logStep('Step 1 - Press on "Prepare treatment" button', async () => {
            await step1();
        });

        await logStep('Step 2 - Click on "Next" button on "Dispose of used materials" screen', async () => {
            await step2();
        });

        await logStep('Step 3 - Insert pump without cartridge to the cradle', async () => {
            await step3();
        });

        await logStep('Step 4 - Connect cartridge to the pump', async () => {
            await step4(apiBaseUrl);
        });

        await logStep('Step 5 - Decouple the pump and press on "Next" button on "Connect a new cartridge" screen', async () => {
            await step5(apiBaseUrl);
        });

        await logStep('Step 6 - Insert pump to the cradle', async () => {
            await step6();
        });

        await logStep('Step 7 - Press on "Next" button on "Insert new vials" screen', async () => {
            await step7();
        });

        await logStep('Step 8 - Press on "Start filling" button', async () => {
            await step8(apiBaseUrl);
        });

        await logStep('Step 9 - Wait till fill process is completed', async () => {
            await step9(apiBaseUrl);
        });

        await logStep('Step 10 - Uncouple the pump on "Remove vial adapters" screen', async () => {
            await step10(apiBaseUrl);
        });

        await logStep('Step 11 - Insert pump to the cradle', async () => {
            await step11();
        });

        await logStep('Step 12 - Press on "Next" button on "Removal vial adapters" screen', async () => {
            await step12();
        });

        await logStep('Step 13 -  Uncouple the pump on "Connect infusion sets" screen', async () => {
            await step13(apiBaseUrl);
        });

        await logStep('Step 14 - Insert pump to the cradle', async () => {
            await step14();
        });

        await logStep('Step 15 - Press on "Prime tubing" button', async () => {
            await step15(apiBaseUrl);
        });

        await logStep('Step 16 - Pump state after priming completion', async () => {
            await step16(apiBaseUrl);
        });

        await logStep('Step 17 - Press on "Identify infusion sites"', async () => {
            await step17();
        });

        await logStep('Step 18 - Wait for video end click "back" button.', async () => {
            await step18();
        });

        await logStep('Step 19 - After priming is completed, press on "Next" button on "Prepare infusion sites"', async () => {
            await step19();
        });

        await logStep('Step 20 - Press on "Next" button on "Insert cannulas" screen', async () => {
            await step20();
        });

        await logStep('Step 21 - Press on "Next" button on "Connect tubes to cannulas" scren', async () => {
            await step21();
        });

        await logStep('Step 22 - Remove Pump from the CS (uncoupled state).', async () => {
            await step22();
        });

        await logStep('Step 23 -  Press ones on the pump\'s button to start delivery', async () => {
            await step23(apiBaseUrl);
        });

        await logStep('Step 24 - Couple the pump, open side menu -> version details and scroll down to Executed cycles count', async () => {
            await step24();
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
    await browser.pause(1000);
    await getElementById('tvHeaderTitle', 'screens.REMOVE_OLD_DISPOSABLE.remove_old_disposable_title');
    await getElementById('tvFirstStep', 'screens.REMOVE_OLD_DISPOSABLE.remove_old_disposable_instruction_first');
    await getElementById('tvSecondStep', 'screens.REMOVE_OLD_DISPOSABLE.remove_old_disposable_instruction_second');
    await getElementById('tvThirdStep', 'screens.REMOVE_OLD_DISPOSABLE.remove_old_disposable_instruction_third');

    const fillDetailNextBtn = await getElementById('tvFillDetailNext', 'common.cmn_text_next');
    if (!(await fillDetailNextBtn.isEnabled())) {
        throw new Error("❌ NEXT disabled");
    }
    logStepMessage("✅ NEXT enabled");
    logStepMessage("✅ Step 1");
}

async function step2() {
    logStepMessage("▶️ Step 2");
    const fillDetailNextBtn = await getElementById('tvFillDetailNext', 'common.cmn_text_next');
    await fillDetailNextBtn.click();
    await browser.pause(1000);

    await getElementById('tvHeaderTitle', 'common.cmn_insert_pump');
    await getElementById('tvMessageContainerInfo', 'common.cmn_insert_pump_more_info');
    logStepMessage("✅ Step 2");
}

async function step3() {
    logStepMessage("▶️ Step 3");
    adbCouplePump();
    await browser.pause(5000);

    await waitForVisible(
        buildSelectorById('tvHeaderTitle'),
        'screens.CONNECT_A_NEW_CARTRIDGE.connect_new_cartridge_title',
        10000,
        300
    );

    await getElementById('tvMessageContainerInfo', 'screens.CONNECT_A_NEW_CARTRIDGE.connect_new_cartridge_info');

    const nextBtn = await getElementById('tvSecond', 'common.cmn_text_next');
    if ((await nextBtn.isEnabled())) {
        throw new Error("❌ NEXT enabled");
    }
    logStepMessage("✅ NEXT disabled");
    logStepMessage("✅ Step 3");
}

async function step4(apiBaseUrl) {
    logStepMessage("▶️ Step 4");
    await connectCartridgeToPump(apiBaseUrl);

    const nextBtn = await getElementById('tvSecond', 'common.cmn_text_next');
    await browser.waitUntil(async () => await nextBtn.isEnabled(), {
        timeout: 10000,
        timeoutMsg: "❌ NEXT did not enable"
    });
    logStepMessage("✅ Step 4");
}

async function step5(apiBaseUrl) {
    logStepMessage("▶️ Step 5");
    adbDecouplePump();
    await browser.pause(7000);
    const nextBtn = await getElementById('tvSecond', 'common.cmn_text_next');
    await nextBtn.click();

    await checkAlarm(
        'alerts.FILL_PROCESS_INTERRUPTED.alert_title_fill_process_interrupted',
        'alerts.FILL_PROCESS_INTERRUPTED.alert_description_fill_process_interrupted',
        { expectedStr: 'ID 31 ' }
    );

    await verifyLogsContain(apiBaseUrl, `[BLE] Received Pump Command: 14\``, 3000, "error");
    logStepMessage("✅ Step 5");
}

async function step6() {
    logStepMessage("▶️ Step 6");
    adbCouplePump();
    await browser.pause(5000);

    await waitForDisappear(buildSelectorById('tvAlarmTitle'), 5000);

    await getElementById('tvHeaderTitle', 'screens.CONNECT_VIAL.connect_vial_screen_title');
    const message = await getElementById('tvMessageContainerInfo');
    const actualMessageStr = await message.getText();
    const expectedMessageStr = getCachedString('screens.CONNECT_VIAL.connect_vial_screen_info_second') + "\n\n" + getCachedString('screens.CONNECT_VIAL.connect_vial_screen_info_third');
    if (actualMessageStr !== expectedMessageStr) {
        throw new Error(`❌ Element text mismatch: expected "${expectedMessageStr}", got "${actualMessageStr}" ['screens.CONNECT_VIAL.connect_vial_screen_info_second' 'screens.CONNECT_VIAL.connect_vial_screen_info_third']`);
    }
    logStepMessage(`✅ Element "tvMessageContainerInfo" text as expected: "${expectedMessageStr}" ['screens.CONNECT_VIAL.connect_vial_screen_info_second' 'screens.CONNECT_VIAL.connect_vial_screen_info_third']`);

    await getElementById('tvSecond', 'common.cmn_text_next');
    logStepMessage("✅ Step 6");
}

async function step7() {
    logStepMessage("▶️ Step 7");
    const nextBtn = await getElementById('tvSecond', 'common.cmn_text_next');
    await nextBtn.click();
    await browser.pause(1000);

    await getElementById('tvHeaderTitle', 'screens.PREPARE_FOR_FILLING.prepare_for_filling_screen');
    await getElementById('tvMessageContainerInfo', 'screens.PREPARE_FOR_FILLING.prepare_for_filling_message');

    const startFillingBtn = await getElementById('tvSecond', 'common.cmn_start_filling');
    await browser.waitUntil(async () => await startFillingBtn.isEnabled(), {
        timeout: 5000,
        timeoutMsg: "❌ START FILLING did not enable"
    });
    logStepMessage("✅ Step 7");
}

async function step8(apiBaseUrl) {
    logStepMessage("▶️ Step 8");
    const startFillingBtn = await getElementById('tvSecond', 'common.cmn_start_filling');
    await startFillingBtn.click();

    await getElementById('tvHeaderTitle', 'screens.FILLING_MEDICATION.filling_medication_ftu');
    await getElementById('textView3', 'screens.FILLING_MEDICATION.filling_medication_ask');
    await getElementById('tvCartridgeInfo', 'screens.FILLING_MEDICATION.text_filling_process_eta');

    await waitWithHeartbeat(90000);

    // Alarms cleared
    // Alarms: 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2

    await verifyLogsContain(apiBaseUrl, `Alarms: 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2||[WDT] Start\`||[RST] WDTst\`||[WDT] End\`||[BIT] ALL Tst PASS\`||[FSM] New state: Filling\`||[FIL] started event\`||BLE: CLOCK_SYNC`, 3000, "error");

    const dbFile = "db/194_8_control_station_logs.db";
    adbDownloadCSLogs(dbFile);

    verifyStartFilling(dbFile);
    logStepMessage("✅ Step 8");
}

async function step9(apiBaseUrl) {
    logStepMessage("▶️ Step 9");
    const progressFilingMedicine = await getElementById('progressFilingMedicine');

    // filling should take 7 mn = 7*60*1000 ms
    await waitForDisappear(buildSelectorById('progressFilingMedicine'), 420000);
    await getElementById('tvHeaderTitle', 'screens.REMOVE_VIAL_ADAPTERS.remove_vial_adapters_title');
    const nextBtn = await getElementById('tvSecond', 'common.cmn_text_next');
    if (!(await nextBtn.isEnabled())) {
        throw new Error("❌ NEXT disabled");
    }
    logStepMessage("✅ NEXT enabled");

    await verifyLogsContain(apiBaseUrl, `[FSM] New state: Filling(Priming)\``, 3000, "error");
    logStepMessage("✅ Step 9");
}

async function step10(apiBaseUrl) {
    logStepMessage("▶️ Step 10");
    adbDecouplePump();
    await browser.pause(7000);

    await checkAlarm(
        'alerts.FILL_PROCESS_INTERRUPTED.alert_title_fill_process_interrupted',
        'alerts.FILL_PROCESS_INTERRUPTED.alert_description_fill_process_interrupted',
        { expectedStr: 'ID 31 ' }
    );

    await verifyLogsContain(apiBaseUrl, `[Alarm] Priority ID: 8\`||[Alarm] Fill process interrupted\``, 3000, "error");
    logStepMessage("✅ Step 10");
}

async function step11() {
    logStepMessage("▶️ Step 11");
    adbCouplePump();
    await browser.pause(5000);

    await waitForDisappear(buildSelectorById('tvAlarmTitle'), 5000);

    const nextBtn = await getElementById('tvSecond', 'common.cmn_text_next');
    if (!(await nextBtn.isEnabled())) {
        throw new Error("❌ NEXT disabled");
    }
    logStepMessage("✅ NEXT enabled");
    logStepMessage("✅ Step 11");
}
async function step12() {
    logStepMessage("▶️ Step 12");
    const nextBtn = await getElementById('tvSecond', 'common.cmn_text_next');
    await nextBtn.click();
    await browser.pause(1000);

    await getElementById('tvHeaderTitle', 'screens.CONNECT_TUBING_SCREEN.connect_tubing_title');
    const message = await getElementById('tvMessageContainerInfo');
    const actualMessageStr = await message.getText();
    const expectedMessageStr = getCachedString('screens.CONNECT_TUBING_SCREEN.connect_tubing_info_first') + "\n\n" + getCachedString('screens.CONNECT_TUBING_SCREEN.connect_tubing_info_second') + "\n\n" + getCachedString('screens.CONNECT_TUBING_SCREEN.connect_tubing_info_third');
    if (actualMessageStr !== expectedMessageStr) {
        throw new Error(`❌ Element text mismatch: expected "${expectedMessageStr}", got "${actualMessageStr}" ['screens.CONNECT_TUBING_SCREEN.connect_tubing_info_first' 'screens.CONNECT_TUBING_SCREEN.connect_tubing_info_second' 'screens.CONNECT_TUBING_SCREEN.connect_tubing_info_third']`);
    }
    logStepMessage(`✅ Element "tvMessageContainerInfo" text as expected: "${expectedMessageStr}" ['screens.CONNECT_TUBING_SCREEN.connect_tubing_info_first' 'screens.CONNECT_TUBING_SCREEN.connect_tubing_info_second' 'screens.CONNECT_TUBING_SCREEN.connect_tubing_info_third']`);

    const primeTubbingBtn = await getElementById('tvSecond', 'screens.CONNECT_TUBING_SCREEN.connect_tubing_prime_button');
    if (!(await primeTubbingBtn.isEnabled())) {
        throw new Error("❌ PRIME TUBING disabled");
    }
    logStepMessage("✅ PRIME TUBING enabled");
    logStepMessage("✅ Step 12");
}

async function step13(apiBaseUrl) {
    logStepMessage("▶️ Step 13");
    adbDecouplePump();
    await browser.pause(7000);

    await checkAlarm(
        'alerts.FILL_PROCESS_INTERRUPTED.alert_title_fill_process_interrupted',
        'alerts.FILL_PROCESS_INTERRUPTED.alert_description_fill_process_interrupted',
        { expectedStr: 'ID 31 ' }
    );

    await verifyLogsContain(apiBaseUrl, `[Alarm] Priority ID: 8\`||[Alarm] Fill process interrupted\``, 3000, "error");
    logStepMessage("✅ Step 13");
}

async function step14() {
    logStepMessage("▶️ Step 14");
    adbCouplePump();
    await browser.pause(7000);

    await waitForDisappear(buildSelectorById('tvAlarmTitle'), 5000);

    const primeTubbingBtn = await getElementById('tvSecond', 'screens.CONNECT_TUBING_SCREEN.connect_tubing_prime_button');
    if (!(await primeTubbingBtn.isEnabled())) {
        throw new Error("❌ PRIME TUBING disabled");
    }
    logStepMessage("✅ PRIME TUBING enabled");
    logStepMessage("✅ Step 14");
}

async function step15(apiBaseUrl) {
    logStepMessage("▶️ Step 15");
    const primeTubbingBtn = await getElementById('tvSecond', 'screens.CONNECT_TUBING_SCREEN.connect_tubing_prime_button');
    await primeTubbingBtn.click();
    await browser.pause(1000);

    await getElementById('tvHeaderTitle', 'screens.PREPARE_INFUSION_SITES.screen_prepare_infusion_sites_title');
    await getElementById('tvFirstStep', 'screens.PREPARE_INFUSION_SITES.screen_prepare_infusion_sites_message_first');
    await getElementById('tvSecondStep', 'screens.PREPARE_INFUSION_SITES.screen_prepare_infusion_sites_message_second');
    await getElementById('tvThirdStep', 'screens.PREPARE_INFUSION_SITES.screen_prepare_infusion_sites_message_third');
    await getElementById('tvFillDetailShowMe', 'screens.PREPARE_INFUSION_SITES.screen_prepare_infusion_sites_button');

    const nextBtn = await getElementById('tvFillDetailNext', 'common.cmn_text_next');
    if (!(await nextBtn.isEnabled())) {
        throw new Error("❌ NEXT disabled");
    }
    logStepMessage("✅ NEXT enabled");

    await verifyLogsContain(apiBaseUrl, `[Priming] Start priming process\``, 3000, "error");
    logStepMessage("✅ Step 15");
}

async function step16(apiBaseUrl) {
    logStepMessage("▶️ Step 16");
    // [Priming] Priming done.Vol.pushed:30010`   [Priming] Priming done.Vol.pushed:30011`
    await verifyLogsContain(apiBaseUrl, `[Priming] Priming done.||[Alarm] Priority ID: 21\`||[FSM] New state: ReadyPaused\`||[Alarm] Treatment Paused (med)\``, 10000, "error");

    const treatementPauseTxt = getCachedString('alerts.LOW_TREATMENT_PAUSED.alert_title_low_treatment_paused').toUpperCase();
    if (await isElementDisplayedByText(treatementPauseTxt)) {
        throw new Error("❌ TREATMENT PAUSED alarm displayed [alerts.LOW_TREATMENT_PAUSED.alert_title_low_treatment_paused] upper case");
    }
    logStepMessage("✅ TREATMENT PAUSED alarm NOT displayed [alerts.LOW_TREATMENT_PAUSED.alert_title_low_treatment_paused] upper case");
    logStepMessage("✅ Step 16");
}

async function step17() {
    logStepMessage("▶️ Step 17");
    const identifyInfusionSitesBtn = await getElementById('tvFillDetailShowMe', 'screens.PREPARE_INFUSION_SITES.screen_prepare_infusion_sites_button');
    await identifyInfusionSitesBtn.click();
    await browser.pause(1000);
    logStepMessage("✅ Step 17");
}

async function step18() {
    logStepMessage("▶️ Step 18");
    await waitForVisible(
        buildSelectorById('ivVideoControl'),
        null,
        120000, // 2mn   tvVideoTime en_US 1:26 - en_150 1:30 - de_DE 1:47
        300
    );

    const backBtn = await getElementById('ivMovieBack');
    await backBtn.click();
    await browser.pause(1000);
    await getElementById('tvHeaderTitle', 'screens.PREPARE_INFUSION_SITES.screen_prepare_infusion_sites_title');
    logStepMessage("✅ Step 18");
}

async function step19() {
    logStepMessage("▶️ Step 19");
    let nextBtn = await getElementById('tvFillDetailNext', 'common.cmn_text_next');
    await nextBtn.click();
    await browser.pause(1000);

    await getElementById('tvHeaderTitle', 'screens.INSERT_CANNULA.insert_cannula_screen_title');
    await getElementById('tvFirstStep', 'screens.INSERT_CANNULA.insert_cannula_screen_info_first');
    await getElementById('tvSecondStep', 'screens.INSERT_CANNULA.insert_cannula_screen_info_second');
    await getElementById('tvThirdStep', 'screens.INSERT_CANNULA.insert_cannula_screen_info_third');

    nextBtn = await getElementById('tvFillDetailNext', 'common.cmn_text_next');
    if (!(await nextBtn.isEnabled())) {
        throw new Error("❌ NEXT disabled");
    }
    logStepMessage("✅ NEXT enabled");
    logStepMessage("✅ Step 19");
}

async function step20() {
    logStepMessage("▶️ Step 20");
    let nextBtn = await getElementById('tvFillDetailNext', 'common.cmn_text_next');
    await nextBtn.click();
    await browser.pause(1000);

    await getElementById('tvHeaderTitle', 'screens.CONNECT_TUBES.connect_tubes_screen_title');
    await getElementById('tvFirstStep', 'screens.CONNECT_TUBES.connect_tubes_screen_info_first');
    await getElementById('tvSecondStep', 'screens.CONNECT_TUBES.connect_tubes_screen_info_second');
    await getElementById('tvThirdStep', 'screens.CONNECT_TUBES.connect_tubes_screen_info_third');

    nextBtn = await getElementById('tvFillDetailNext', 'common.cmn_text_next');
    if (!(await nextBtn.isEnabled())) {
        throw new Error("❌ NEXT disabled");
    }
    logStepMessage("✅ NEXT enabled");
    logStepMessage("✅ Step 20");
}

async function step21() {
    logStepMessage("▶️ Step 21");
    const nextBtn = await getElementById('tvFillDetailNext', 'common.cmn_text_next');
    await nextBtn.click();
    await browser.pause(1000);

    await getElementById('tvHeaderTitle', 'screens.PUMP_READY.remove_pump_screen_title');
    await getElementById('tvMessageContainerInfo', 'screens.PUMP_READY.remove_pump_screen_info');
    logStepMessage("✅ Step 21");
}

async function step22() {
    logStepMessage("▶️ Step 22");
    adbDecouplePump();
    await browser.pause(7000);
    await getElementById('tvHeaderTitle', 'screens.PUMP_READY.pump_ready_screen_title');
    await getElementById('tvMessageContainerInfo', 'screens.PUMP_READY.pump_ready_screen_info_first');
    logStepMessage("✅ Step 22");
}

async function step23(apiBaseUrl) {
    logStepMessage("▶️ Step 23");
     await pressPumpButton(apiBaseUrl);

    await getElementById('tvHeaderTitle', 'screens.HOME.home_title');
    await getElementById('tvCurrentPumpStatusTitle', 'screens.HOME.home_screen_medication_delivery_on');
    await verifyLogsContain(apiBaseUrl, `[PB] Start delivery`, 2000, "error");
    logStepMessage("✅ Step 23");
}

async function step24() {
    logStepMessage("▶️ Step 24");
    adbCouplePump();
    await browser.pause(7000);

    const muteBtn = await getElementById('llMuteAlarm');
    const turnOffAudio = await getElementById('tvDismissAlert');
    if (await turnOffAudio.isDisplayed()) {
        const text = await turnOffAudio.getText();
        if (text === getCachedString('common.text_turn_off_audio')) {
        logStepMessage("⏸ Clicking TURN OFF AUDIO");
        await browser.pause(1000);
        await muteBtn.click();
        } else if (text === getCachedString('common.text_turn_off_audio_ack')) {
        logStepMessage("✅ Already paused");
        } else {
        logStepMessage(`⚠️ Unexpected text: ${text}`);
        }
    } else {
        throw new Error("❌ Turn off button not displayed");
    }

    const headerMenu = await getElementById('ivHeaderMenu');
    await headerMenu.click();

    const versionDetails = await scrollToItem('screens.MENU.menu_item_version_details', true);
    await versionDetails.click();

    await scrollToItem('screens.ABOUT_SCREENS.about_filling_cycle_count', true);

    const fillingCycleCount = await getElementById('tvFillingCycleCount');
    const fillingCycleCountStr = await fillingCycleCount.getText();

    if (fillingCycleCountStr === "1") {
        logStepMessage("Executed Cycles count 1 as expected");
    } else {
        throw new Error(`"Executed Cycles count ${fillingCycleCountStr}, not 1 as expected"`)
    }

    logStepMessage("Click Back to Home");
    const backBtn = await getElementById('ivHeaderBack');
    await backBtn.click();
    logStepMessage("✅ Step 24");
}