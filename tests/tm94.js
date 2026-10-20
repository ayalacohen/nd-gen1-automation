// helpers
import { clearPumpLogs, connectTwico, disconnectTwico, readLogsCommand, resetPump, resetPumpToFTU, sFlash, verifyLogsContain, writeSflashParam } from '../helpers/apiHelpers.js';
import { activateRegimenAndStart, pairPump, resetToFTU } from '../helpers/preConditionsHelpers.js';
import { buildSelectorById, csTurnOffPump, displayHiddenMenu, enterPinCode, getElementById, getElementByIdAndText, isElementDisplayedById, scrollToItem, waitForVisible, waitForVisibleWithRetry, waitWithHeartbeat } from '../helpers/uiHelpers.js';

import { loadStrings } from '../helpers/i18n.js';
import { logStep, logStepMessage } from '../helpers/logger.js';

// config
import config from '../helpers/config.js';
import { flowState, saveState } from '../helpers/flowState.js';

import allureReporter from '@wdio/allure-reporter';

/*
Precondition:
Pump in FTU

Set up S/N to the pump using the following TwikoGUI command:

WriteSflashParam 0 01234567890123456789012345678901234

Reset the pump
*/
const testKey = "TM-94";
let preconditionsPassed = false;

describe(`${testKey} - Pump Serial number`, () => {
    const { apiBaseUrl, globalParams } = config;
    const { portName } = { ...globalParams };

    const writeData1 = "01234567890123456789012345678901234";
    const SN1 = "01234567890123456789012345678901234";
    const shortSN1 = SN1.slice(-9);             // "678901234"
    const pumpName1 ="N" + shortSN1.slice(1);   //  "N78901234"

    const writeData2 = "3131313131313131313131313131313131313131313131313131313131313131313131";
    const SN2 = "11111111111111111111111111111111111";
    const shortSN2 = SN2.slice(-9);             // "111111111";
    const pumpName2 = "N" + shortSN2.slice(1);  // "N11111111";

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
            await logStep('Reset to FTU', async () => {
                await resetToFTU(apiBaseUrl);
            });
            await logStep('Clear pump logs', async () => {
                await clearPumpLogs(apiBaseUrl);
            });
            await logStep(`Update serial number ${writeData1}`, async () => {
                await writeSflashParam(apiBaseUrl, 0, writeData1);
            });
            await logStep('Reset pump', async () => {
                await resetPump(apiBaseUrl);
                await browser.pause(10000);
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

        await logStep('Step 1 - Couple the pump, complete FTU, check Pump settings and pump logs', async () => {
            await step1(apiBaseUrl, SN1, shortSN1, pumpName1);
        });

        await logStep('Step 2 - Update serial number, reset pump, complete FTU, check Pump settings and pump logs', async () => {
            await step2(apiBaseUrl, writeData2, SN2, shortSN2, pumpName2);
        });

        await logStep('Step 3 - Reset pump and check Pump settings', async () => {
            await step3(apiBaseUrl, shortSN2);
        });

        await logStep('Step 4 - Turn off pump, couple and check Pump settings', async () => {
            await step4(pumpName2, shortSN2);
        });

        await logStep(`Reset pump to FTU, set SN back to ${process.env.WRITE_DATA.slice(-9)} and reset pump`, async () => {
            await resetPumpToFTU(apiBaseUrl);
            await writeSflashParam(apiBaseUrl, 0, process.env.WRITE_DATA);
            await resetPump(apiBaseUrl);
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
async function step1(apiBaseUrl, SN1, shortSN1, pumpName1) {
    logStepMessage("▶️ Step 1");
    await pairPump(pumpName1);

    await activateRegimenAndStart();

    const headerMenu = await getElementById('ivHeaderMenu');
    await headerMenu.click();

    const pumpSettings = await getElementByIdAndText('tvItemTitle', 'screens.MENU.menu_item_pump_control');
    await pumpSettings.click();

    const serialNumber = await getElementById('tvSerialNumber');
    const serialNumberText = await serialNumber.getText();

    if (serialNumberText !== shortSN1) {
        throw new Error(`Pump settings S/N mismatch: expected ${shortSN1}, got ${serialNumberText}`);
    }
    logStepMessage(`Pump settings S/N correctly set to ${serialNumberText}`);

    let backButton = await getElementById('ivHeaderBack');
    await backButton.click();

    // ble_test_screen_title
    //  text="622320002" resource-id="com.neuroderm.station:id/tvBleTestSn" 
    await displayHiddenMenu();

    const bleTest = await scrollToItem('BLE Test');
    await bleTest.click();

    const bleTestSn = await getElementById('tvBleTestSn');
    const bleTestSnText = await bleTestSn.getText();

    if (bleTestSnText !== shortSN1) {
        throw new Error(`BLE Test S/N mismatch: expected ${shortSN1}, got ${bleTestSnText}`);
    }
    logStepMessage(`BLE Test S/N correctly set to ${bleTestSnText}`);

    backButton = await getElementById('ivHeaderBack');
    await backButton.click();

    const back = await scrollToItem('Back');
    await back.click();

    await clearPumpLogs(apiBaseUrl);

    await readLogsCommand(apiBaseUrl);

    await verifyLogsContain(apiBaseUrl, `${pumpName1}||SN:${SN1}`, 3000, "warn");
    logStepMessage("✅ Step 1");
}

async function step2(apiBaseUrl, writeData2, SN2, shortSN2, pumpName2) {
    logStepMessage("▶️ Step 2");
    await sFlash(apiBaseUrl,1, 0, 0, writeData2, 0 , 0);
    await browser.pause(10000);

    await resetPump(apiBaseUrl);

    await waitWithHeartbeat(60000);

    let headerMenu = await getElementById('ivHeaderMenu');
    await headerMenu.click();

    const connectedDevices = await getElementByIdAndText('tvItemTitle', 'screens.MENU.menu_connected_devices');
    await connectedDevices.click();

    await waitForVisible(
        buildSelectorById('tvHeaderTitle'),
        'screens.SETTINGS_CONNECTED_DEVICES.settings_connected_devices_title',
        5000
    );

    const pairPump = await getElementById('tvSettingsTitle', 'screens.SETTINGS_CONNECTED_DEVICES.settings_connected_devices_pair_pump');
    await pairPump.click();

    const pump = await waitForVisibleWithRetry(
        buildSelectorById('tvTitle') + `.text("${pumpName2}")`,
        buildSelectorById('tvThird'),
        60000
    );
    await pump.click();

    let nextBtn = await getElementById('tvSecond');

    await nextBtn.click();
    await browser.pause(100);

    await enterPinCode(config.globalParams.defaultPumpPinCode);

    nextBtn = await getElementById('tvSecond');
    await nextBtn.click();
    await browser.pause(200);

    const replaceBtn = await getElementById('tvThird', 'common.cmn_text_replace');
    await replaceBtn.click();
    await browser.pause(200);

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

    headerMenu = await getElementById('ivHeaderMenu');
    await headerMenu.click();

    const pumpSettings = await getElementByIdAndText('tvItemTitle', 'screens.MENU.menu_item_pump_control');
    await pumpSettings.click();

    const serialNumber = await getElementById('tvSerialNumber');
    const serialNumberText = await serialNumber.getText();

    if (serialNumberText !== shortSN2) {
        throw new Error(`Pump settings S/N mismatch: expected ${shortSN2}, got ${serialNumberText}`);
    }
    logStepMessage(`Pump settings S/N correctly set to ${serialNumberText}`);

    const backButton = await getElementById('ivHeaderBack');
    await backButton.click();

    await clearPumpLogs(apiBaseUrl);

    await readLogsCommand(apiBaseUrl);

    await verifyLogsContain(apiBaseUrl, `${pumpName2}||SN:${SN2}`, 3000, "warn");
    logStepMessage("✅ Step 2");
}

async function step3(apiBaseUrl, shortSN2) {
    logStepMessage("▶️ Step 3");
    await resetPump(apiBaseUrl);

    // 1mn
    await waitWithHeartbeat(60000);

    const headerMenu = await getElementById('ivHeaderMenu');
    await headerMenu.click();

    const pumpSettings = await getElementByIdAndText('tvItemTitle', 'screens.MENU.menu_item_pump_control');
    await pumpSettings.click();

    const serialNumber = await getElementById('tvSerialNumber');
    const serialNumberText = await serialNumber.getText();

    if (serialNumberText !== shortSN2) {
        throw new Error(`Pump settings S/N mismatch: expected ${shortSN2}, got ${serialNumberText}`);
    }
    logStepMessage(`Pump settings S/N unchanged, correctly set to ${serialNumberText}`);

    const backButton = await getElementById('ivHeaderBack');
    await backButton.click();
    logStepMessage("✅ Step 3");
}

async function step4(pumpName2, shortSN2) {
    logStepMessage("▶️ Step 4");
    await csTurnOffPump();
    await browser.pause(5000);

    let headerMenu = await getElementById('ivHeaderMenu');
    await headerMenu.click();

    const connectedDevices = await getElementByIdAndText('tvItemTitle', 'screens.MENU.menu_connected_devices');
    await connectedDevices.click();

    await waitForVisible(
        buildSelectorById('tvHeaderTitle'),
        'screens.SETTINGS_CONNECTED_DEVICES.settings_connected_devices_title',
        5000
    );

    const pairPump = await getElementById('tvSettingsTitle', 'screens.SETTINGS_CONNECTED_DEVICES.settings_connected_devices_pair_pump');
    await pairPump.click();

    const pump = await waitForVisibleWithRetry(
        buildSelectorById('tvTitle') + `.text("${pumpName2}")`,
        buildSelectorById('tvThird'),
        60000
    );
    await pump.click();

    let nextBtn = await getElementById('tvSecond');

    await nextBtn.click();
    await browser.pause(100);

    await enterPinCode(config.globalParams.defaultPumpPinCode);

    nextBtn = await getElementById('tvSecond');
    await nextBtn.click();
    await browser.pause(200);

    const replaceBtn = await getElementById('tvThird', 'common.cmn_text_replace');
    await replaceBtn.click();
    await browser.pause(200);

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

    headerMenu = await getElementById('ivHeaderMenu');
    await headerMenu.click();

    const pumpSettings = await getElementByIdAndText('tvItemTitle', 'screens.MENU.menu_item_pump_control');
    await pumpSettings.click();

    const serialNumber = await getElementById('tvSerialNumber');
    const serialNumberText = await serialNumber.getText();

    if (serialNumberText !== shortSN2) {
        throw new Error(`Pump settings S/N mismatch: expected ${shortSN2}, got ${serialNumberText}`);
    }
    logStepMessage(`Pump settings S/N unchanged, correctly set to ${serialNumberText}`);

    const backButton = await getElementById('ivHeaderBack');
    await backButton.click();

    logStepMessage("✅ Step 4");
}
