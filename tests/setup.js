import allureReporter from "@wdio/allure-reporter";
import { adbShellBlocking } from "../helpers/adbHelpers.js";
import config from "../helpers/config.js";
import { loadStrings } from "../helpers/i18n.js";
import { logStep, logStepMessage } from "../helpers/logger.js";
import {
  byId,
  byIdAndText,
  clickElement,
  clickElementWithRetryAction,
  csResetToFTU,
  displayHiddenMenu,
  enterPin,
  restorePumpToFTU,
  waitWithHeartbeat,
} from "../helpers/newUiHelpers.js";

const testKey = "setupLoop";
let preconditionsPassed = false;

/*

Loop
  hidden menu
    restore pump to FTU
    cs reset to FTU
  setup until medication empty
  wait 30 s


No decouple/couple, no pump api use

If pump not in list 
run
Check WC green Led status:
.\adb.exe shell
server_daemon_send  127.0.0.1 read_file:/sys/devices/soc0/filling_station-pm/wpc_led_g/value
 
Check WC red Led status:
.\adb.exe shell
server_daemon_send  127.0.0.1 read_file:/sys/devices/soc0/filling_station-pm/wpc_led_r/value

*/

describe("Loop on setup", () => {
  const { globalParams } = config;
  const { pumpName } = { ...globalParams };

  it("PRECONDITIONS", async () => {
    try {
      allureReporter.addLabel("type", "preconditions");
      allureReporter.addLabel("testKey", testKey);
      await logStep("Load strings for selected language", async () => {
        loadStrings();
      });
      preconditionsPassed = true;
    } catch (err) {
      throw new Error(`PRECONDITION FAILED: ${err.message}`);
    }
  });

  // number of times to loop
  const numOfLoops = 3; // 1000

  let nextBtn;

  let clickOnPump = pumpName;

  it(`${testKey}`, async function () {
    try {
      allureReporter.addLabel("testKey", testKey);
      if (!preconditionsPassed) {
        // mark test as skipped in Mocha
        this.skip();
      }
      for (let idx = 1; idx <= numOfLoops; idx++) {
        await logStep(`#${idx} `, async () => {
          await displayHiddenMenu();

          await restorePumpToFTU();

          await csResetToFTU();

          nextBtn = byId("tvSecond");

          for (let i = 0; i < 5; i++) {
            await clickElement(nextBtn, "NEXT/DONE");
          }

          // if (idx == 2) {
          //   clickOnPump = pumpName + "XXX";
          // }

          try {
            await clickElementWithRetryAction({
              targetSelector: byIdAndText("tvTitle", clickOnPump, false),
              retrySelector: byId("tvThird"),
              retryAction: async () => {
                await clickElement(byId("tvThird"), "TRY AGAIN");
              },
              label: `Pump ${clickOnPump}`,
            });
          } catch (err) {
            adbShellBlocking(
              `server_daemon_send  127.0.0.1 read_file:/sys/devices/soc0/filling_station-pm/wpc_led_g/value`,
            );
            adbShellBlocking(
              `server_daemon_send  127.0.0.1 read_file:/sys/devices/soc0/filling_station-pm/wpc_led_r/value`,
            );
            throw err;
          }

          await clickElement(nextBtn, "NEXT");

          await enterPin();

          await clickElement(nextBtn, "YES");

          await browser.pause(10000);

          await clickElement(nextBtn, "NEXT");

          await clickElement(nextBtn, "ACTIVATE REGIMEN");

          await clickElement(nextBtn, "GET STARTED");

          nextBtn = byId("tvThird");

          await clickElement(nextBtn, "GET STARTED");

          await clickElement(byId("tvDismissAlert"), "PAUSE AUDIO");

          logStepMessage("Wait 30s");
          await waitWithHeartbeat(30000);
        });
      }

      await logStep("Reset to FTU", async () => {
        await displayHiddenMenu();

        await restorePumpToFTU();

        await csResetToFTU();

        await browser.pause(20000);
      });

      logStepMessage("✅ Loop on setup completed successfully");
    } catch (err) {
      console.error("❌ Loop on setup failed:", err.message || err, "error");
      throw err;
    }
  });
});
