// helpers
import { buildSelectorById, checkAlert, getElementById, getCachedString, isElementDisplayedByText, waitForScreenWithHeartbeat, waitForDisappear, waitForVisible, waitWithHeartbeat } from '../helpers/uiHelpers.js';
import { connectTwico, disconnectTwico, connectCartridgeToPump, disconnectCartridgeFromPump, pressPumpButton, updateParameterValue } from '../helpers/apiHelpers.js';
import { adbCouplePump, adbDecouplePump } from '../helpers/adbHelpers.js';

import { loadStrings } from '../helpers/i18n.js';
import { logStep, logStepMessage } from '../helpers/logger.js';

// config
import config from '../helpers/config.js';
import { flowState, saveState } from '../helpers/flowState.js';

import allureReporter from '@wdio/allure-reporter';

const testKey = "prepareTreatment";
let preconditionsPassed = false;

describe(`${testKey}`, () => {

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

        await browser.pause(3000);

        await logStep('Update pump parameters to reduce filling time', async () => {
            await updateParameterValue(apiBaseUrl, "VIAL_DETECT_MIN_CURRENT_DIFF_FOR_SUCCESS_DEFAULT", 8, 0);

            await updateParameterValue(apiBaseUrl, "VIAL_DETECT_MIN_CURRENT_SAMPLES_PER_MOTOR_BURST_DEFAULT", 9, 100);

            await updateParameterValue(apiBaseUrl, "ENCODER_FILLING_HARD_STOP_VALUE", 14, 110000); // 55000 *2

            await updateParameterValue(apiBaseUrl, "FILING_MIN_ENCODER_FOR_REMOVE_AIR_STAGE", 53, 20000); //10000 *2

            await updateParameterValue(apiBaseUrl, "FILLING_STEP_2_MIN_DRUG_VOLUME_ENC", 4, 0);
        });

            preconditionsPassed = true;
        } catch (err) {
            throw new Error(`PRECONDITION FAILED: ${err.message}`);
        }
  });

  const { apiBaseUrl, globalParams, testParams } = config;
  const { pumpName, portName } = { ...globalParams };

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

      // === Step 1: Prepare treatment ===
      await logStep('Prepare treatment', async () => {
        await prepareTreatment();
      });

      // === Step 2: Dispose used materials ===
      await logStep('Dispose used materials', async () => {
        await disposeUsedMaterials(apiBaseUrl);
      });

      // === Step 3: Connect cartridge ===
      await logStep('Connect cartridge', async () => {
        await connectCartridge(apiBaseUrl);
      });
      // return;
      // === Step 4: Insert new vials ===
      await logStep('Insert new vials', async () => {
        await insertNewVials();
      });

      // === Step 5: Fill medication ===
      await logStep('Fill medication', async () => {
        await fillMedication();
      });

      // === Step 6: Filling medication ===
      await logStep('Filling medication', async () => {
        await fillingMedication();
      });


      // === Step 7: Remove vial adapters ===
      await logStep('Remove vial adapters', async () => {
        await removeVialAdapters();
      });

      // === Step 8: Connect infusion sets ===
      await logStep('Connect infusion sets', async () => {
        await connectInfusionSets();
      });

      // === Step 9: Prepare infusion sites ===
      await logStep('Prepare infusion sites', async () => {
        await prepareInfusionSites();
      });

      // === Step 10: Insert cannulas ===
      await logStep('Insert cannulas', async () => {
        await insertCannulas();
      });

      //return;
      // === Step 10bis: Pump battery charging ===
      await logStep('Pump battery charging', async () => {
        await pumpBatteryCharging();
      });

      // return;
      // === Step 11: Connect tubes to cannulas ===
      await logStep('Connect tubes to cannulas', async () => {
        await connectTubesToCannulas();
      });

      // === Step 12: Remove pump ===
      await logStep('Remove pump', async () => {
        await removePump();
      });

      // === Step 13: Start medication ===
      await logStep('Start medication', async () => {
        await startMedication(apiBaseUrl);
      });

      // === Step 14: Medication delivery ===
      await logStep('Medication delivery', async () => {
        await medicationDelivery();
      });
      return;
      // === Step 15: Pump status ===
      await logStep('Pump status', async () => {
      // quick test from treatement paused : decouple, push (and re-pause)
        // adbDecouplePump();
        // await browser.pause(7000);
        // await pressPumpButton(apiBaseUrl);

        await pumpStatus();
      });

      // === Step 16: Pause treatment ===
      await logStep('Pause treatment', async () => {
        await pauseTreatment();
      });

      // === Step 17: Disconnect TWICO ===
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

async function prepareTreatment() {
  const prepareTreatment = await getElementById('tvSecond', 'common.cmn_text_start_treatment');
  if (!(await prepareTreatment.isEnabled())) {
    throw new Error("❌ PREPARE TREATMENT disabled");
  }
  logStepMessage("✅ PREPARE TREATMENT enabled");

  await prepareTreatment.click();
  await browser.pause(1000);
}

async function disposeUsedMaterials(apiBaseUrl) {
  await getElementById('tvHeaderTitle', 'screens.REMOVE_OLD_DISPOSABLE.remove_old_disposable_title');
  await getElementById('tvFirstStep', 'screens.REMOVE_OLD_DISPOSABLE.remove_old_disposable_instruction_first');
  await getElementById('tvSecondStep', 'screens.REMOVE_OLD_DISPOSABLE.remove_old_disposable_instruction_second');
  await getElementById('tvThirdStep', 'screens.REMOVE_OLD_DISPOSABLE.remove_old_disposable_instruction_third');

  await disconnectCartridgeFromPump(apiBaseUrl);

  const fillDetailNextBtn = await getElementById('tvFillDetailNext', 'common.cmn_text_next');
  await fillDetailNextBtn.click();
  await browser.pause(1000);
}

async function connectCartridge(apiBaseUrl) {
  await getElementById('tvHeaderTitle', 'screens.CONNECT_A_NEW_CARTRIDGE.connect_new_cartridge_title');
  await getElementById('tvMessageContainerInfo', 'screens.CONNECT_A_NEW_CARTRIDGE.connect_new_cartridge_info');

  const nextBtn = await getElementById('tvSecond', 'common.cmn_text_next');
  if ((await nextBtn.isEnabled())) {
    throw new Error("❌ NEXT enabled");
  }
  logStepMessage("✅ NEXT disabled");

  await connectCartridgeToPump(apiBaseUrl);

  await browser.waitUntil(async () => await nextBtn.isEnabled(), {
    timeout: 10000,
    timeoutMsg: "❌ NEXT did not enable"
  });

  await nextBtn.click();
  await browser.pause(1000);
}

async function insertNewVials() {
  await getElementById('tvHeaderTitle', 'screens.CONNECT_VIAL.connect_vial_screen_title');
  const message = await getElementById('tvMessageContainerInfo');
  const actualMessageStr = await message.getText();
  const expectedMessageStr = getCachedString('screens.CONNECT_VIAL.connect_vial_screen_info_second') + "\n\n" + getCachedString('screens.CONNECT_VIAL.connect_vial_screen_info_third');
  if (actualMessageStr !== expectedMessageStr) {
    throw new Error(`❌ Element text mismatch: expected "${expectedMessageStr}", got "${actualMessageStr}" ['screens.CONNECT_VIAL.connect_vial_screen_info_second' 'screens.CONNECT_VIAL.connect_vial_screen_info_third']`);
  }
  logStepMessage(`✅ Element "tvMessageContainerInfo" text as expected: "${expectedMessageStr}" ['screens.CONNECT_VIAL.connect_vial_screen_info_second' 'screens.CONNECT_VIAL.connect_vial_screen_info_third']`);

  const nextBtn = await getElementById('tvSecond', 'common.cmn_text_next');
  await nextBtn.click();
  await browser.pause(1000);
}

async function fillMedication() {
  await getElementById('tvHeaderTitle', 'screens.PREPARE_FOR_FILLING.prepare_for_filling_screen');
  await getElementById('tvMessageContainerInfo', 'screens.PREPARE_FOR_FILLING.prepare_for_filling_message');

  // wait for startFillingBtn to be enabled then click
  const startFillingBtn = await getElementById('tvSecond', 'common.cmn_start_filling');
  await browser.waitUntil(async () => await startFillingBtn.isEnabled(), {
    timeout: 5000,
    timeoutMsg: "❌ START FILLING did not enable"
  });

  await startFillingBtn.click();
  await browser.pause(1000);
}

async function fillingMedication() {
  await getElementById('tvHeaderTitle', 'screens.FILLING_MEDICATION.filling_medication_ftu');
  await getElementById('textView3', 'screens.FILLING_MEDICATION.filling_medication_ask');
  await getElementById('tvCartridgeInfo', 'screens.FILLING_MEDICATION.text_filling_process_eta');

  const progressFilingMedicine = await getElementById('progressFilingMedicine');

  // filling should take 2 mn = 2*60*1000 ms
  await waitForDisappear(buildSelectorById('progressFilingMedicine'), 120000);
}

async function removeVialAdapters() {
  await getElementById('tvHeaderTitle', 'screens.REMOVE_VIAL_ADAPTERS.remove_vial_adapters_title');

  const nextBtn = await getElementById('tvSecond', 'common.cmn_text_next');
  await nextBtn.click();
  await browser.pause(1000);
}

async function connectInfusionSets() {
  await getElementById('tvHeaderTitle', 'screens.CONNECT_TUBING_SCREEN.connect_tubing_title');
  const message = await getElementById('tvMessageContainerInfo');
  const actualMessageStr = await message.getText();
  const expectedMessageStr = getCachedString('screens.CONNECT_TUBING_SCREEN.connect_tubing_info_first') + "\n\n" + getCachedString('screens.CONNECT_TUBING_SCREEN.connect_tubing_info_second') + "\n\n" + getCachedString('screens.CONNECT_TUBING_SCREEN.connect_tubing_info_third');
  if (actualMessageStr !== expectedMessageStr) {
    throw new Error(`❌ Element text mismatch: expected "${expectedMessageStr}", got "${actualMessageStr}" ['screens.CONNECT_TUBING_SCREEN.connect_tubing_info_first' 'screens.CONNECT_TUBING_SCREEN.connect_tubing_info_second' 'screens.CONNECT_TUBING_SCREEN.connect_tubing_info_third']`);
  }
  logStepMessage(`✅ Element "tvMessageContainerInfo" text as expected: "${expectedMessageStr}" ['screens.CONNECT_TUBING_SCREEN.connect_tubing_info_first' 'screens.CONNECT_TUBING_SCREEN.connect_tubing_info_second' 'screens.CONNECT_TUBING_SCREEN.connect_tubing_info_third']`);

  const primeTubbingBtn = await getElementById('tvSecond', 'screens.CONNECT_TUBING_SCREEN.connect_tubing_prime_button');
  await primeTubbingBtn.click();
  await browser.pause(1000);
}

async function prepareInfusionSites() {
  await getElementById('tvHeaderTitle', 'screens.PREPARE_INFUSION_SITES.screen_prepare_infusion_sites_title');
  await getElementById('tvFirstStep', 'screens.PREPARE_INFUSION_SITES.screen_prepare_infusion_sites_message_first');
  await getElementById('tvSecondStep', 'screens.PREPARE_INFUSION_SITES.screen_prepare_infusion_sites_message_second');
  await getElementById('tvThirdStep', 'screens.PREPARE_INFUSION_SITES.screen_prepare_infusion_sites_message_third');
  await getElementById('tvFillDetailShowMe', 'screens.PREPARE_INFUSION_SITES.screen_prepare_infusion_sites_button');

  const nextBtn = await getElementById('tvFillDetailNext', 'common.cmn_text_next');
  await nextBtn.click();
  await browser.pause(1000);
}

async function insertCannulas() {
  await getElementById('tvHeaderTitle', 'screens.INSERT_CANNULA.insert_cannula_screen_title');
  await getElementById('tvFirstStep', 'screens.INSERT_CANNULA.insert_cannula_screen_info_first');
  await getElementById('tvSecondStep', 'screens.INSERT_CANNULA.insert_cannula_screen_info_second');
  await getElementById('tvThirdStep', 'screens.INSERT_CANNULA.insert_cannula_screen_info_third');

  const nextBtn = await getElementById('tvFillDetailNext', 'common.cmn_text_next');
  await nextBtn.click();
  await browser.pause(1000);
}

async function pumpBatteryCharging() {
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
  else {
    logStepMessage(`${headerTitleText} screen displayed`);
  }
}

async function connectTubesToCannulas() {
  await getElementById('tvHeaderTitle', 'screens.CONNECT_TUBES.connect_tubes_screen_title');
  await getElementById('tvFirstStep', 'screens.CONNECT_TUBES.connect_tubes_screen_info_first');
  await getElementById('tvSecondStep', 'screens.CONNECT_TUBES.connect_tubes_screen_info_second');
  await getElementById('tvThirdStep', 'screens.CONNECT_TUBES.connect_tubes_screen_info_third');

  const nextBtn = await getElementById('tvFillDetailNext', 'common.cmn_text_next');
  await nextBtn.click();
  await browser.pause(1000);
}

async function removePump() {
  await getElementById('tvHeaderTitle', 'screens.PUMP_READY.remove_pump_screen_title');
  await getElementById('tvMessageContainerInfo', 'screens.PUMP_READY.remove_pump_screen_info');

  adbCouplePump();
  await browser.pause(2000);

  adbDecouplePump();
  await browser.pause(7000); //7000
}

async function startMedication(apiBaseUrl) {
  await getElementById('tvHeaderTitle', 'screens.PUMP_READY.pump_ready_screen_title');

  await getElementById('tvMessageContainerInfo', 'screens.PUMP_READY.pump_ready_screen_info_first');

  await pressPumpButton(apiBaseUrl);

}

async function medicationDelivery(apiBaseUrl) {
  await getElementById('tvHeaderTitle', 'screens.HOME.home_title');

  await getElementById('tvCurrentPumpStatusTitle', 'screens.HOME.home_screen_medication_delivery_on');  
}

async function pumpStatus() {
  const pumpStatusBtn = await getElementById('tvHomeActionRight', 'screens.HOME.home_screen_action_pump_status');
  await pumpStatusBtn.click();
  await browser.pause(1000);

  await getElementById('tvHeaderTitle', 'screens.PUMP_STATUS.pump_status_title');

  await getElementById('tvBatteryStatus', 'screens.PUMP_STATUS.remaining_pump_battery_title');
  await getElementById('tvStatusOnEndTreatmentTimeLabel', 'common.cmn_treatment_ending');
  await getElementById('tvStatusOnDrugDeliveredLabel', 'screens.PUMP_STATUS.status_screen_levodopa_delivered');
  await getElementById('tvBatteryStatusLabel', 'screens.PUMP_STATUS.remaining_pump_battery');

  let endTreatmentTime =  await getElementById('tvStatusOnEndTreatmentTime');
  let drugDelivered =  await getElementById('tvStatusOnDrugDelivered');

  let endTreatmentTimeStart = (await endTreatmentTime.getText()).trim();
  let drugDeliveredStart = (await drugDelivered.getText()).trim();
  // endTreatmentTimeStart = "23 hr 57 min";
  // drugDeliveredStart = "0 / 720 mg";

  logStepMessage("▶️ Waiting for 15mn to check delivery progress");
  await waitWithHeartbeat(900000); // 600000 for 10 mn enough

  endTreatmentTime =  await getElementById('tvStatusOnEndTreatmentTime');
  drugDelivered =  await getElementById('tvStatusOnDrugDelivered');

  let endTreatmentTimeNow = (await endTreatmentTime.getText()).trim();
  let drugDeliveredNow = (await drugDelivered.getText()).trim();

  if (endTreatmentTimeNow == endTreatmentTimeStart) {
    throw new Error(`❌ Treatment remaining didn't decrease, still ${endTreatmentTimeStart}`);
  }
  logStepMessage(`✅ Treatment remaining decreased: from ${endTreatmentTimeStart} to ${endTreatmentTimeNow}`);

  if (drugDeliveredNow == drugDeliveredStart) {
    throw new Error(`❌ Drug delivered quantity didn't increase, still ${drugDeliveredStart}`);
  }
  logStepMessage(`✅ Drug delivered quantity increased: from ${drugDeliveredStart} to ${drugDeliveredNow}`);
}

async function pauseTreatment() {
  adbCouplePump();
  await browser.pause(5000);

  const alert = await waitForVisible(
    buildSelectorById('tvAlertTitle'),
    'alerts.LOW_TREATMENT_PAUSED.alert_title_low_treatment_paused',
    5000,
    300,
    true
  );
  logStepMessage("✅ Alert TREATMENT PAUSED shown [alerts.LOW_TREATMENT_PAUSED.alert_title_low_treatment_paused] upper case");

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

  logStepMessage("▶️ Waiting for 90s to have the complete alert message");
  await waitWithHeartbeat(90000); // 60000

  await checkAlert(
      'alerts.LOW_TREATMENT_PAUSED.alert_title_low_treatment_paused',
      'alerts.LOW_TREATMENT_PAUSED.alert_description_treatment_paused',
      {
          localizedTemplateKey: 'alerts.STRINGS_FOR_ALERT_TYPES.alert_info_default',
          requiredId: '21'
      }
  );
}