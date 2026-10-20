// helpers
import { clearPumpLogs, connectTwico, disconnectTwico, verifyLogsContain } from '../helpers/apiHelpers.js';
import { activateRegimenAndStart, pairPump, resetToFTU, updateRegimenValues } from '../helpers/preConditionsHelpers.js';
import { buildSelectorById, enterPinRegimen, getElementById, getElementByIdAndText, isElementDisplayedById, openDosingRegimenSettings, updateValueWithPlusMinusClicks, waitForVisible } from '../helpers/uiHelpers.js';

import { loadStrings } from '../helpers/i18n.js';
import { logStep, logStepMessage } from '../helpers/logger.js';

// config
import { adbCouplePump, adbDecouplePump, adbUpdateConfigFilesAndMainSn } from '../helpers/adbHelpers.js';
import config from '../helpers/config.js';
import { assertComparison } from '../helpers/generalHelpers.js';
import { flowState, saveState } from '../helpers/flowState.js';

import allureReporter from '@wdio/allure-reporter';

/*
Precondition:
Using CS configuration tool NDUI to change: “FW Configuration File”-> user_default_key= 1, “APK Configuration File”-> HcpUser = True,
Pump and CS after FTU
Pump in ‘Medication is empty’ alarm

Regimen data:
    720 mg (690 mg day and 30 mg night)
    Day treatment - Start: 04:00 AM , End: 10:00 PM
    Night treatment - Start: 10:00 PM , End: 04:00 AM
*/

const testKey = "TM-227";

let preconditionsPassed = false;

describe(`${testKey} - Saving regimen while pump is uncoupled`, () => {
  const { apiBaseUrl, globalParams } = config;
  const { pumpName, portName, defaultRegimenPinCode } = { ...globalParams };

  const apkLocalConfigFile = "adb-config-files/HCP_cs_config.json";
  const fwLocalConfigFile = "adb-config-files/DEFAULT_1_config.file";

  const regimenValues = {
    day: {
        nbHours: "18 h",
        start: "4:00 AM",
        end: "10:00 PM",
        doseRate: "640",
        dose: "690"
    },
    night: {
        nbHours: "6 h",
        start: "10:00 PM",
        end: "4:00 AM",
        doseRate: "80",
        dose: "30"
    },  
    totalDose: "720"
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
        await logStep(`Update Regimen - Day: ${regimenValues.day.start} / ${regimenValues.day.doseRate} - Night: ${regimenValues.night.start} / ${regimenValues.night.doseRate}`, async () => {
            await updateRegimenValues(apiBaseUrl, regimenValues.day.start, regimenValues.day.doseRate, regimenValues.night.start, regimenValues.night.doseRate);
        });
        await logStep('Activate regimen and start (until medication empty)', async () => {
            await activateRegimenAndStart();
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

        await logStep('Step 1 - Edit Dosing regimen', async () => {
            await step1(defaultRegimenPinCode);
        });

        await logStep('Step 2 - Set Total daily dose 570 mg and decouple', async () => {
            await step2(apiBaseUrl, regimenValues.totalDose, "570");
        });

        await logStep('Step 3 - Couple and open Dosing regimen settings', async () => {
            await step3("570");
        });

        await logStep('Step 4 - Set Start Day 7:00 AM and decouple', async () => {
            await step4(apiBaseUrl, defaultRegimenPinCode, regimenValues.day.start, "7:00 AM");
        });

        await logStep('Step 5 - Couple and open Dosing regimen settings', async () => {
            await step5("7:00 AM");
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
async function step1(pinCode) {
    logStepMessage("▶️ Step 1");

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

    logStepMessage("✅ Step 1");
}

async function step2(apiBaseUrl, actualTotalDose, newTotalDose) {
    logStepMessage("▶️ Step 2");

    await updateValueWithPlusMinusClicks({
        mode: 'dose',
        actualValue: actualTotalDose,
        newValue: newTotalDose
    });

    const doneBtn = await getElementById('tvSecond', 'common.cmn_text_done');
    await doneBtn.click();

    const saveRegimenBtn =  await getElementById('tvSecond', 'common.cmn_regimen_save_changes');
    await saveRegimenBtn.click();

    adbDecouplePump();
    await browser.pause(7000);

    // logs
    // [REGIMENS] info tst: 0
    // [REGIMENS] Rec. CRC Tst: 1
    // [REGIMENS] Saved CRC Test Event: 1
    await verifyLogsContain(apiBaseUrl, `[REGIMENS] Info tst: 0\`||[REGIMENS] Rec. CRC Tst: 1\`||[REGIMENS] Saved CRC Test Event: 1\``, 5000, "error");
    logStepMessage("✅ Step 2");
}

async function step3(newTotalDose) {
    logStepMessage("▶️ Step 3");

    adbCouplePump();
    await browser.pause(5000);

    let segmentsValues;
    ({ segmentsValues } = await openDosingRegimenSettings());

    const expectedValues = {
    day: {
        nbHours: "18 h",
        start: "4:00 AM",
        end: "10:00 PM",
        doseRate: "500",
        dose: "540"
    },
    night: {
        nbHours: "6 h",
        start: "10:00 PM",
        end: "4:00 AM",
        doseRate: "80",
        dose: "30"
    },
    totalDose: "570"
    };

    assertComparison(expectedValues, segmentsValues, true, "Regimen"); // should be as expected
    logStepMessage("✅ Segments saved as expected");

    logStepMessage("✅ Step 3");
}

async function step4(apiBaseUrl, pinCode, actualStartDay, newStartDay) {
    logStepMessage("▶️ Step 4");
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

    const saveRegimenBtn =  await getElementById('tvSecond', 'common.cmn_regimen_save_changes');
    await saveRegimenBtn.click();

    adbDecouplePump();
    await browser.pause(7000);

    // logs
    // [REGIMENS] info tst: 0
    // [REGIMENS] Rec. CRC Tst: 1
    // [REGIMENS] Saved CRC Test Event: 1
    await verifyLogsContain(apiBaseUrl, `[REGIMENS] Info tst: 0\`||[REGIMENS] Rec. CRC Tst: 1\`||[REGIMENS] Saved CRC Test Event: 1\``, 5000, "error");
    logStepMessage("✅ Step 4");
}

async function step5(newStartDay) {
    logStepMessage("▶️ Step 5");

    adbCouplePump();
    await browser.pause(5000);

    let segmentsValues;
    ({ segmentsValues } = await openDosingRegimenSettings());

    const expectedValues = {
    day: {
        nbHours: "18 h",
        start: "7:00 AM",
        end: "1:00 AM",
        doseRate: "500",
        dose: "540"
    },
    night: {
        nbHours: "6 h",
        start: "1:00 AM",
        end: "7:00 AM",
        doseRate: "80",
        dose: "30"
    },
    totalDose: "570"
    };

    assertComparison(expectedValues, segmentsValues, true, "Regimen"); // should be as expected
    logStepMessage("✅ Segments saved as expected");

    logStepMessage("✅ Step 5");
}