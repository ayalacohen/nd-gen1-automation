// helpers
import { adbCouplePump, adbDecouplePump, adbUpdateConfigFilesAndMainSn } from '../helpers/adbHelpers.js';
import { connectTwico, disconnectTwico, updateParameterValue, updatePumpParameters, verifyLogsContain } from '../helpers/apiHelpers.js';
import { buildSelectorById, buildSelectorByText, checkAlert, enterPin, getCachedString, getElementById, getElementByIdAndText, handlePumpFeedback, handleRetry, selectPump, waitForPumpDetected, waitForVisible } from '../helpers/uiHelpers.js';

import { loadStrings } from '../helpers/i18n.js';
import { logStep, logStepMessage } from '../helpers/logger.js';

// config
import config from '../helpers/config.js';
import { resetToFTU } from '../helpers/preConditionsHelpers.js';

import { flowState, saveState } from '../helpers/flowState.js';

import allureReporter from '@wdio/allure-reporter';

const testKey = "medicationEmpty";
let preconditionsPassed = false;
// ---- Mocha test ----
describe("From setup to medication empty", () => {
  const { apiBaseUrl, globalParams, testParams } = config;
  const { pumpName, portName, defaultPumpPinCode } = { ...globalParams, ...testParams.medicationEmpty };

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
        await logStep('Reset to FTU', async () => {
            await resetToFTU(apiBaseUrl);
        });
        adbCouplePump(); // initialize testmock to 0

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

      await logStep('Update pump parameters', async () => {
        await updatePumpParameters(apiBaseUrl);
        // vnv pump to test tm97
        if (pumpName.startsWith("P")) {
          await updateParameterValue(apiBaseUrl, "PERFORMANCE_MODE_FLAG", 70, 1);
        }
      });

      await logStep('Select language', async () => {
        await setLanguage();
      });

      await logStep('Set date and time', async () => {
        await setDateAndTime();
      });
      // return;

      await logStep('Pair pump', async () => {
        await pairPump();
      });

      await logStep('Insert pump - ADB disconnect/connect pump', async () => {
        await insertPump(pumpName);
      });

      await logStep('Select pump', async () => {
        await selectPump(pumpName);
      });

      await logStep('Enter wrong PIN', async () => {
        await enterPin("123456");
      });

      await logStep('Handle feedback', async () => {
        await handlePumpFeedback();
      });

      await logStep('Handle retry', async () => {
        await handleRetry(pumpName);
      });

      await logStep('Enter correct PIN', async () => {
        await enterPin(defaultPumpPinCode);
      });

      await logStep('Handle feedback', async () => {
        await handlePumpFeedback();
      });

      await logStep('Pairing', async () => {
        logStepMessage("▶️ Waiting for pairing completed");
        // await getElementById('tvHeaderTitle', 'screens.FTU_PUMP_PAIRING.ftu_pump_pair_title_pairing');
        // await getElementById('tvDoneText', 'common.cmn_please_wait');
        await getElementById('tvHeaderTitle', 'screens.FTU_PUMP_PAIRING.ftu_pump_pair_title_completed');
        await getElementById('tvDoneText', 'common.cmn_action_finished');
        logStepMessage("✅ Pairing completed");
      });
      // return;
      await logStep('Regimen', async () => {
        await setupRegimen();
      });

      await logStep('Medication empty', async () => {
        await verifyMedicationEmpty();
        await pauseAudio();
        // await attachScreenshotFn("Medication empty step 12");
        await verifyLogsContain(apiBaseUrl, `[Alarm] Med is empty (high): 3\``, 3000, "error");
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

async function setLanguage() {
  // do not check 'tvHeaderTitle' and 'tvSecond' expectedText
  // language change may be "in-between" in this screen

  // try to find and click the language item by its visible text
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
    throw new Error(`❌ Failed to select language item for "${config.language}": ${err.message}`);
  }

  const nextBtn = await getElementById('tvSecond');
  await nextBtn.click();
  await browser.pause(1000);
}

async function setDateAndTime() {
  await getElementById('tvHeaderTitle', 'screens.FTU_STARTUP.title_start_up_ftu');

  await getElementByIdAndText('tvStartupItemTitle', 'screens.FTU_STARTUP.ftu_set_date_time');

  await setDate();

  await setTime();
  
  await getElementById('tvHeaderTitle', 'screens.FTU_STARTUP.ftu_set_date_time_prepared');
  
  await getElementById('tvDoneText', 'screens.FTU_STARTUP.ftu_set_date_time_prepared');
}

async function setDate() {
  const nextBtn = await getElementById('tvSecond', 'common.cmn_text_next');
  await nextBtn.click();
  await browser.pause(1000);
  await getElementById('tvHeaderTitle', 'screens.DATE_TIME.ftu_select_month');
  
  await getElementById('tvMessageContainerInfo', 'screens.DATE_TIME.ftu_select_date_info');

  const doneBtn = await getElementById('tvSecond', 'common.cmn_text_done');
  await doneBtn.click();
  await browser.pause(1000);
}

async function setTime() {
  await getElementById('tvHeaderTitle', 'screens.DATE_TIME.ftu_set_time');

  let expectedTextKey;
  if (config.language === 'en_US') {
    expectedTextKey = 'screens.DATE_TIME.ftu_select_time_info';
  } else {
    expectedTextKey = 'screens.DATE_TIME.ftu_select_time_info_regular';
  }
  await getElementById('tvMessageContainerInfo', expectedTextKey);

  const doneBtn = await getElementById('tvSecond', 'common.cmn_text_done');
  await doneBtn.click();
}

async function pairPump() {
  await getElementByIdAndText('tvStartupItemTitle', 'screens.FTU_STARTUP.pair_pump_ftu');

  const nextBtn = await getElementById('tvSecond', 'common.cmn_text_next');
  await nextBtn.click();
  await browser.pause(1000);
}

async function insertPump(pumpName) {
  logStepMessage("▶️ Remove pump (decouple)");
  adbDecouplePump();

  await browser.pause(5000);

  await getElementById('tvAlarmTitle', 'dialogs.UNEXPECTED_DECOUPLE_FTU.alert_type_pump_decoupled_general_title_ftu');

  const nextBtn = await getElementById('tvThird', 'common.cmn_text_ok');
  await nextBtn.click();

  logStepMessage("▶️ Insert pump (couple)");
  adbCouplePump();

  await waitForPumpDetected();
  await browser.pause(3000);
}

async function setupRegimen() {
  logStepMessage("▶️ Set up dosing regimen");

  await getElementByIdAndText('tvStartupItemTitle', 'screens.FTU_STARTUP.pair_pump_ftu_prepared');

  await getElementByIdAndText('tvStartupItemTitle', 'screens.FTU_STARTUP.set_regimens_title');

  const nextBtn = await getElementById('tvSecond', 'common.cmn_text_next');
  await nextBtn.click();
  const activateRegimenBtn = await waitForVisible(
    buildSelectorById('tvSecond'),
    'common.cmn_regimen_activate_changes',
    10000
  );

  await activateRegimenBtn.click();
  /*
  // synchro 
  logStepMessage("▶️ Waiting for synchronizing data");
  try {
    await getElementByIdAndText(
          browser, 
          'tvHeaderTitle', 
          'screens.FTU_SYNC_DATA.ftu_sync_data_title'
    );
    logStepMessage("✅ Synchronizing data detected");
  } catch (err) {
      logStepMessage("⚠️ Synchronizing data screen not found, may have been already disappeared", "warn");
  }
  */
  //set up
  logStepMessage("▶️ Waiting for set up completed");
  await getElementByIdAndText('tvHeaderTitle', 'screens.FTU_SETUP_DONE.set_up_done_title');
  logStepMessage("✅ Set up completed");

  let getStarted = await waitForVisible(
    buildSelectorById('tvSecond'),
    'common.cmn_get_started',
    12000
  );
  await getStarted.click();

  // disclaimer
  logStepMessage("▶️ Waiting for disclaimer");
  await getElementById('tvCurrentPumpStatusTitle', 'screens.DISCLAIMER_SCREEN.text_mandatory_disclaimer');
  logStepMessage("✅ Disclaimer");
  
  getStarted = await waitForVisible(
    buildSelectorById('tvThird'),
    'common.cmn_get_started',
    10000
  );
  await getStarted.click();
  await browser.pause(1000);
}

async function verifyMedicationEmpty() {
  logStepMessage("▶️ Verify medication empty alert");
  const alert = await waitForVisible(
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

  const prepareTreatment = await getElementById('tvSecond', 'common.cmn_text_start_treatment');
  if (!(await prepareTreatment.isEnabled())) {
    throw new Error("❌ PREPARE TREATMENT disabled");
  }
  logStepMessage("✅ PREPARE TREATMENT enabled");

  await getElementById('tvThird', 'common.cmn_text_pump_status');
}

async function pauseAudio() {
  logStepMessage("▶️ Pause audio if needed");
  const audioBtn = await getElementById('tvDismissAlert');
  if (await audioBtn.isDisplayed()) {
    const text = await audioBtn.getText();
    if (text === getCachedString('common.text_pause_audio')) {
      logStepMessage("⏸ Clicking PAUSE AUDIO");
      await browser.pause(1000);
      await audioBtn.click();
    } else if (text === getCachedString('common.text_pause_audio_ack')) {
      logStepMessage("✅ Already paused");
    } else {
      logStepMessage(`⚠️ Unexpected text: ${text}`);
    }
  } else {
    throw new Error("❌ Audio button not displayed");
  }
}
