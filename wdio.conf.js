import { attachScreenshotFn } from './helpers/screenshot.js';
import dotenv from 'dotenv';
import fs from 'fs';
import { resolve } from 'path';
import allureReporter from '@wdio/allure-reporter';
import { exec } from 'child_process';

// Load environment variables
const projectRoot = process.cwd();
const envLocal = resolve(projectRoot, '.env.local');
if (!fs.existsSync(envLocal)) {
    throw new Error('❌ .env.local is required but was not found');
}

dotenv.config({ path: envLocal, quiet: true });

const envShared = resolve(projectRoot, '.env');
dotenv.config({ path: envShared, quiet: true });

// Base suites (always available)
const baseSuites = {
    medicationEmpty: ['./tests/medicationEmpty.js'],
    prepareTreatment: ['./tests/prepareTreatment.js'],
    regimen: ['./tests/regimen.js'],
    regDelivery: ['./tests/regDelivery.js'],
    med_reg_prep_101: ['./tests/medicationEmpty.js', './tests/regimen.js', './tests/prepareTreatment.js', './tests/tm101.js'],
    med_reg_194_101: ['./tests/medicationEmpty.js', './tests/regimen.js', './tests/tm194.js', './tests/tm101.js'],
    regimen1: ['./tests/tm100.js', './tests/tm227.js', './tests/tm538.js', './tests/tm102.js', './tests/tm104.js', './tests/tm103.js', './tests/tm962.js', './tests/tm358.js'],
    regimen2: ['./tests/tm961.js', './tests/tm963.js'],
    regimen3_vnv: ['./tests/tm98.js', './tests/tm99.js', './tests/tm435.js', './tests/tm458.js', './tests/tm2625.js', './tests/tm2627.js', './tests/tm2629.js', './tests/tm2630.js'],
    // run after medicationEmpty,prepareTreatment on PUMP_NAME P... instead of N...
    regimen4_vnv_p: ['./tests/tm97.js'],

    alarms1: ['./tests/tm198.js', './tests/tm353.js', './tests/tm200.js', './tests/tm354.js', './tests/tm357.js'],
    // run after medicationEmpty,prepareTreatment
    alarms2: ['./tests/tm197.js', './tests/tm203.js', './tests/tm201.js', './tests/tm202.js', './tests/tm199.js'],

    ftu: ['./tests/tm94.js', './tests/tm264.js', './tests/tm923.js', './tests/tm272.js', './tests/tm2631.js', './tests/tm73.js', './tests/tm273.js', './tests/tm2628.js', './tests/tm80.js'],

    treatment: ['./tests/tm339.js', './tests/tm301.js', './tests/tm423.js', './tests/tm318.js', './tests/tm309.js', './tests/tm517.js', './tests/tm2634.js'],
    treatment2: ['./tests/tm518.js', './tests/tm340.js', './tests/tm298.js', './tests/tm140.js', './tests/tm141.js'],
    treatment_vnv: ['./tests/tm2635.js'],

    // run on pump battery level low (20%)
    treatment_after_pump_battery_low: ['./tests/tm218.js', './tests/tm574.js', './tests/tm528.js'],
};

// Parse custom suites from CUSTOM_SUITES env var
// Format: "suite_name:test1,test2|suite_name2:test3,test4"
const customSuites = {};
if (process.env.CUSTOM_SUITES) {
    const suiteDefs = process.env.CUSTOM_SUITES.split('|');
    suiteDefs.forEach(suiteDef => {
        const [suiteName, testFiles] = suiteDef.split(':');
        if (suiteName && testFiles) {
            const files = testFiles.split(',').map(f => `./tests/${f.trim()}.js`);
            customSuites[suiteName.trim()] = files;
        }
    });
}

// Merge base and custom suites
const allSuites = { ...baseSuites, ...customSuites };

export const config = {
    hostname: '127.0.0.1',
    port: 4723,
    path: '/wd/hub',
    runner: 'local',

    onPrepare: function () {
            console.log('🛡️ Starting Windows keep-awake helper');

            exec('powershell -WindowStyle Hidden -Command "while ($true) { $wsh = New-Object -ComObject WScript.Shell; $wsh.SendKeys(\'{SCROLLLOCK}{SCROLLLOCK}\'); Start-Sleep -Seconds 240 }"');
        },

    specs: ['./tests/**/*.js'],

    suites: allSuites,

    maxInstances: 1,

    capabilities: [{
        platformName: "Android",
        "platformVersion": "6.0.1",
        "deviceName": "MX6",
        "automationName": "UiAutomator2",
        "appPackage": "com.neuroderm.station",
        "appActivity": ".ui.ftu.language.FTULanguageActivity",
        "fullReset": false,
        "noReset": true,                      // false true
        "skipServerInstallation": false,      // false true
        "skipDeviceInitialization": false,    // false true
        "uiautomator2ServerLaunchTimeout": 60000,
        "uiautomator2ServerInstallTimeout": 60000,
        "adbExecTimeout": 120000,
        "androidDeviceReadyTimeout": 90,
        "appWaitDuration": 30000,
        "newCommandTimeout": 0,
        "autoGrantPermissions": true
    }],

    shutdownDriver: false,
    // logLevel: 'info',
    logLevel: 'warn', // options: trace | debug | info | warn | error | silent
    bail: 0,
    baseUrl: 'http://localhost',
    waitforTimeout: 10000,
    connectionRetryTimeout: 2400000, // 40 minutes  // 120000 2 mn
    connectionRetryCount: 3,

    services: [],

    framework: 'mocha',
    reporters: [
        'spec',
        ['allure', {
            outputDir: 'allure-results',
            // outputDir: 'new-allure-results',
            disableWebdriverStepsReporting: true, // avoid default findElement/elementClick
            disableWebdriverScreenshotsReporting: true   // prevent auto "screenshot"
        }]
    ],

    mochaOpts: {
        ui: 'bdd',
        timeout: 21600000     // 6 h
        // timeout: 7200000   // 2 h
        // timeout: 600000  // 10 mn
    },

    afterTest: async function (test, context, { error, passed }) {
        // Add Run ID label to Allure, if set
        if (process.env.XRAY_RUN_ID) {
            allureReporter.addLabel('runId', process.env.XRAY_RUN_ID);
            console.log('🏷️ Added Run ID to Allure:', process.env.XRAY_RUN_ID);
        }
        // Only attach a screenshot if the test failed
        // and the failure didn’t already happen inside a step
        if (error && passed === false) {
            const screenshotName = `Test Failed - ${test.title}`;
            // await attachScreenshotFn(screenshotName);
            // 🛡️ Safe check — session might be closed or invalid
            if (browser && browser.sessionId) {
                try {
                    await attachScreenshotFn(screenshotName);
                } catch (err) {
                    console.warn(`⚠️ Failed to capture screenshot for: ${screenshotName}\nReason: ${err.message}`);
                }
            } else {
                console.warn(`⚠️ Screenshot skipped for "${screenshotName}" — no active session`);
            }
        }
    }
};