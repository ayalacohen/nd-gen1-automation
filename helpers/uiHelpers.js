import { logStepMessage } from './logger.js';
import config from './config.js';
import { getString } from './i18n.js';
import { fillTemplate, formatFlowRate, formatHourToAmPm, getCircularClicks, getDoseClicks, getDoseConfig, getHourClicks, getHourDiffClicks, getMonthsByLanguage, getNumberClicks, isWithinMinuteTolerance, matchLocalizedTemplate, parseHour } from './generalHelpers.js';

/*───────────────────────────────*
 * 🔧 GLOBAL SETTINGS
 *───────────────────────────────*/
const DEFAULT_TIMEOUTS = {
  short: 5000,
  medium: 10000,
  long: 60000, //40000
  alarm: 120000
};

const PIN_KEY_IDS = { '1':'key11','2':'key12','3':'key13','4':'key21','5':'key22','6':'key23','7':'key31','8':'key32','9':'key33','0':'key42' };
const BACKSPACE_KEY_ID = 'key43';

/*───────────────────────────────*
 * 🧠 STRING CACHE
 *───────────────────────────────*/
const stringCache = new Map();
export function getCachedString(key) {
  if (!key) return '';
  if (!stringCache.has(key)) stringCache.set(key, getString(key));
  return stringCache.get(key);
  // if (stringCache.has(key)) {
  //   logStepMessage(`🔁 getCachedString: cache HIT for "${key}"`, 'debug');
  //   return stringCache.get(key);
  // }

  // const value = getString(key);
  // stringCache.set(key, value);
  // logStepMessage(`🆕 getCachedString: cache MISS → loaded "${key}"`, 'debug');
  // return value;
}

export function clearStringCache() {
  stringCache.clear();
}

/*───────────────────────────────*
 * 📍 SELECTOR HELPERS
 *───────────────────────────────*/
export function buildSelectorById(id) {
  return `android=new UiSelector().resourceId("${config.appPackage}:id/${id}")`;
}
export function buildSelectorByText(text) {
  return `android=new UiSelector().text("${text}")`;
}

/*───────────────────────────────*
 * 👁️ DISPLAY HELPERS
 *───────────────────────────────*/
export async function isDisplayed(selector) {
  try {
    const el = await browser.$(selector);
    if (!(await el.isExisting())) {
        return false;
    }
    return await el.isDisplayed();
  } catch {
    return false;
  }
}

export async function isElementDisplayedById(id, timeout = DEFAULT_TIMEOUTS.short, interval = 300) {
  const selector = buildSelectorById(id);
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await isDisplayed(selector)) return true;
    await browser.pause(interval);
  }
  return false;
}

export async function isElementDisplayedByText(text, timeout = DEFAULT_TIMEOUTS.short, interval = 300) {
  const selector = buildSelectorByText(text);
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await isDisplayed(selector)) return true;
    await browser.pause(interval);
  }
  return false;
}

/*───────────────────────────────*
 * ⏱️ WAIT HELPERS
 *───────────────────────────────*/
export async function waitForVisible(
  selector,
  expectedText = null,
  timeout = DEFAULT_TIMEOUTS.medium,
  interval = 300,
  forceUpperCase = false
) {
  const expectedTextStrOriginal = expectedText
    ? getCachedString(expectedText)
    : null;

  let conditionMet = false;

  await browser.waitUntil(async () => {

    if (!(await isDisplayed(selector))) return false;

    if (!expectedTextStrOriginal) {
      conditionMet = true;
      return true;
    }

    try {
      const el = await browser.$(selector);
      let actual = (await el.getText()).trim();
      let expected = expectedTextStrOriginal;

      if (forceUpperCase) {
        expected = expected.toUpperCase();
      }

      if (actual === expected) {
        conditionMet = true;
        return true;
      }

    } catch {
      return false;
    }

    return false;

  }, {
    timeout,
    interval,
    timeoutMsg: `❌ Element not visible or text mismatch after ${timeout / 1000}s: ${selector}`
  });

  if (!conditionMet) {
    throw new Error(`❌ Element condition never met: ${selector}`);
  }

  const finalElem = await browser.$(selector);

  if (expectedTextStrOriginal) {
    logStepMessage(
      `✅ Element "${selector}" text as expected: "${expectedTextStrOriginal}" [${expectedText}]`
    );
  } else {
    logStepMessage(`✅ Element displayed: ${selector}`);
  }

  return finalElem;
}

export async function waitForVisibleWithRetry(
  targetSelector,
  retrySelector,
  timeout = DEFAULT_TIMEOUTS.long,
  interval = 300
) {
  await browser.waitUntil(async () => {

    if (await isDisplayed(targetSelector)) {
      logStepMessage(`✅ Target element visible: ${targetSelector}`);
      return true;
    }

    if (retrySelector && await isDisplayed(retrySelector)) {
      logStepMessage(`⚠️ Retry element visible: ${retrySelector} — clicking...`);
      const retry = await browser.$(retrySelector);
      await retry.click();
      await browser.pause(1000);
    }

    return false;

  }, {
    timeout,
    interval,
    timeoutMsg: `❌ Timeout: ${targetSelector} not visible after ${timeout / 1000}s`
  });

  return browser.$(targetSelector);
}

export async function waitForScreenWithHeartbeat(
  targetSelector1,
  targetSelector2,
  timeoutMs = 2400000
) {
  const start = Date.now();
  const heartbeatInterval = 30000;

  while (Date.now() - start < timeoutMs) {

    // HEARTBEAT
    try {
      await browser.$(buildSelectorById('tvHeaderTitle')).isDisplayed();
    } catch (err) {
      logStepMessage("⚠️ Heartbeat failed (UIA may restart): " + err.message, "warn");
    }

    // MAIN TARGET
    if (await isDisplayed(targetSelector1)) {
      logStepMessage(`✅ Screen appeared: ${targetSelector1}`);
      return;
    }

    // ALT TARGET
    if (await isDisplayed(targetSelector2)) {
      logStepMessage(`⚠️ Screen appeared: ${targetSelector2} — clicking...`);
      const el2 = await browser.$(targetSelector2);
      await el2.click();
      await browser.pause(1000);
      continue;
    }

    await browser.pause(heartbeatInterval);
  }

  throw new Error(`❌ Timeout waiting for screen: ${targetSelector1} or ${targetSelector2}`);
}


export async function waitWithHeartbeat(ms) {
    logStepMessage(`▶️ Waiting for ${ms / 1000}s`);
    const interval = 10000; // every 10 seconds poke Appium
    const end = Date.now() + ms;

    while (Date.now() < end) {
        await browser.pause(interval);
        // lightweight command that keeps ADB + UiAutomator alive
        await driver.getDeviceTime();
        await driver.getPageSource();
    }
}

export async function waitForDisappear(
    selector,
    timeout = DEFAULT_TIMEOUTS.medium,
    interval = 300
) {
    await browser.waitUntil(
        async () => !(await isDisplayed(selector)),
        {
        timeout,
        interval,
        timeoutMsg: `❌ Element still visible after ${timeout / 1000}s: ${selector}`
        }
    );

    logStepMessage(`✅ Element disappeared within ${timeout / 1000}s: ${selector}`);
}

export async function waitForDisabled(
    selector, 
    timeout = DEFAULT_TIMEOUTS.medium
) {
    await browser.waitUntil(async () => {
        const el = await $(selector);
        if (!(await el.isExisting())) return false;
        return !(await el.isEnabled());
    }, {
        timeout,
        timeoutMsg: `❌ Element still enabled after ${timeout / 1000}s: ${selector}`
    });

    logStepMessage(`✅ Element disabled: ${selector}`);
}

/*───────────────────────────────*
 * 📱 GENERIC ELEMENT GETTERS
 *───────────────────────────────*/
export async function getElementById(id, expectedText) {
  const selector = buildSelectorById(id);
  const elem = await waitForVisible(selector, null, DEFAULT_TIMEOUTS.medium);

  if (expectedText) {
    const expectedTextStr = getCachedString(expectedText);
    const actualTextStr = (await elem.getText()).trim();
    if (actualTextStr === expectedTextStr) {
      logStepMessage(`✅ Element "${id}" text as expected: "${expectedTextStr}" [${expectedText}]`);
    } else if (actualTextStr === expectedTextStr.toUpperCase()) {
      logStepMessage(`✅ Element "${id}" text as uppercase expected: "${expectedTextStr}" [${expectedText}]`);
    }
    else {
      throw new Error(`❌ Element text mismatch: expected "${expectedTextStr}", got "${actualTextStr}" [${expectedText}]`);
    }
  }

  return elem;
}

export async function getElementByIdAndText(id, textKey, useCachedString = true) {
    const text = useCachedString ? getCachedString(textKey) : textKey;

    const selector =
        buildSelectorById(id) + `.text("${text}")`;
    return await waitForVisible(selector, null, DEFAULT_TIMEOUTS.medium);
}

export async function scrollToItem(textKey, useCachedString = false) {
    // Decide what text to scroll to
    const text = useCachedString ? getCachedString(textKey) : textKey;

  const selector =
    `new UiScrollable(new UiSelector().scrollable(true))` +
    `.scrollIntoView(new UiSelector().text("${text}"))`;

  const fullSelector = `android=${selector}`;

  try {
    logStepMessage(`🔽 Scrolling to: "${text}"  (cached=${useCachedString})`);
    const el = await browser.$(fullSelector);

    // Try a short wait to ensure the element is a usable WebDriver element
    try {
      await el.waitForDisplayed({ timeout: 3000 });
      return el;
    } catch (err) {
      // Fallback: sometimes UiScrollable returns a reference that's not clickable
      logStepMessage(`⚠️ scrollToItem: element found but not displayed, falling back to direct text lookup for "${text}"`, 'warn');
      const altSelector = buildSelectorByText(text);
      return await waitForVisible(altSelector, null, DEFAULT_TIMEOUTS.short);
    }
  } catch (err) {
    // Final fallback: try direct text selector before failing
    try {
      const altSelector = buildSelectorByText(text);
      return await waitForVisible(altSelector, null, DEFAULT_TIMEOUTS.medium);
    } catch (err2) {
      throw new Error(
        `❌ Failed to scroll to menu "${textKey}" (cached=${useCachedString}) → ${err.message}; fallback → ${err2.message}`
      );
    }
  }
}


/*───────────────────────────────*
 * 🔢 PIN ENTRY
 *───────────────────────────────*/
export async function enterPinCode(
  pin,
  {
    betweenMs = 200,
    afterMs = 500,
    retryOnWrongPin = true,
  } = {}
) {
  async function typePin(p) {
    for (const ch of p) {
      const keyId = PIN_KEY_IDS[ch];
      if (!keyId) {
        throw new Error(`Unsupported PIN character "${ch}"`);
      }
      const btn = await browser.$(buildSelectorById(keyId));
      await btn.click();
      await browser.pause(betweenMs);
    }
    await browser.pause(afterMs);
  }

  logStepMessage(`▶️ Entering PIN: ${pin}`);

  // Wait until PIN field is fully ready
  const pinField = await browser.$(buildSelectorById('inputField1'));
  await pinField.waitForDisplayed({ timeout: DEFAULT_TIMEOUTS.short });

  // UI stabilization
  await browser.pause(1000);

  // First attempt
  await typePin(pin);

  const wrongPinMessage = await isElementDisplayedById('tvPinError', 1000);
  const stillOnPinScreen = await isElementDisplayedById('inputField1', 1000);

  // ❌ Wrong PIN
  if (wrongPinMessage) {
    logStepMessage(`❌ PIN incorrect`);

    if (!retryOnWrongPin) {
      logStepMessage(`ℹ️ Retry disabled (negative PIN test)`);
      return;
    }

    logStepMessage(`🔁 Retrying PIN entry once...`, 'warn');
    await clearPinField();
    await typePin(pin);

    await validateAfterRetry();
    return;
  }

  // ⚠️ No error, but still on PIN screen
  if (stillOnPinScreen) {
    logStepMessage(
      `⚠️ PIN not registered (no error, still on screen).`,
      'warn'
    );

    if (!retryOnWrongPin) {
      logStepMessage(`ℹ️ Retry disabled`);
      return;
    }

    logStepMessage(`🔁 Retrying PIN entry once...`, 'warn');
    await clearPinField();
    await typePin(pin);

    await validateAfterRetry();
    return;
  }

  logStepMessage('✅ PIN screen dismissed');
}

async function clearPinField() {
  const backBtn = await browser.$(buildSelectorById(BACKSPACE_KEY_ID));
  for (let i = 0; i < 8; i++) {
    await backBtn.click();
    await browser.pause(100);
  }
  await browser.pause(500);
}

async function validateAfterRetry() {
  const wrongPinAfterRetry = await isElementDisplayedById('tvPinError', 1000);
  const stillOnPinScreenAfterRetry = await isElementDisplayedById(
    'inputField1',
    1000
  );

  if (wrongPinAfterRetry) {
    logStepMessage(`❌ PIN incorrect after retry`, 'error');
  } else if (stillOnPinScreenAfterRetry) {
    logStepMessage(`⚠️ Still on PIN screen after retry`, 'warn');
  } else {
    logStepMessage('✅ PIN screen dismissed');
  }
}

export async function enterPin(pin) {
    await getElementById('tvHeaderTitle', 'screens.ENTER_PAIRING_PIN.enter_pairing_pin_tittle');
    await getElementById('tvPairPinInfo', 'screens.REGIMEN_MENU.regiment_enter_pin');
    await enterPinCode(pin);
}
export async function enterPinRegimen(
  pin,
  {
    retryOnWrongPin = true, // ✅ default stays TRUE
    betweenMs = 200,
    afterMs = 500,
  } = {}
) {
  await getElementById(
    'tvHeaderTitle',
    'screens.REGIMEN_MENU.regimen_pin_title'
  );
  await getElementById(
    'tvEditRegimenPasswordNote',
    'screens.REGIMEN_MENU.regiment_note'
  );

  await enterPinCode(pin, {
    retryOnWrongPin,
    betweenMs,
    afterMs,
  });
}

/*───────────────────────────────*
 * 🔄 PUMP HANDLING
 *───────────────────────────────*/
export async function waitForPumpDetected(timeout = DEFAULT_TIMEOUTS.medium) {
  logStepMessage("▶️ Waiting for pump detected");
  await waitForVisible(
    buildSelectorById('tvHeaderTitle'),
    'common.cmn_pump_detected',
    timeout
  );
  logStepMessage("✅ Pump detected");
}

export async function selectPump(pumpName) {
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
  //await getElementById('tvHeaderTitle', 'screens.FTU_PUMP_LIST.ftu_pump_list_title');

  const nextBtn = await getElementById('tvSecond', 'common.cmn_text_next');
  if (await nextBtn.isEnabled()) throw new Error("❌ NEXT enabled too early");
  logStepMessage("✅ NEXT disabled as expected");

  await browser.pause(2000);

  const pump = await waitForVisibleWithRetry(
    buildSelectorById('tvTitle') + `.text("${pumpName}")`,
    // buildSelectorByText(`${pumpName}`),
    buildSelectorById('tvThird') + `.text("${getCachedString('common.cmn_text_try_again')}")`,
    DEFAULT_TIMEOUTS.long
  );
  await pump.click();

  await browser.waitUntil(async () => await nextBtn.isEnabled(), {
    timeout: DEFAULT_TIMEOUTS.medium,
    timeoutMsg: "❌ NEXT did not enable after selecting pump"
  });
  logStepMessage("✅ Pump selected, NEXT enabled");
  await nextBtn.click();
}

export async function handlePumpFeedback() {
    logStepMessage("▶️ Handle pump feedback");
    await waitForVisible(
      buildSelectorById('tvHeaderTitle'),
      'screens.FTU_PUMP_PAIRING.ftu_pump_pair_title',
      DEFAULT_TIMEOUTS.medium // short
    );
    logStepMessage("✅ Pump feedback visible");

    try {
        const pumpFeedbackYes = await getElementById('tvSecond', 'common.cmn_text_yes');
        if (await pumpFeedbackYes.isDisplayed()) {
            await getElementById('tvMessageContainerInfo', 'screens.FTU_PUMP_PAIRING.ftu_pump_pair_info_is_vibrated');
            await getElementById('tvFirst', 'common.cmn_text_no');
            logStepMessage("▶️ Clicking feedback YES");
            await pumpFeedbackYes.click();
            // await browser.pause(1000);
        }
    } catch { /* ignore if not present */ }
}

export async function handleRetry(pumpName) {
    logStepMessage("▶️ Handle retry");
    const tryAgain = await getElementById('tvThird', 'common.cmn_text_try_again');
    if (!await tryAgain.isDisplayed()) throw new Error("❌ TRY AGAIN not displayed after incorrect PIN");

    logStepMessage("⚠️ TRY AGAIN shown, clicking...");
    await tryAgain.click();
    await browser.pause(1000);

    const pump = await waitForVisibleWithRetry(
        buildSelectorById('tvTitle') + `.text("${pumpName}")`,
        // buildSelectorByText(`${pumpName}`),
        buildSelectorById('tvThird') + `.text("${getCachedString('common.cmn_text_try_again')}")`,
        DEFAULT_TIMEOUTS.long
    );
    await pump.click();

    const nextBtn = await getElementById('tvSecond', 'common.cmn_text_next');
    await browser.waitUntil(async () => await nextBtn.isEnabled(), {
      timeout: DEFAULT_TIMEOUTS.medium,
      timeoutMsg: "❌ NEXT did not enable after selecting pump"
    });
    logStepMessage("✅ Pump selected, NEXT enabled");
    await nextBtn.click();
    // await browser.pause(1000);
}

export async function reconnectPump(pumpName) {
    await getElementById('tvAlarmTitle', 'dialogs.PUMP_DISCONNECTED.alert_pump_disconnected_title');
    await getElementById('tvAlarmContent', 'dialogs.PUMP_DISCONNECTED.alert_pump_disconnected_content');
    await connectPump(pumpName);
}

export async function connectPump(pumpName) {
    const okBtn = await getElementById('tvThird', 'common.cmn_text_ok');
    await okBtn.click();

    await waitForPumpDetected();
    await browser.pause(3000);

    await selectPump(pumpName);
    await enterPin(config.globalParams.defaultPumpPinCode);
    await handlePumpFeedback();

    logStepMessage("▶️ Waiting for pairing completed");
    await getElementById('tvHeaderTitle', 'screens.FTU_PUMP_PAIRING.ftu_pump_pair_title_completed');
    await getElementById('tvDoneText', 'common.cmn_action_finished');
    logStepMessage("✅ Pairing completed");
}

/*───────────────────────────────*
 * 🚨 ALARM HANDLING
 *───────────────────────────────*/
export async function waitUntilAlarmAfterEstablishing(timeout = DEFAULT_TIMEOUTS.alarm, interval = 5000) {
  const end = Date.now() + timeout;

  const pumpDisconnectedSel = buildSelectorByText(getCachedString('dialogs.PUMP_DISCONNECTED.alert_pump_disconnected_title'));
  const bleCommSel = buildSelectorByText(getCachedString('alerts.BLE_COMMUNICATION_FAILURE.alert_title_ble_communication_failure'));
  const establishingSel = buildSelectorByText(getCachedString('screens.ESTABLISHING_THE_CONNECTION.screen_establishing_the_connection_title'));
  const tryAgainSel = buildSelectorByText(getCachedString('common.cmn_text_try_again'));
  const nextSel = buildSelectorByText(getCachedString('common.cmn_text_next'));

  while (Date.now() < end) {
    if (await isDisplayed(pumpDisconnectedSel)) {
      logStepMessage('✅ Alarm displayed: Pump disconnected');
      return;
    }

    if (await isDisplayed(bleCommSel)) {
      logStepMessage('⚠️ BLE communication failure — clicking TRY AGAIN...');
      const tryAgainBtn = await browser.$(tryAgainSel);
      if (await tryAgainBtn.isDisplayed()) await tryAgainBtn.click();
      await browser.pause(interval);
      continue;
    }

    if (await isDisplayed(establishingSel)) {
      logStepMessage('ℹ️ Still on "Establishing connection" — retrying...');
      const backBtn = await browser.$(buildSelectorById('ivHeaderBack'));
      const nextBtn = await browser.$(buildSelectorById('tvSecond'));
      if (await backBtn.isDisplayed()) await backBtn.click();
      if (await nextBtn.isDisplayed()) await nextBtn.click();
      await browser.pause(interval);
      continue;
    }

    if (await isDisplayed(nextSel)) {
      const nextBtn = await browser.$(buildSelectorById('tvSecond'));
      const headerTitleTxt = await (await getElementById('tvHeaderTitle')).getText();
      logStepMessage(`ℹ️ Only NEXT visible in ${headerTitleTxt} screen — clicking...`);
      await nextBtn.click();
      await browser.pause(interval);
      continue;
    }

    await browser.pause(interval);
  }

  throw new Error(`❌ Pump disconnected alarm not shown within ${timeout / 1000}s`);
}

const CHECK_CONFIG = {
    alarm: {
        label: 'Alarm',
        titleId: 'tvAlarmTitle',
        contentId: 'tvAlarmContent',
        infoId: 'tvAlarmInfo'
    },
    alert: {
        label: 'Alert',
        titleId: 'tvAlertTitle',
        contentId: 'tvAlertDescription',
        infoId: 'tvAlertInfo'
    }
};

export async function checkNotification(
    type,
    titleKey,
    contentKey,
    {
        contentTemplateValues = null, 
        expectedStr = null,
        templateKey = null,
        templateValues = [],
        localizedTemplateKey = null,
        requiredId = null,
        timeToleranceMinutes = 0
    } = {}
) {
    const cfg = CHECK_CONFIG[type];

    logStepMessage(`🔎 Checking ${cfg.label.toLowerCase()}`);

    await getElementById(cfg.titleId, titleKey);
    const contentEl = await getElementById(cfg.contentId);
    const actualContent = (await contentEl.getText()).trim();

    let expectedContent;

    // If dynamic template values provided → fill template
    if (contentTemplateValues && contentKey) {
        const template = getCachedString(contentKey);
        // logStepMessage(`ℹ️ Filling template "${contentKey}" with values: ${contentTemplateValues.join(', ')}`);
        expectedContent = fillTemplate(template, ...contentTemplateValues);
    }
    // Otherwise behave exactly like before
    else if (contentKey) {
        expectedContent = getCachedString(contentKey);
    }

    if (expectedContent) {
      let match = actualContent === expectedContent;

      // Optional minute tolerance handling
      if (!match && timeToleranceMinutes > 0) {
          match = isWithinMinuteTolerance(
              actualContent,
              expectedContent,
              timeToleranceMinutes
          );
      }

      if (!match) {
          throw new Error(
              `❌ ${cfg.label} content mismatch:\nexpected: "${expectedContent}"\ngot:      "${actualContent}"`
          );
      }
  }

    const infoEl = await getElementById(cfg.infoId);
    const actualStr = await infoEl.getText();

    // ── Strategy 1: exact string match ─────────────────────────────
    if (expectedStr !== null) {
        if (actualStr !== expectedStr) {
            throw new Error(
                `❌ ${cfg.label} mismatch:\nexpected: "${expectedStr}"\ngot:      "${actualStr}"`
            );
        }
    }
    // ── Strategy 2: filled template → exact match ──────────────────
    else if (templateKey) {
        const template = getCachedString(templateKey);
        const expected = fillTemplate(template, ...templateValues);

        if (actualStr !== expected) {
            throw new Error(
                `❌ ${cfg.label} mismatch:\nexpected: "${expected}"\ngot:      "${actualStr}"`
            );
        }
    }
    // ── Strategy 3: localized template pattern match ───────────────
    else if (localizedTemplateKey && requiredId !== null) {
        const template = getCachedString(localizedTemplateKey);

        if (!matchLocalizedTemplate(actualStr.trim(), template, requiredId)) {
            throw new Error(
                `❌ ${cfg.label} mismatch: expected ${cfg.label.toLowerCase()} with ID ${requiredId} ` +
                `and format "${template}", got "${actualStr}"`
            );
        }
    }
    else {
        throw new Error(`❌ No comparison strategy provided for ${cfg.label}`);
    }

    logStepMessage(`✅ ${cfg.label} as expected: "${actualStr}"`);
}

export async function checkAlarm(
    titleKey,
    contentKey,
    options
) {
    return checkNotification('alarm', titleKey, contentKey, options);
}

export async function checkAlert(
    titleKey,
    descriptionKey,
    options
) {
    return checkNotification('alert', titleKey, descriptionKey, options);
}

/*───────────────────────────────*
 * 🧭 ⚙️ Regimen settings utilities
 *───────────────────────────────*/
export async function openDosingRegimenSettings() {
    logStepMessage("▶️ Open Dosing regimen settings");
    const headerTitle = await getElementById('tvHeaderTitle');
    const headerTitleTxt = await headerTitle.getText();
    const dosingRegimenOverviewScreenTxt = getCachedString('screens.REGIMEN_OVERVIEW.title_single_regimen_overview');
    if (headerTitleTxt == dosingRegimenOverviewScreenTxt) {
        logStepMessage("Dosing regimen overview already displayed");
    } else {
        const headerMenu = await getElementById('ivHeaderMenu');
        await headerMenu.click();

        const dosingRegimenSettings = await getElementByIdAndText('tvItemTitle', 'screens.MENU.menu_item_regimen_settings');
        await dosingRegimenSettings.click();

        await waitForVisible(
            buildSelectorById('tvHeaderTitle'),
            'screens.REGIMEN_OVERVIEW.title_single_regimen_overview',
            DEFAULT_TIMEOUTS.long // medium
        );
    }

    const segmentsValues = await getSegmentsValues();

    logStepMessage("✅ Open Dosing regimen settings");

    return segmentsValues;
}

export async function getSegmentsValues() {  
    const firstSegmentTime =  await getElementById('tvFirstSegmentTime');
    const firstSegmentStartTime =  await getElementById('tvFirstSegmentStartTime');
    const firstSegmentEndTime =  await getElementById('tvFirstSegmentEndTime');
    const firstSegmentFlow =  await getElementById('tvFirstSegmentFlow');

    const secondSegmentTime =  await getElementById('tvSecondSegmentTime');
    const secondSegmentStartTime =  await getElementById('tvSecondSegmentStartTime');
    const secondSegmentEndTime =  await getElementById('tvSecondSegmentEndTime');
    const secondSegmentFlow =  await getElementById('tvSecondSegmentFlow');

    const totalDose =  await getElementById('tvMessageContainerFlow');

    const firstSegmentNbHours = await firstSegmentTime.getText();
    let firstSegmentStartHour = await firstSegmentStartTime.getText();
    let firstSegmentEndHour = await firstSegmentEndTime.getText();
    const firstSegmentFlowStr =  await firstSegmentFlow.getText();

    const secondSegmentNbHours = await secondSegmentTime.getText();
    let secondSegmentStartHour = await secondSegmentStartTime.getText();
    let secondSegmentEndHour = await secondSegmentEndTime.getText();
    const secondSegmentFlowStr =  await secondSegmentFlow.getText();

    if (config.language === "en_US") {
      const firstSegmentStartTimePeriod =  await getElementById('tvFirstSegmentStartTimePeriod');
      const firstSegmentEndTimePeriod =  await getElementById('tvFirstSegmentEndTimePeriod');
      firstSegmentStartHour += " " + await firstSegmentStartTimePeriod.getText();
      firstSegmentEndHour += " " + await firstSegmentEndTimePeriod.getText();

      const secondSegmentStartTimePeriod =  await getElementById('tvSecondSegmentStartTimePeriod');
      const secondSegmentEndTimePeriod =  await getElementById('tvSecondSegmentEndTimePeriod');
      secondSegmentStartHour += " " + await secondSegmentStartTimePeriod.getText();
      secondSegmentEndHour += " " + await secondSegmentEndTimePeriod.getText();
    } else {
      firstSegmentStartHour = formatHourToAmPm(firstSegmentStartHour);
      firstSegmentEndHour = formatHourToAmPm(firstSegmentEndHour);

      secondSegmentStartHour = formatHourToAmPm(secondSegmentStartHour);
      secondSegmentEndHour = formatHourToAmPm(secondSegmentEndHour);
    }

    const totalDoseStr = await totalDose.getText();

    const doseConfig = getDoseConfig(totalDoseStr);

    const segmentsValues  = {
        day: {
            nbHours: firstSegmentNbHours,
            start: firstSegmentStartHour,
            end: firstSegmentEndHour,
            doseRate: String(doseConfig.dayFlowRate),
            dose: firstSegmentFlowStr
        },
        night: {
            nbHours: secondSegmentNbHours,
            start: secondSegmentStartHour,
            end: secondSegmentEndHour,
            doseRate: String(doseConfig.nightFlowRate),
            dose: secondSegmentFlowStr
        },
        totalDose: totalDoseStr
    };

    return { segmentsValues };
}

/*───────────────────────────────*
 * 🧭 ⚙️ Pump settings utilities
 *───────────────────────────────*/
export async function csTurnOffPump() {
    logStepMessage("▶️ Turn off pump from cs");

      const headerMenu = await getElementById('ivHeaderMenu');
      await headerMenu.click();

      const pumpSettings = await getElementByIdAndText('tvItemTitle', 'screens.MENU.menu_item_pump_control');
      await pumpSettings.click();

      const turnOffPump = await waitForVisible(
        buildSelectorById('tvText'),
        'screens.TURN_OFF_PUMP.menu_item_turn_off_pump',
        DEFAULT_TIMEOUTS.short,
        300
      );
      await turnOffPump.click();

      const turnOffBtn = await getElementById('tvThird', 'common.cmn_text_turn_off');
      await turnOffBtn.click();

      await waitForVisible(
          buildSelectorById('tvHeaderTitle'),
          'screens.TURN_OFF_PUMP.turning_off_pump_title',
          DEFAULT_TIMEOUTS.medium,
          200
      );      

      await waitForVisible(
          buildSelectorById('tvHeaderTitle'),
          'screens.TURN_OFF_PUMP.turned_off_pump_title',
          DEFAULT_TIMEOUTS.medium,
          200
      );

    logStepMessage("✅Pump turned off");
}

/*───────────────────────────────*
 * 🧭 Hidden Menu Utilities
 *───────────────────────────────*/

export async function displayHiddenMenu() {
    await waitForVisibleWithRetry(buildSelectorById("tvHeaderSystemClock"), buildSelectorById("tvThird"), 30000, 1000);
    logStepMessage("▶️ Display Hidden Menu from System Clock");
    const hiddenMenu = await getElementById('tvHeaderSystemClock');

    if (!(await hiddenMenu.isEnabled())) {
        logStepMessage("▶️ Trying to click on arrow back and go back twice to access Hidden Menu");
        const backBtn = await browser.$(buildSelectorById('ivHeaderBack'));
        const goBackBtn = await browser.$(buildSelectorByText(getCachedString('common.cmn_go_back')));
        if (await backBtn.isDisplayed()) {
            await backBtn.click();
            if (await goBackBtn.isDisplayed()) {
                await goBackBtn.click();
                if (await backBtn.isDisplayed()) {
                    await backBtn.click();
                    if (await goBackBtn.isDisplayed()) {
                        await goBackBtn.click();
                    }
                }
            }
        }
    }
    await hiddenMenu.click();
}

export async function csResetToFTU() {
    logStepMessage("▶️ CS SW Reset To FTU from Hidden Menu");

    await displayHiddenMenu();

    const csResetToFTU = await waitForVisible(buildSelectorByText('CS SW Reset To FTU - Click to restart'));
    await csResetToFTU.click();

    const yesBtn = await waitForVisible(buildSelectorByText('YES'));
    await yesBtn.click();

    logStepMessage("✅ CS SW Reset To FTU done");

    // await waitForVisible(
    //     buildSelectorById('tvHeaderTitle'),
    //     'screens.LANGUAGE.title_select_language',
    //     30000
    // );
    // logStepMessage("✅ Screen language displayed");

    await waitForVisibleWithRetry(buildSelectorById("tvHeaderSystemClock"), buildSelectorById("tvThird"), 30000, 1000);
    logStepMessage("✅Clock displayed");
}

export async function csClearCSLogs() {
    logStepMessage("▶️ Clear CS Logs from Hidden Menu");
    await displayHiddenMenu();

    const stationLog = await scrollToItem('Station log');
    await stationLog.click();

    const deleteBtn = await waitForVisible(buildSelectorById('btnDelete'));
    await deleteBtn.click();

    const clearListBtn = await waitForVisible(buildSelectorByText('Clear list'));
    await clearListBtn.click();

    const backBtn = await browser.$(buildSelectorById('ivHeaderBack'));
    await backBtn.click();

    const back = await scrollToItem('Back');
    await back.click();
}

export async function csVnVHiddenMenu(text) {
    logStepMessage(`▶️ Check/Uncheck ${text} from Hidden Menu VnV`);
    await displayHiddenMenu();

    const uploadWrongCRC = await scrollToItem(text);
    await uploadWrongCRC.click();

    const back = await scrollToItem('Back');
    await back.click();
    logStepMessage(`✅ ${text} checked/unchecked`);
}

export async function csVnVExitCSApp() {
    logStepMessage("▶️ Exit CS application from Hidden Menu VnV");
    await displayHiddenMenu();

    const exitCSApp = await scrollToItem('Press to exit the CS application');
    await exitCSApp.click();
    
    const okBtn = await waitForVisible(buildSelectorByText('OK - DO IT'));
    await okBtn.click();
    logStepMessage("✅ Exit CS application done");
}

/*───────────────────────────────*
 * 🔄 Value adjustment (dose/hour) helpers
 *───────────────────────────────*/
async function performClicks(plusBtn, minusBtn, nbPlus, nbMinus, delay = 100) {
    if (nbPlus > 0) {
        for (let i = 0; i < nbPlus; i++) {
            await plusBtn.click();
            await browser.pause(delay);
        }
    } else if (nbMinus > 0) {
        for (let i = 0; i < nbMinus; i++) {
            await minusBtn.click();
            await browser.pause(delay);
        }
    }
}

export async function updateDateValueWithPlusMinusClicks({
    field,            // 'year' | 'month' | 'day'
    actualValue,
    newValue,
    clickDelay = 100
}) {
    let plusBtn, minusBtn, displayEl;

    switch (field) {
        case 'year':
            displayEl = await getElementById('tvYear');
            plusBtn = await getElementById('ivPlusYear');
            minusBtn = await getElementById('ivMinusYear');
            break;

        case 'month':
            displayEl = await getElementById('tvMonth');
            plusBtn = await getElementById('ivPlusMonth');
            minusBtn = await getElementById('ivMinusMonth');
            break;

        case 'day':
            displayEl = await getElementById('tvDay');
            plusBtn = await getElementById('ivPlusDay');
            minusBtn = await getElementById('ivMinusDay');
            break;

        default:
            throw new Error(`Unknown date field: ${field}`);
    }

    await displayEl.click();

    let clicks;

    if (field === 'year') {
        clicks = getNumberClicks(Number(actualValue), Number(newValue));
    }

    if (field === 'day') {
        clicks = getNumberClicks(Number(actualValue), Number(newValue));
    }

    if (field === 'month') {
        const months = getMonthsByLanguage();
        const actualIndex = months.indexOf(actualValue);
        const newIndex = months.indexOf(newValue);

        if (actualIndex === -1 || newIndex === -1) {
            throw new Error(`❌ Invalid month. actual="${actualValue}" new="${newValue}"`);
        }

        clicks = getCircularClicks(actualIndex, newIndex, months.length);
    }

    logStepMessage(
        `📅 ${field} change: ${actualValue} → ${newValue} | +${clicks.nbPlus} / -${clicks.nbMinus}`
    );

    await performClicks(plusBtn, minusBtn, clicks.nbPlus, clicks.nbMinus, clickDelay);
}

export async function updateTimeValueWithPlusMinusClicks({
    field,           // 'hour' | 'minute'
    actualValue,
    newValue,
    clickDelay = 100
}) {
    const plusBtn = await getElementById('ivTimePlus');
    const minusBtn = await getElementById('ivTimeMinus');

    let displayEl;

    switch (field) {
        case 'hour':
            displayEl = await getElementById('tvHour');
            break;
        case 'minute':
            displayEl = await getElementById('tvMinutes');
            break;
        default:
            throw new Error(`Unknown time field: ${field}`);
    }

    await displayEl.click();

    let clicks;

    if (field === 'minute') {
        clicks = getCircularClicks(
            Number(actualValue),
            Number(newValue),
            60
        );
    }

    if (field === 'hour') {
        if (config.language === "en_US") {
            // 12-hour format
            newValue = newValue % 12;
            if (newValue === 0) newValue = 12;
            clicks = getCircularClicks(
                Number(actualValue),
                Number(newValue),
                12
            );
        } else {
            // 24-hour format
            clicks = getCircularClicks(
                Number(actualValue),
                Number(newValue),
                24
            );
        }
    }

    logStepMessage(
        `⏰ ${field} change: ${actualValue} → ${newValue} | +${clicks.nbPlus} / -${clicks.nbMinus}`
    );

    await performClicks(plusBtn, minusBtn, clicks.nbPlus, clicks.nbMinus, clickDelay);
}

export async function updateValueWithPlusMinusClicks({ mode, actualValue, newValue, clickDelay = 100 }) {
    const minusBtn = await getElementById('ivLeft');
    const plusBtn = await getElementById('ivRight');

    let clicks;
    if (mode === 'hour') {
        const firstInput = await getElementById('tvFirstInput');
        await firstInput.click();
        clicks = getHourClicks(actualValue, newValue);
    } else if (mode === 'dose') {
        const secondInput = await getElementById('tvSecondInput');
        await secondInput.click();
        clicks = getDoseClicks(actualValue, newValue);
    } else {
        throw new Error(`Unknown update mode: ${mode}`);
    }

    logStepMessage(`Nb of Clicks (${mode}): ${clicks.nbPlus} Plus, ${clicks.nbMinus} Minus`);
    await performClicks(plusBtn, minusBtn, clicks.nbPlus, clicks.nbMinus, clickDelay);
}

export function createHour24Reader({ inputId, initialAmPm }) {
    let lastHour24 = null;
    let isPm = initialAmPm === "PM";

    return async function readHour24() {
        const elm = await getElementById(inputId);
        const raw = await elm.getText(); // "1:00" .. "12:00"
        const hour12 = parseInt(raw.split(':')[0], 10);

        // ---- de_DE, en_150 ----
        if (config.language !== "en_US") {
            return hour12; // already 24h
        }

        // ---- en_US ----

        // Detect AM/PM flip on rollover
        if (lastHour24 !== null) {
            const last12 = ((lastHour24 + 11) % 12) + 1;

            if (last12 === 11 && hour12 === 12) {
                isPm = !isPm;
            }
            if (last12 === 12 && hour12 === 11) {
                isPm = !isPm;
            }
        }

        let hour24 = hour12 % 12;
        if (isPm) hour24 += 12;

        lastHour24 = hour24;
        return hour24;
    };
}

export function createNightHour24Reader({ elementId, initialAmPm }) {
    let lastHour24 = null;
    let isPm = initialAmPm === "PM";

    return async function readNightHour24() {
        const elm = await getElementById(elementId);
        const raw = await elm.getText();

        // Extract hour from text like:
        // "Night rate start: 11:00 AM"
        // "Night rate start: 23:00"
        const timeMatch = raw.match(/(\d{1,2}):\d{2}/);

        if (!timeMatch) {
            throw new Error(`❌ Failed to parse night hour from: "${raw}"`);
        }

        const hour12 = parseInt(timeMatch[1], 10);

        // ---- 24h languages ----
        if (config.language !== "en_US") {
            return hour12;
        }

        // ---- en_US ----

        if (lastHour24 !== null) {
            const last12 = ((lastHour24 + 11) % 12) + 1;

            if (last12 === 11 && hour12 === 12) {
                isPm = !isPm;
            }
            if (last12 === 12 && hour12 === 11) {
                isPm = !isPm;
            }
        }

        let hour24 = hour12 % 12;
        if (isPm) hour24 += 12;

        lastHour24 = hour24;
        return hour24;
    };
}

export async function validate24HourOrAmPmMode(expectedTime, language, clickDelay = 150) {
    logStepMessage(`▶️ Validating time mode. Input: ${expectedTime}, Language: ${language}`);

    const isAmPmLanguage = language === "en_US";
    const plusBtn = await getElementById('ivTimePlus');
    const minusBtn = await getElementById('ivTimeMinus');

    // ---- Detect AM/PM switch presence ----
    const amPmSwitch = await browser.$(buildSelectorById('ivTimePeriodSwitch'));
    const amPmSwitchExists = await amPmSwitch.isExisting();

    if (isAmPmLanguage && !amPmSwitchExists) {
        throw new Error(`❌ Expected AM/PM mode but ivTimePeriodSwitch not found`);
    }

    if (!isAmPmLanguage && amPmSwitchExists) {
        throw new Error(`❌ Expected 24-hour mode but ivTimePeriodSwitch exists`);
    }

    logStepMessage(`✅ Correct time mode detected: ${isAmPmLanguage ? "AM/PM" : "24H"}`);

    // ---- Create reader depending on mode ----
    let readHour24;

    if (isAmPmLanguage) {
        const initialAmPm = expectedTime.includes("PM") ? "PM" : "AM";

        readHour24 = createHour24Reader({
            inputId: 'tvHour',
            initialAmPm
        });

    } else {
        readHour24 = async () => {
            const text = await (await getElementById('tvHour')).getText();
            const hour = parseInt(text.trim(), 10);

            if (isNaN(hour) || hour < 0 || hour > 23) {
                throw new Error(`❌ Invalid 24-hour display: ${text}`);
            }

            // Extra safety: ensure no AM/PM text appears
            if (text.includes("AM") || text.includes("PM")) {
                throw new Error(`❌ 24-hour mode should not display AM/PM`);
            }

            return hour;
        };
    }

    const expectedStartHour24 = parseHour(expectedTime);
    const initial24 = await readHour24();

    if (initial24 !== expectedStartHour24) {
        throw new Error(
            `❌ Initial hour mismatch. Expected ${expectedStartHour24}, got ${initial24}`
        );
    }

    logStepMessage(`✅ Initial hour validated: ${initial24}`);

    // ---- Common rotation validator ----
    async function validateRotation(moveFn, directionLabel, computeNext) {
        for (let i = 1; i <= 24; i++) {
            await moveFn();
            await browser.pause(clickDelay);

            const expected = computeNext(i);
            const actual = await readHour24();

            if (actual !== expected) {
                throw new Error(
                    `❌ ${directionLabel} mismatch at step ${i}: expected ${expected}, got ${actual}`
                );
            }

            logStepMessage(
                `🔁 Step ${i} ${directionLabel} → Hour ${formatHourToAmPm(`${expected}:00`)}`
            );
        }

        logStepMessage(`✅ ${directionLabel} full rotation validated`);
    }

    await validateRotation(
        async () => plusBtn.click(),
        "PLUS",
        (i) => (expectedStartHour24 + i) % 24
    );

    await validateRotation(
        async () => minusBtn.click(),
        "MINUS",
        (i) => (expectedStartHour24 - i + 24) % 24
    );

    // ---- Final restore check ----
    const restored = await readHour24();
    if (restored !== expectedStartHour24) {
        throw new Error(
            `❌ Failed to restore initial hour. Expected ${expectedStartHour24}, got ${restored}`
        );
    }

    logStepMessage(`✅ Time mode validation passed for ${language} ✅`);
}

export async function validateDayStartHourFullCycle(expectedStartDay, expectedStartNight, clickDelay = 150) {

    logStepMessage(`▶️ Validating Day Start Hour cycle from: ${expectedStartDay} - Night Start Hour from: ${expectedStartNight}`);

    const startHour24 = parseHour(expectedStartDay);
    const startNightHour24 = parseHour(expectedStartNight);

    const dayInitialAmPm = expectedStartDay.includes("PM") ? "PM" : "AM";
    const nightInitialAmPm = expectedStartNight.includes("PM") ? "PM" : "AM";

    const minusBtn = await getElementById('ivLeft');
    const plusBtn = await getElementById('ivRight');

    const readHour24 = createHour24Reader({
        inputId: 'tvFirstInput',
        initialAmPm: dayInitialAmPm
    });

    const readNightHour24 = createNightHour24Reader({
        elementId: 'tvNightPart',
        initialAmPm: nightInitialAmPm
    });

    const initialDay = await readHour24();
    const initialNight = await readNightHour24();

    if (initialDay !== startHour24) {
        throw new Error(
            `❌ Initial Day mismatch: expected ${formatHourToAmPm(`${startHour24}:00`)}, got ${formatHourToAmPm(`${initialDay}:00`)}`
        );
    }

    logStepMessage(`✅ Initial Day Start Hour validated: ${formatHourToAmPm(`${initialDay}:00`)}`);

    if (initialNight !== startNightHour24) {
        throw new Error(
            `❌ Initial Night mismatch: expected ${formatHourToAmPm(`${startNightHour24}:00`)}, got ${formatHourToAmPm(`${initialNight}:00`)}`
        );
    }

    logStepMessage(`✅ Initial Night Start Hour validated: ${formatHourToAmPm(`${initialNight}:00`)}`);

    if (initialNight !== (initialDay + 18) % 24) {
        throw new Error(
            `❌ Initial Day/Night mismatch: Day=${formatHourToAmPm(`${initialDay}:00`)} Night=${formatHourToAmPm(`${initialNight}:00`)}`
        );
    }

    logStepMessage(`✅ Initial Day/Night relationship (6h difference) validated`);

    async function validate(moveFn, directionLabel, computeNext) {
        const initial24 = await readHour24();

        logStepMessage(
            `▶️ Testing ${directionLabel} rotations... start=` +
            `${formatHourToAmPm(`${initial24}:00`)}`
        );

        for (let i = 1; i <= 24; i++) {
            await moveFn();
            await browser.pause(clickDelay);

            const expectedDay = computeNext(i - 1);
            const actualDay = await readHour24();

            if (actualDay !== expectedDay) {
                throw new Error(
                    `❌ Hour mismatch on ${directionLabel} step ${i}: expected ${formatHourToAmPm(`${expectedDay}:00`)}, got ${formatHourToAmPm(`${actualDay}:00`)}`
                );
            }

            const actualNight = await readNightHour24();
            const expectedNight = (actualDay + 18) % 24;

            if (actualNight !== expectedNight) {
                throw new Error(
                    `❌ Night rate mismatch on step ${i}: expected ${formatHourToAmPm(`${expectedNight}:00`)}, got ${formatHourToAmPm(`${actualNight}:00`)}`
                );
            }

            logStepMessage(
                `🔁 Step ${i} ${directionLabel} → Day ${formatHourToAmPm(`${actualDay}:00`)} | Night ${formatHourToAmPm(`${actualNight}:00`)}`
            );
        }

        logStepMessage(`✅ Completed full ${directionLabel} rotation`);
    }

    await validate(
        async () => plusBtn.click(),
        "PLUS",
        (i) => (startHour24 + i + 1) % 24
    );

    await validate(
        async () => minusBtn.click(),
        "MINUS",
        (i) => (startHour24 - i - 1 + 24) % 24
    );

    const restored24 = await readHour24();
    if (restored24 !== startHour24) {
        throw new Error(
            `❌ Failed to restore initial hour: ` +
            `expected ${formatHourToAmPm(`${startHour24}:00`)}, ` +
            `got ${formatHourToAmPm(`${restored24}:00`)}`
        );
    }

    logStepMessage("✅ Full Day Start Hour rotation validation passed ✅");
}

export async function validateDayDoseFullCycle(expectedStartDose, clickDelay = 150) {
    logStepMessage(`▶️ Validating Day Dose cycle: start=${expectedStartDose}`);

    const plusBtn = await getElementById('ivRight');
    const minusBtn = await getElementById('ivLeft');
    const doseId = 'tvSecondInput';

    await (await getElementById(doseId)).click();

    // ✅ Build sorted dose list from config keys
    const doseValues = Object.keys(config.globalParams.doseMapping)
        .map(d => parseInt(d, 10))
        .sort((a, b) => a - b);

    const minDose = doseValues[0];
    const maxDose = doseValues[doseValues.length - 1];

    const readDose = async () =>
        parseInt(await (await getElementById(doseId)).getText(), 10);

    // ✅ Index lookup helper
    const indexOf = d => doseValues.indexOf(parseInt(d, 10));

    // ✅ Verify start matches
    let idx = indexOf(expectedStartDose);
    if (idx === -1)
        throw new Error(`❌ Unexpected initial dose: ${expectedStartDose}`);

    //-----------------------------------
    // ✅ PLUS: until maximum dose
    //-----------------------------------
    logStepMessage("▶️ Testing PLUS until max...");
    while (idx < doseValues.length - 1) {
        await plusBtn.click();
        await browser.pause(clickDelay);
        idx++;

        const expected = doseValues[idx];
        const actual = await readDose();
        if (actual !== expected)
            throw new Error(`❌ PLUS mismatch: expected=${expected}, got=${actual}`);

        logStepMessage(`🔁 Step ${idx} PLUS → Dose ${expected}`);
    }
    if (doseValues[idx] !== maxDose) {
        throw new Error(`❌ Max dose mismatch: expected=${maxDose}, got=${doseValues[idx]}`);
    }
    logStepMessage(`✅ Reached max dose ${doseValues[idx]} OK`);

    //-----------------------------------
    // ✅ MINUS: until minimum dose
    //-----------------------------------
    logStepMessage("▶️ Testing MINUS until min...");
    while (idx > 0) {
        await minusBtn.click();
        await browser.pause(clickDelay);
        idx--;

        const expected = doseValues[idx];
        const actual = await readDose();
        if (actual !== expected)
            throw new Error(`❌ MINUS mismatch: expected=${expected}, got=${actual}`);

        logStepMessage(`🔁 Step ${idx} MINUS → Dose ${expected}`);
    }
    if (doseValues[idx] !== minDose) {
        throw new Error(`❌ Min dose mismatch: expected=${minDose}, got=${doseValues[idx]}`);
    }
    logStepMessage(`✅ Reached min dose ${doseValues[idx]} OK`);

    //-----------------------------------
    // ✅ PLUS again → restore starting value
    //-----------------------------------
    logStepMessage("▶️ Restoring start dose by PLUS...");
    while (idx < indexOf(expectedStartDose)) {
        await plusBtn.click();
        await browser.pause(clickDelay);
        idx++;

        const expected = doseValues[idx];
        const actual = await readDose();
        if (actual !== expected)
            throw new Error(`❌ Restore mismatch: expected=${expected}, got=${actual}`);

        logStepMessage(`🔁 Step ${idx} PLUS → Dose ${expected}`);
    }

    const restored = await readDose();
    if (restored !== parseInt(expectedStartDose, 10)) {
        throw new Error(`❌ Failed to restore original dose: expected=${expectedStartDose}, got=${restored}`);
    }

    logStepMessage("✅ Full dose rotation validation passed ✅");
}


export async function updateVnVValueWithPlusMinusClicks({ mode, actualValue, newValue, clickDelay = 100 }) {
    let clicks;
    if (mode === 'startHour') {
      const startTime = await getElementByIdAndText('tvVnvSegmentStartTime', actualValue, false);
      await startTime.click();
      clicks = getHourDiffClicks(actualValue.split(':')[0], newValue);
    } else if (mode === 'endHour') {
      const endTime = await getElementByIdAndText('tvVnvSegmentEndTime', actualValue, false);
      await endTime.click();
      clicks = getHourDiffClicks(actualValue.split(':')[0], newValue);
    } /*else if (mode === 'flowRate') {
      const flowRate = await getElementByIdAndText('tvVnvSegmentFlowRate', actualValue, false);
      await flowRate.click();
      //clicks = getDoseDiffClicks(actualValue, newValue);
    }*/ else {
        throw new Error(`Unknown update mode: ${mode}`);
    }

    logStepMessage(`Nb of Clicks (${mode}): ${clicks.nbPlus} Plus, ${clicks.nbMinus} Minus`);

    const minusBtn = await getElementById('btVnVTImeDialogHoursMinus');
    const plusBtn = await getElementById('btVnVTImeDialogHoursPlus');

    await performClicks(plusBtn, minusBtn, clicks.nbPlus, clicks.nbMinus, clickDelay);

    const saveBtn = await getElementById('tvVnVTimeDialogSave');
    await saveBtn.click();
}

export async function updateVnVFlowRateValue({ actualValue, newValue }) {
  // text="0.640 ml/h" resource-id="com.neuroderm.station:id/tvVnvSegmentFlowRate"
  const formattedValue = formatFlowRate(actualValue);
  const flowRate = await getElementByIdAndText('tvVnvSegmentFlowRate', formattedValue + " ml/h", false);
  await flowRate.click();

  await replaceNumericValueById('etVnVDialogFlow', newValue);

  const saveBtn = await getElementById('tvVnVFlowDialogSave');
  await saveBtn.click();
}

export async function replaceNumericValueById(id, newValue) {
    const el = await getElementById(id);

    await el.waitForDisplayed({ timeout: DEFAULT_TIMEOUTS.short });

    // Focus
    await el.click();
    await browser.pause(300);

    // Clear existing value (reliable for Android)
    try {
        await el.clearValue();
    } catch {
        // fallback if clearValue fails
        await browser.execute('mobile: shell', {
            command: 'input',
            args: ['keyevent', 'KEYCODE_MOVE_END']
        });

        for (let i = 0; i < 10; i++) {
            await browser.execute('mobile: shell', {
                command: 'input',
                args: ['keyevent', 'KEYCODE_DEL']
            });
        }
    }

    await browser.pause(300);

    // Type new value
    await el.setValue(String(newValue));

    logStepMessage(`✏️ Replaced value with ${newValue}`);
}

/*───────────────────────────────*
 * 🔄 Pump battery charging
 *───────────────────────────────*/
export async function pumpBatteryChargingOrConnectTubes() {
    const headerTitle = await getElementById('tvHeaderTitle');
    const headerTitleText = await headerTitle.getText();
    const pumpBatteryChargingTitleText = getCachedString('screens.CHARGING.charging_screen_title');
    const connectTubesTitleText = getCachedString('screens.CONNECT_TUBES.connect_tubes_screen_title');
    if (headerTitleText == pumpBatteryChargingTitleText) {
        logStepMessage(`▶️ ${pumpBatteryChargingTitleText} screen displayed - waiting for pump battery 100%`);
        await getElementById('tvMessageContainerInfo', 'screens.CHARGING.charging_screen_info');

        await waitForScreenWithHeartbeat(
            buildSelectorById('tvHeaderTitle') + `.text("${getCachedString('screens.CONNECT_TUBES.connect_tubes_screen_title')}")`,
            buildSelectorById('tvThird') + `.text("${getCachedString('common.cmn_resume_process')}")`,
            3600000
        );
    }
    else if (headerTitleText == connectTubesTitleText) {
        logStepMessage(`✅ ${connectTubesTitleText} screen displayed`);
    }
    else {
        throw new Error(`❌ ${headerTitleText} screen displayed`);
    }

    await getElementById('tvFirstStep', 'screens.CONNECT_TUBES.connect_tubes_screen_info_first');
    await getElementById('tvSecondStep', 'screens.CONNECT_TUBES.connect_tubes_screen_info_second');
    await getElementById('tvThirdStep', 'screens.CONNECT_TUBES.connect_tubes_screen_info_third');

    const nextBtn = await getElementById('tvFillDetailNext', 'common.cmn_text_next');
    if (!(await nextBtn.isEnabled())) {
        throw new Error("❌ NEXT disabled");
    }
    logStepMessage("✅ NEXT enabled");
}

export async function getBounds(element) {
    const loc = await element.getLocation();
    const size = await element.getSize();

    const bounds = {
        left: loc.x,
        top: loc.y,
        right: loc.x + size.width,
        bottom: loc.y + size.height,
        width: size.width,
        height: size.height,
    };

    // Debug log
    logStepMessage(`📐 Bounds: ${JSON.stringify(bounds)}`);

    return bounds;
}

// const ZONES = {
//     topLeft:      { left: 0,   top: 0,   right: 76,    bottom: 76 },
//     topRight:     { left: 917, top: 19,  right: 1018,  bottom: 56 },
//     bottomLeft:   { left: 0,   top: 544, right: 1024,  bottom: 600 },      // FULL bottom bar
//     bottomCenter: { left: 261, top: 506, right: 733,   bottom: 576 },
//     bottomRight:  { left: 753, top: 506, right: 999,   bottom: 576 }
// };
export const ZONES = {
    TOP_LEFT:      { x: 0.00, y: 0.00, w: 0.20, h: 0.20 },
    TOP_RIGHT:     { x: 0.80, y: 0.00, w: 0.20, h: 0.20 },
    BOTTOM_LEFT:   { x: 0.00, y: 0.80, w: 0.20, h: 0.20 },
    BOTTOM_RIGHT:  { x: 0.80, y: 0.80, w: 0.20, h: 0.20 },
    BOTTOM_CENTER: { x: 0.25, y: 0.75, w: 0.50, h: 0.25 },
    BOTTOM:        { x: 0.00, y: 0.80, w: 1.00, h: 0.20 }
    // add more as needed
};

export async function getNormalizedRect(element) {
    const bounds = await getBounds(element);

    const screen = await driver.getWindowRect(); // width + height
    
    // Debug log
    logStepMessage(`📐 x: ${bounds.left / screen.width} - y: ${bounds.top  / screen.height}`);

    return {
        x: bounds.left / screen.width,
        y: bounds.top  / screen.height,
        width: bounds.width / screen.width,
        height: bounds.height / screen.height
    };
}
function isInsideZone(norm, zone, tolerance = 0.02) {

    const x1 = zone.x - tolerance;
    const y1 = zone.y - tolerance;
    const x2 = zone.x + zone.w + tolerance;
    const y2 = zone.y + zone.h + tolerance;

    return (
        norm.x >= x1 &&
        norm.y >= y1 &&
        norm.x <= x2 &&
        norm.y <= y2
    );
}


function isInside(bounds, zone) {
    return (
        bounds.left   >= zone.left   &&
        bounds.top    >= zone.top    &&
        bounds.right  <= zone.right  &&
        bounds.bottom <= zone.bottom
    );
}
export async function isTopLeft(element) {
    const rect = await getNormalizedRect(element);
    return isInsideZone(rect, ZONES.TOP_LEFT);
}

export async function isTopRight(element) {
    const rect = await getNormalizedRect(element);
    return isInsideZone(rect, ZONES.TOP_RIGHT);
}

export async function isBottomRight(element) {
    const rect = await getNormalizedRect(element);
    return isInsideZone(rect, ZONES.BOTTOM_RIGHT);
}

export async function isBottomCenter(element) {
    const rect = await getNormalizedRect(element);
    return isInsideZone(rect, ZONES.BOTTOM_CENTER);
}

export async function isBottom(element, tolerance = 0.02) {
    const rect = await getNormalizedRect(element);
    return isInsideZone(rect, ZONES.BOTTOM, tolerance);
}


// export async function isTopLeft(el) {
//     return isInside(await getBounds(el), ZONES.topLeft);
// }

// export async function isTopRight(el) {
//     return isInside(await getBounds(el), ZONES.topRight);
// }

// export async function isBottomLeft(el) {
//     return isInside(await getBounds(el), ZONES.bottomLeft);
// }

// export async function isBottomCenter(el) {
//     return isInside(await getBounds(el), ZONES.bottomCenter);
// }

// export async function isBottomRight(el) {
//     return isInside(await getBounds(el), ZONES.bottomRight);
// }