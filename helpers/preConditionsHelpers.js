import { adbCouplePump, adbDecouplePump } from './adbHelpers';
import { connectCartridgeToPump, pressPumpButton, resetPumpToFTU, setRegimenValue, updateParameterValue } from "./apiHelpers";
import { convertHoursToSeconds, parseHour } from "./generalHelpers";
import { buildSelectorById, buildSelectorByText, csResetToFTU, enterPinCode, getCachedString, getElementById, isElementDisplayedById, waitForDisappear, waitForScreenWithHeartbeat, waitForVisible, waitForVisibleWithRetry } from "./uiHelpers";

import config from "./config.js"
import { attachScreenshotFn } from './screenshot.js';
import { logStepMessage } from './logger.js';

export async function resetToFTU(apiBaseUrl) {
    await csResetToFTU();

    await resetPumpToFTU(apiBaseUrl);

    await updateParameterValue(apiBaseUrl, "MAX_ALLOWED_CHARGING_TEMPERATURE_DEFAULT", 87, 60);
    await updateParameterValue(apiBaseUrl, "PERIOD_ALARMS_HIGH_ACK", 17, 32400);
}

export async function pairPump(pumpName) {
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

    // for (let i = 0; i < 2; i++) {
    //     await nextBtn.click();
    //     await browser.pause(1000);
    // }

    // await attachScreenshotFn("Set month - check day");

    // for (let i = 0; i < 2; i++) {
    //     await nextBtn.click();
    //     await browser.pause(1000);
    // }

    adbDecouplePump();
    await browser.pause(1000);
    adbCouplePump();

    await browser.pause(2000);
    nextBtn = await getElementById('tvSecond');

    await nextBtn.click();
    await browser.pause(2000);

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
    await browser.pause(500);
    await waitForVisible(
        buildSelectorById('tvSecond'),
        null,
        30000
    );
}

export async function activateRegimenAndStart() {
    const nextBtn = await getElementById('tvSecond');
    await nextBtn.click();
    await browser.pause(100);

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
}

export async function prepareTreatmentUntilFillingMedication(apiBaseUrl) {
    const fillDetailNextBtn = await getElementById('tvFillDetailNext', 'common.cmn_text_next');
    await fillDetailNextBtn.click();
    await browser.pause(500);

    await connectCartridgeToPump(apiBaseUrl);
    await browser.pause(5000);

    let nextBtn = await getElementById('tvSecond', 'common.cmn_text_next');

    await browser.waitUntil(async () => await nextBtn.isEnabled(), {
        timeout: 10000,
        timeoutMsg: "❌ NEXT did not enable"
    });

    await nextBtn.click();
    await browser.pause(1000);

    await getElementById('tvHeaderTitle', 'screens.CONNECT_VIAL.connect_vial_screen_title');

    nextBtn = await getElementById('tvSecond', 'common.cmn_text_next');
    await nextBtn.click();
    await browser.pause(1000);

    await getElementById('tvHeaderTitle', 'screens.PREPARE_FOR_FILLING.prepare_for_filling_screen');

    const startFillingBtn = await getElementById('tvSecond', 'common.cmn_start_filling');
    await browser.waitUntil(async () => await startFillingBtn.isEnabled(), {
        timeout: 5000,
        timeoutMsg: "❌ START FILLING did not enable"
    });

    await startFillingBtn.click();
    await browser.pause(1000);

    await getElementById('tvHeaderTitle', 'screens.FILLING_MEDICATION.filling_medication_ftu');

    const progressFilingMedicine = await getElementById('progressFilingMedicine');

    await waitForDisappear(buildSelectorById('progressFilingMedicine'), 150000);

    await getElementById('tvHeaderTitle', 'screens.REMOVE_VIAL_ADAPTERS.remove_vial_adapters_title');
}

export async function prepareTreatmentUntilPrepareInfusionSites(apiBaseUrl) {
    await prepareTreatmentUntilFillingMedication(apiBaseUrl);

    let nextBtn = await getElementById('tvSecond', 'common.cmn_text_next');
    await nextBtn.click();
    await browser.pause(500);

    await getElementById('tvHeaderTitle', 'screens.CONNECT_TUBING_SCREEN.connect_tubing_title');

    const primeTubbingBtn = await getElementById('tvSecond', 'screens.CONNECT_TUBING_SCREEN.connect_tubing_prime_button');
    await primeTubbingBtn.click();
    await browser.pause(1000);

    await getElementById('tvHeaderTitle', 'screens.PREPARE_INFUSION_SITES.screen_prepare_infusion_sites_title');

    nextBtn = await getElementById('tvFillDetailNext', 'common.cmn_text_next');
    await nextBtn.click();
    await browser.pause(1000);

    await getElementById('tvHeaderTitle', 'screens.INSERT_CANNULA.insert_cannula_screen_title');
}

export async function prepareTreatmentUntilPumpReady(apiBaseUrl) {
    await prepareTreatmentUntilPrepareInfusionSites(apiBaseUrl);

    let nextBtn = await getElementById('tvFillDetailNext', 'common.cmn_text_next');
    await nextBtn.click();
    await browser.pause(1000);

    const headerTitle = await getElementById('tvHeaderTitle');
    const headerTitleText = await headerTitle.getText();
    const pumpBatteryChargingTitleText = getCachedString('screens.CHARGING.charging_screen_title');
    if (headerTitleText == pumpBatteryChargingTitleText) {
        logStepMessage(`▶️ ${pumpBatteryChargingTitleText} screen - waiting for pump battery charging`);
        // wait 1h
        await waitForScreenWithHeartbeat(
            buildSelectorById('tvHeaderTitle') + `.text("${getCachedString('screens.CONNECT_TUBES.connect_tubes_screen_title')}")`,
            buildSelectorById('tvThird') + `.text("${getCachedString('common.cmn_resume_process')}")`,
            3600000
        );
    }

    await getElementById('tvHeaderTitle', 'screens.CONNECT_TUBES.connect_tubes_screen_title');

    nextBtn = await getElementById('tvFillDetailNext', 'common.cmn_text_next');
    await nextBtn.click();
    await browser.pause(1000);

    await getElementById('tvHeaderTitle', 'screens.PUMP_READY.remove_pump_screen_title');

    adbCouplePump();
    await browser.pause(2000);

    adbDecouplePump();
    await browser.pause(7000);

    await getElementById('tvHeaderTitle', 'screens.PUMP_READY.pump_ready_screen_title');
}

export async function prepareTreatmentUntilDelivery(apiBaseUrl) {
    await prepareTreatmentUntilPumpReady(apiBaseUrl);
    await pressPumpButton(apiBaseUrl);

    await getElementById('tvHeaderTitle', 'screens.HOME.home_title');

    await getElementById('tvCurrentPumpStatusTitle', 'screens.HOME.home_screen_medication_delivery_on');
}

export async function updateRegimenValues(apiBaseUrl, startDay, segment1Value, startNight, segment2Value) {
    //convertHoursToSeconds instead of convertHoursToMs
    const segment1Time = convertHoursToSeconds(parseHour(startDay));
    const segment2Time = convertHoursToSeconds(parseHour(startNight));
    await setRegimenValue(apiBaseUrl, segment1Time, segment1Value, segment2Time, segment2Value);
}