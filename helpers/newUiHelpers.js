import config from "./config.js";
import { getString } from "./i18n.js";
import { logStepMessage } from "./logger.js";

const DEFAULT_TIMEOUTS = {
  short: 5000,
  medium: 30000,
  long: 60000,
};

const PIN_KEY_IDS = {
  1: "key11",
  2: "key12",
  3: "key13",
  4: "key21",
  5: "key22",
  6: "key23",
  7: "key31",
  8: "key32",
  9: "key33",
  0: "key42",
};
const BACKSPACE_KEY_ID = "key43";

/*───────────────────────────────*
 * 🧠 STRING CACHE
 *───────────────────────────────*/
const stringCache = new Map();
export function getCachedString(key) {
  if (!key) return "";
  if (!stringCache.has(key)) stringCache.set(key, getString(key));
  return stringCache.get(key);
}

export function clearStringCache() {
  stringCache.clear();
}

export function byResourceId(packageName, id) {
  return "android=" + `new UiSelector().resourceId("${packageName}:id/${id}")`;
}

export function byId(id) {
  return byResourceId(config.appPackage, id);
}

export function byAndroidId(id) {
  return byResourceId("android", id);
}

export function byText(textOrKey, useKey = true) {
  const text = useKey ? getCachedString(textOrKey) : textOrKey;

  return `android=new UiSelector().text("${text}")`;
}

export function byIdAndText(id, textOrKey, useKey = true) {
  const text = useKey ? getCachedString(textOrKey) : textOrKey;

  if (!text) {
    throw new Error(
      [
        "❌ Text not found",
        `Id           : ${id}`,
        `Text/key     : ${textOrKey}`,
        `Using i18n   : ${useKey}`,
      ].join("\n"),
    );
  }

  return (
    `android=new UiSelector()` +
    `.resourceId("${config.appPackage}:id/${id}")` +
    `.text("${text}")`
  );
}

export function byScrollableText(textOrKey, useKey = true) {
  const text = useKey ? getCachedString(textOrKey) : textOrKey;

  return (
    "android=" +
    "new UiScrollable(new UiSelector().scrollable(true))" +
    `.scrollIntoView(new UiSelector().text("${text}"))`
  );
}

export function byScrollableRawText(text) {
  return byScrollableText(text, false);
}

export async function clickElement(selector, label) {
  const el = $(selector);

  await el.waitForDisplayed({ timeout: DEFAULT_TIMEOUTS.medium });

  await el.click();

  if (label) {
    logStepMessage(`Clicked: ${label}`);
  }

  return el;
}

export async function clickElementWithRetryAction({
  targetSelector,
  retrySelector,
  retryAction,
  timeout = DEFAULT_TIMEOUTS.long,
  interval = 1000,
  label,
}) {
  const end = Date.now() + timeout;

  while (Date.now() < end) {
    try {
      return await clickElement(targetSelector, label);
    } catch {
      // target not clickable yet
    }

    if (retrySelector && retryAction) {
      const retry = $(retrySelector);

      if (await retry.isDisplayed().catch(() => false)) {
        await retryAction();
        await browser.pause(200);
      }
    }

    await browser.pause(interval);
  }

  throw new Error(
    [
      "❌ Failed to click target element",
      label ? `Label : ${label}` : "",
      `Target : ${targetSelector}`,
      retrySelector ? `Retry  : ${retrySelector}` : "",
      `Timeout : ${timeout}ms`,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

export async function displayHiddenMenu() {
  await clickElement(byId("tvHeaderSystemClock"), "Hidden Menu");
}

export async function restorePumpToFTU() {
  const el =  await $(byScrollableRawText(
    "Restore Pump to FTU and ship mode without log download (DV only)",
  ));

  const enabled = await el.getAttribute("enabled").catch(() => "false");

  if (enabled === "true") {
    await clickElement(el, "Restore Pump to FTU and ship mode without log download (DV only)");

    await clickElement(byAndroidId("button1"), "YES");

    await browser.pause(20000);
  }
}

export async function csResetToFTU() {
  await clickElement(
    byScrollableRawText("CS SW Reset To FTU - Click to restart"), "CS SW Reset To FTU - Click to restart"
  );

  await clickElement(byAndroidId("button1"), "YES");
}

export async function enterPin(pin) {
  const value = pin ?? config.globalParams.defaultPumpPinCode;

  for (const digit of value) {
    await clickElement(byId(keyId(digit)), `Press PIN digit ${digit}`);
  }
}

function keyId(digit) {
  const id = PIN_KEY_IDS[digit];
  if (!id) throw new Error(`Unsupported PIN digit: ${digit}`);
  return id;
}

export async function waitWithHeartbeat(ms) {
  const interval = 10000; // every 10 seconds poke Appium
  const end = Date.now() + ms;

  while (Date.now() < end) {
    await browser.pause(interval);
    // lightweight command that keeps ADB + UiAutomator alive
    await driver.getDeviceTime();
    await driver.getPageSource();
  }
}
