# gen1-automation — Automation Test Runner

Quick setup and run instructions (PowerShell) for the test automation repository.

## What this repo contains

- WebdriverIO tests configured to run with Appium for Android devices.
- Allure reporting for test results and archive generation.
- Helpers and scripts to prepare and run test suites from Windows PowerShell.

## Known Constraints

- Android 6 only
- UiAutomator2 only
- App relaunch uses ADB-safe logic (no terminateApp)
- Node version18.20.1 (managed with .nvmrc)
- Appium 1.22.3
- Appium is started separately using start-appium.ps1

## Preparation

1. Prerequisites (developer machine)

- Powershell 7 - Download: <https://github.com/PowerShell/PowerShell/releases>  
  Assets pick PowerShell-7.5.4-win-x64.msi
- Node.js (LTS) and npm available in PATH
- Git
- Java JDK (Temurin / Adoptium recommended, e.g. 17 or 11) — verify with `java -version`
- Android SDK (platform-tools / `adb`) and/or emulator if you run tests on devices
- New folder adb (copy platform-tools shared folder contents to it)
- Copy adbkey to C:\Users\<you>\.android
- Python 3.11.x - verify with `python --version`
- .NET 8.0 Runtime (v8.0.22) – Windows x64
- ASP.NET Core Runtime 8.0.22
- Copy TestingService (TWICO Pump API)

- If you need to write tests: Visual Studio Code
- If you only need to run tests:  Visual Studio Build Tools - Download: <https://visualstudio.microsoft.com/visual-cpp-build-tools/>
During installation, select: Desktop development with C++, Windows 10 or Windows 11 SDK

- Optional Android Studio
File → Settings → Terminal shell path: "C:\Program Files\PowerShell\7\pwsh.exe"
File → Settings → Appearance & Behavior → System Settings → Android SDK → SDK Platforms: Add Android 6 (API Level 23)  

2. Quick setup

```powershell
# Install NVM (download GUI installer from https://github.com/coreybutler/nvm-windows/releases)
# (Manual step, follow installer prompts)

# Install Node via NVM
nvm install 18.20.1
nvm use 18.20.1

# Verify Node
node -v   # -> v18.20.1
npm -v    # -> 9.9.0

# Update NPM to 9.9.0 (if not already)
npm install -g npm@9.9.0
npm -v    # -> 9.9.0

# clone
git clone <repo-url>
cd gen1-automation

# Install Node dependencies (includes Appium 1.22.3)
npm install

# Verify the project Appium version
.\node_modules\.bin\appium.cmd --version
# -> 1.22.3
```

Appium runtime is provided by the project's npm dependencies (version 1.22.3).

Start Appium using:

```powershell
.\start-appium.ps1
```

Appium 1.22.3 already includes the UiAutomator2 driver.

On the first test session, Appium automatically installs the required
UiAutomator2 helper APKs on the Android device if they are missing.

No separate driver installation is required.  
A global Appium installation is not required.

3. Environment variables (Windows)

- You must configure system/user environment variables so `java`, `adb` and Appium work. Use **Windows Settings → System → About → Advanced system settings → Environment Variables** to add or edit the variables below.
- Required variables to set (example values):
  - `JAVA_HOME` = C:\Program Files\Eclipse Adoptium\jdk-17
  - Add `%JAVA_HOME%\bin` to your `Path`
  - `ANDROID_SDK_ROOT` = C:\Users\<you>\AppData\Local\Android\Sdk
  - Add `%ANDROID_SDK_ROOT%\platform-tools` (and other SDK tools) to your `Path`

After editing via Windows Settings, open a new PowerShell session to pick up changes.

4. Repo-level env file pattern

- `.env` — template file kept in the repo; shows available variables (no secrets). Leave as-is.
- `.env.local` — machine-specific, **not** committed (is listed in `.gitignore`). Create this on each developer machine.

Example `.env.local` (project root):

```text
LANGUAGE=
# LANGUAGE=en_US
# LANGUAGE=de_DE
PUMP_NAME=N22320002
PORT_NAME=COM4
# Optional: define custom suites
#CUSTOM_SUITES=my_combo:tm961,tm963|quick_test:medicationEmpty
```

- if `LANGUAGE` not set or left empty, defaults to en_US
- `PUMP_NAME` and `PORT_NAME` are required. The `run-test.ps1` script validates `.env.local` and exits with an error if these are missing.
- `CUSTOM_SUITES` is optional and can be used to define machine-specific suites. Format explained below.

5. How the env loading works

- `helpers/config.js` loads `.env.local` first (machine overrides), then `.env` as fallback. This keeps machine-specific values out of the repository.

6. Running tests (PowerShell)
- Appium is started manually using start-appium.ps1.
- run-test.ps1 verifies Appium is running before starting WDIO.
- If Appium is not running, run-test.ps1 exits immediately with instructions.  

```powershell
# Start TestingService for TWICO
C:\TestingService\TestingService.Gen1.1.0.0\TestingService.exe

# Start Appium
.\start-appium.ps1

# Run specific suite(s) by name (comma-separated)
.\run-test.ps1 -Suites "tm_961_963"

# Run a custom suite defined in .env.local
.\run-test.ps1 -Suites "my_combo"

# Run a single spec file
.\run-test.ps1 -Spec "./tests/tm961.js"

# Clean previous Allure results and run
.\run-test.ps1 -Clean -Suites "regimen"
```

Notes about `run-test.ps1`:

- The script validates the Node version from .nvmrc, validates .env.local, verifies that Appium is running, then executes the requested tests.
- The script verifies Appium is running before starting WDIO and validates `.env.local` at start (fast-fail if required vars are missing).
- It invokes `npx wdio run wdio.conf.js` to execute suites (wdio config merges base suites and optional `CUSTOM_SUITES`).
- After each suite the script produces an Allure report and may archive it (timestamped folder). The archive contains an `open-report.bat` for convenience.

7. Custom suites via `.env.local`

- Use `CUSTOM_SUITES` to define suites without editing `wdio.conf.js`.
- Format (single line):

```text
CUSTOM_SUITES=mysuite:tm961,tm963|quick:medicationEmpty
```

- Each `suiteName:test1,test2` maps to `./tests/test1.js`, `./tests/test2.js`.
- Multiple suite definitions are separated by `|`.

8. Allure reports — how non-developer users open archives

- After a run that archives results, a timestamped folder is created containing the `allure-report` HTML folder and an `open-report.bat` file.
- Important: `allure-report\index.html` may not load correctly in some environments due to resource loading/CSP issues. **Please use the provided `open-report.bat`** inside the timestamped folder — it is the supported way for non-developers to open the report.
- Note: `open-report.bat` uses `npx allure open` under the hood and therefore **requires Node.js to be installed** on the machine. If a user cannot install Node.js, they can still try double-clicking `allure-report\index.html`, but it may fail to load fully.

Developer note: developers can also open a report via the Allure CLI with `npx allure open <path-to-archive>\allure-report` (this requires Node.js/npx).

9. Android / Appium notes

- For Android 6 devices:
  - Enable Developer Options and USB Debugging on the device.
  - Ensure `adb devices` shows the device.
  - Appium (UiAutomator2) will install helper APKs automatically when needed. If you manually uninstall helpers, Appium will reinstall them on next run.

- If you need to remove the UiAutomator2 helper APKs manually (rare):

```powershell
adb uninstall io.appium.uiautomator2.server
adb uninstall io.appium.uiautomator2.server.test
adb uninstall io.appium.uiautomator2.settings
```

- `skipServerInstallation` and `skipDeviceInitialization` Appium capabilities:  
If the UiAutomator2 helper APKs are not installed on the device, temporarily set:  
`skipServerInstallation=false`  
`skipDeviceInitialization=false`  
Run one successful session so Appium installs and initializes the device.  
After that they can usually be set back to true for faster execution.

10.  Troubleshooting tips

- If a test shows the placeholder pump (e.g. `DEFAULT_PUMP`), verify `.env.local` exists in project root and contains `PUMP_NAME` and `PORT_NAME`.