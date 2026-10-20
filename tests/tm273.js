// helpers
import { clearPumpLogs, connectTwico, disconnectTwico } from '../helpers/apiHelpers.js';
import { pairPump, resetToFTU } from '../helpers/preConditionsHelpers.js';
import { buildSelectorById, checkAlert, csResetToFTU, enterPinRegimen, getElementById, getElementByIdAndText, getSegmentsValues, isElementDisplayedById, openDosingRegimenSettings, updateValueWithPlusMinusClicks, waitForVisible } from '../helpers/uiHelpers.js';

import { loadStrings } from '../helpers/i18n.js';
import { logPretty, logStep, logStepMessage } from '../helpers/logger.js';

// config
import config from '../helpers/config.js';
import { flowState, saveState } from '../helpers/flowState.js';
import { assertComparison } from '../helpers/generalHelpers.js';

import allureReporter from '@wdio/allure-reporter';

/*
Precondition:
The pump is after successful FTU, active regimen with total daily dose 370

CS is at FTU state.
*/

const testKey = "TM-273";

let preconditionsPassed = false;

describe(`${testKey} - Pump contains previous data`, () => {
  const { apiBaseUrl, globalParams } = config;
  const { pumpName, portName, defaultRegimenPinCode } = { ...globalParams };

  const regimenValues = {
    day: {
        nbHours: "18 h",
        start: "3:00 AM",
        end: "9:00 PM",
        doseRate: "320",
        dose: "340"
    },
    night: {
        nbHours: "6 h",
        start: "9:00 PM",
        end: "3:00 AM",
        doseRate: "80",
        dose: "30"
    },
    totalDose: "370"
    };

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

        await logStep('Pair pump', async () => {
            await pairPump(pumpName);
        });

        await logStep(`Activate Regimen  ${regimenValues.totalDose}`, async () => {
            await activateRegimen(defaultRegimenPinCode, "720", regimenValues.totalDose);
            logPretty("Pre regimen", regimenValues);
        });

        await logStep('Reset CS to FTU', async () => {
            await csResetToFTU();
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

        await logStep('Step 1 - Set up the CS language, date, time and pair the pump.', async () => {
            await step1(pumpName);
        });

        await logStep('Step 2 - Click on NEXT', async () => {
            await step2(regimenValues);
        });

        await logStep('Step 3 - Click on "Activate regimen" button', async () => {
            await step3();
        });

        await logStep('Step 4 - Click on "Get started" button', async () => {
            await step4();
        });

        await logStep('Step 5 - Click on GET STARTED', async () => {
            await step5();
        });

        await logStep('Step 6 - Open side menu -> Dosing regimen settings', async () => {
            await step6(regimenValues);
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
async function step1(pumpName) {
    logStepMessage("▶️ Step 1");
    await pairPump(pumpName);

    await getElementByIdAndText('tvStartupItemTitle', 'screens.FTU_STARTUP.ftu_set_date_time_prepared');

    await getElementByIdAndText('tvStartupItemTitle', 'screens.FTU_STARTUP.pair_pump_ftu_prepared');

    await getElementByIdAndText('tvStartupItemTitle', 'screens.FTU_STARTUP.set_regimens_title');

    logStepMessage("✅ Step 1");
}

async function step2(regimenValues) {
    logStepMessage("▶️ Step 2");
    const nextBtn = await getElementById('tvSecond');
    await nextBtn.click();
    await browser.pause(100);

    await browser.pause(5000);

    const segmentsValues = await getSegmentsValues();

    assertComparison(regimenValues, segmentsValues.segmentsValues, true, "Regimen"); 
    logStepMessage(`✅ Segments as expected with total dose ${regimenValues.totalDose}`);
    logStepMessage("✅ Step 2");
}

async function step3() {
    logStepMessage("▶️ Step 3");
    const activateRegimenBtn = await waitForVisible(
        buildSelectorById('tvSecond'),
        'common.cmn_regimen_activate_changes',
        10000
    );
    await activateRegimenBtn.click();

    await waitForVisible(
        buildSelectorById('tvHeaderTitle'),
        'screens.FTU_SETUP_DONE.set_up_done_title',
        12000
    );

    await getElementById('tvSecond', 'common.cmn_get_started');
    logStepMessage("✅ Step 3");
}

async function step4() {
    logStepMessage("▶️ Step 4");
    const getStarted = await getElementById('tvSecond','common.cmn_get_started');
    await getStarted.click();
    await browser.pause(100);

    await getElementById('tvCurrentPumpStatusTitle', 'screens.DISCLAIMER_SCREEN.text_mandatory_disclaimer');

    await waitForVisible(
        buildSelectorById('tvThird'),
        'common.cmn_get_started',
        10000
    );
    logStepMessage("✅ Step 4");
}

async function step5() {
    logStepMessage("▶️ Step 5");
    const getStarted = await getElementById('tvThird','common.cmn_get_started');
    await getStarted.click();
    await browser.pause(100);

    await waitForVisible(
        buildSelectorById('tvAlertTitle'),
        'alerts.EMPTY_DRUG.alert_title_empty_drug',
        10000,
        300,
        true
    );
    logStepMessage("✅ Alert MEDICATION IS EMPTY shown [alerts.EMPTY_DRUG.alert_title_empty_drug] upper case");

    await checkAlert(
        'alerts.EMPTY_DRUG.alert_title_empty_drug',
        'alerts.EMPTY_DRUG.alert_description_empty_drug',
        { expectedStr: 'ID 3 ' }
    );

    if (await isElementDisplayedById('tvDismissAlert')) {
        const audioBtn = await getElementById('tvDismissAlert');
        await audioBtn.click();
    }

    const prepareTreatment = await getElementById('tvSecond', 'common.cmn_text_start_treatment');
    if (!(await prepareTreatment.isEnabled())) {
        throw new Error("❌ PREPARE TREATMENT disabled");
    }
    logStepMessage("✅ PREPARE TREATMENT enabled");

    const pumpStatus = await getElementById('tvThird', 'common.cmn_text_pump_status');
    if (!(await pumpStatus.isEnabled())) {
        throw new Error("❌ PUMP STATUS disabled");
    }
    logStepMessage("✅ PUMP STATUS enabled");

    await pumpStatus.click();

    await getElementById('tvHeaderTitle', 'screens.PUMP_STATUS.pump_status_title');
    await getElementById('tvStatusOnDrugDeliveredLabel', 'screens.PUMP_STATUS.status_screen_no_delivery');
    logStepMessage("✅ NO DELIVERY displayed");

    const backBtn = await getElementById('ivHeaderBack');
    await backBtn.click();
    logStepMessage("✅ Step 5");
}

async function step6(regimenValues) {
    logStepMessage("▶️ Step 5");
    const headerMenu = await getElementById('ivHeaderMenu');
    await headerMenu.click();
    let segmentsValues;
    ({ segmentsValues } = await openDosingRegimenSettings());
    assertComparison(regimenValues, segmentsValues, true, "Regimen");
    logStepMessage("✅ Segments as expected");
    logStepMessage("✅ Step 6");
}

export async function activateRegimen(pinCode, actualTotalDose, newTotalDose) {
    const nextBtn = await getElementById('tvSecond');
    await nextBtn.click();
    await browser.pause(100);

    const editRegimenBtn =  await getElementById('tvEditSegments', 'common.cmn_regimen_edit_changes');
    await editRegimenBtn.click();

    await getElementById('tvHeaderTitle', 'screens.REGIMEN_MENU.regimen_pin_title');

    await enterPinRegimen(pinCode);
    if (await isElementDisplayedById('tvPinError')) {
        const pinError = await browser.$(buildSelectorById('tvPinError'));
        const pinErrorStr = await pinError.getText();
        throw new Error(`❌ ${pinErrorStr} [screens.REGIMEN_MENU.regiment_wrong_pin]`);
    }
    await getElementById('tvHeaderTitle', 'screens.REGIMEN_OVERVIEW.title_single_regimen_edit');

    await updateValueWithPlusMinusClicks({
        mode: 'dose',
        actualValue: actualTotalDose,
        newValue: newTotalDose
    });

    const doneBtn = await getElementById('tvSecond', 'common.cmn_text_done');
    await doneBtn.click();

    const activateRegimenBtn = await waitForVisible(
        buildSelectorById('tvSecond'),
        'common.cmn_regimen_activate_changes',
        10000
    );
    await activateRegimenBtn.click();

    await waitForVisible(
        buildSelectorById('tvSecond'),
        'common.cmn_get_started',
        12000
    );
}