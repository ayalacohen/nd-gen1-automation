param(
    [switch]$ValidateArchive,
    [switch]$Clean,

    [string]$Suites,          # comma-separated list: "suite1,suite2"
    [string]$Suite,           # single suite name
    [string]$Spec,            # specific spec file path

    [switch]$Archive,         # archive after each suite
    [switch]$ArchiveOnly,     # archive now + exit
    [string]$Label,           # optional label for archive

    [switch]$SkipXray,        # skip xray upload
    [switch]$XrayOnly,        # only xray upload from allure-results
    [string]$RunId            # only xray upload on explicit run
)

# ---------------------------------------------------------------
# HELP
# ---------------------------------------------------------------
if ($PSBoundParameters.Count -eq 0) {
    Write-Host ""
    Write-Host "==================== RUN-TEST HELP ====================" -ForegroundColor Cyan
    Write-Host ""

    Write-Host "📌 Test execution:" -ForegroundColor Yellow
    Write-Host "  Run specific spec:"
    Write-Host "     .\run-test.ps1 -Spec .\tests\tm100.js"
    Write-Host ""
    Write-Host "  Run single suite:"
    Write-Host "     .\run-test.ps1 -Suite regimen"
    Write-Host ""
    Write-Host "  Run multiple suites:"
    Write-Host "     .\run-test.ps1 -Suites `"medicationEmpty,regimen`""
    Write-Host ""

    Write-Host "🧹 Maintenance:" -ForegroundColor Yellow
    Write-Host "  Clean Allure data ONLY (no test run) :"
    Write-Host "     .\run-test.ps1 -Clean"
    Write-Host "     (remove Allure results AND reset xray-uploaded-runs.json)"
    Write-Host ""
    Write-Host "  Clean before running tests:"
    Write-Host "     .\run-test.ps1 -Clean -Spec .\tests\tm100.js"
    Write-Host "     (clean Allure data, reset Xray uploaded runs, then execute tests)"
    Write-Host ""

    Write-Host "📦 Archiving:" -ForegroundColor Yellow
    Write-Host "  Archive after test run:"
    Write-Host "     .\run-test.ps1 -Spec .\tests\tm100.js -Archive -Label `"baseline`""
    Write-Host ""
    Write-Host "  Archive existing results ONLY (no test run):"
    Write-Host "     .\run-test.ps1 -ArchiveOnly"
    Write-Host ""
    Write-Host "  Archive existing results with label:"
    Write-Host "     .\run-test.ps1 -ArchiveOnly -Label `"before-upgrade`""
    Write-Host ""

    Write-Host "📡 Xray Integration" -ForegroundColor Yellow
    Write-Host "This project does NOT create Test Executions in Xray."
    Write-Host "It updates test runs inside an EXISTING manually created"
    Write-Host "Test Execution that is linked to a Test Plan."
    Write-Host ""
    Write-Host "➡ For every new CS / Pump version:"
    Write-Host "   1. Create a NEW Test Execution in Xray manually"
    Write-Host "   2. Link it to the correct Test Plan"
    Write-Host "   3. Put its key in XRAY_TEST_EXECUTION_KEY in .env.local"
    Write-Host ""
    Write-Host "Required variables in .env.local:"
    Write-Host "   XRAY_CLIENT_ID / XRAY_CLIENT_SECRET"
    Write-Host "   XRAY_TEST_EXECUTION_KEY"
    Write-Host "   XRAY_ENV_INFO (version information added to comments)"
    Write-Host ""
    Write-Host "Commands:"
    Write-Host ""
    Write-Host "  Skip Xray upload (run tests + Allure only):"
    Write-Host "     .\run-test.ps1 -Spec .\tests\tm100.js -SkipXray"
    Write-Host ""
    Write-Host "  Upload existing Allure results to Xray ONLY:"
    Write-Host "     .\run-test.ps1 -XrayOnly"
    Write-Host "     (scans Allure results, skips already uploaded RunIds)"
    Write-Host ""
    Write-Host "  Upload Allure results to Xray using a specific RunId:"
    Write-Host "     .\run-test.ps1 -XrayOnly -RunId 20260101-093149"
    Write-Host "     (forces upload of that specific run)"
    Write-Host ""

    Write-Host "📂 Open archived reports:"
    Write-Host "  Double-click 'open-report.bat' inside the archive folder"
    Write-Host "  OR run:"
    Write-Host "     npx allure open '<archive-folder>\allure-report'"
    Write-Host ""

    Write-Host "⚠ Notes:" -ForegroundColor DarkYellow
    Write-Host "  • Tests run ONLY when -Spec, -Suite, or -Suites is provided"
    Write-Host "  • .env.local is mandatory and loaded at startup"
    Write-Host "  • Xray credentials are required ONLY when Xray upload is used"
    Write-Host "  • Xray upload uses runId from Allure result json to detect already uploaded runs"
    Write-Host "  • When -XrayOnly is used with -RunId, the provided RunId is used for upload"
    Write-Host "  • Uploaded RunIds are recorded in xrayUploadedRuns.json and automatically appended after successful upload"

    Write-Host ""

    Write-Host "=========================================================" -ForegroundColor Cyan
    Write-Host ""
    exit
}

# ---------------------------------------------------------------
# PATHS
# ---------------------------------------------------------------
$Root = Get-Location
$AllureResults = Join-Path $Root "allure-results"
$AllureReport = Join-Path $Root "allure-report"
$ArchiveRoot = Join-Path $Root "archive"
# $ArchiveRoot   = "C:\Users\Yehuda\Neuroderm ltd\Device - VnV SW Sync\AC\archive"

# ---------------------------------------------------------------
# UTILITIES
# ---------------------------------------------------------------

function Test-NodeVersion {
    $expectedVersion = "v$((Get-Content .nvmrc).Trim())"
    $currentVersion = (node -v).Trim()

    Write-Host "📦 Node version: $currentVersion"

    if ($currentVersion -ne $expectedVersion) {
        Write-Host ""
        Write-Host "❌ Wrong Node version"
        Write-Host "Expected: $expectedVersion"
        Write-Host "Run: nvm use $($expectedVersion.TrimStart('v'))"
        exit 1
    }
}

function Import-EnvLocal {
    $envFile = Join-Path $Root ".env.local"

    if (-not (Test-Path $envFile)) {
        Write-Host "❌ .env.local is required but was not found" -ForegroundColor Red
        exit 1
    }

    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -eq "" -or $line.StartsWith("#")) { return }

        if ($line -match '^([^=]+)=(.*)$') {
            $key = $matches[1].Trim()
            $val = $matches[2].Trim('"').Trim()
            # Write-Host "Setting env: $key=$val"
            [System.Environment]::SetEnvironmentVariable($key, $val, "Process")
        }
    }
}

function Test-EnvironmentVariables {
    param(
        [string[]]$Required = @('PUMP_NAME', 'PORT_NAME')
    )

    Write-Host "`n🔍 Validating environment variables..." -ForegroundColor Cyan

    $missing = $Required | Where-Object {
        -not [System.Environment]::GetEnvironmentVariable($_, "Process")
    }

    if ($missing.Count -gt 0) {
        Write-Host "❌ Missing required environment variables:" -ForegroundColor Red
        foreach ($m in $missing) { Write-Host "   - $m" }
        exit 1
    }

    Write-Host "✅ Environment validated:" -ForegroundColor Green
    foreach ($v in $Required) {
        $val = [System.Environment]::GetEnvironmentVariable($v, "Process")
        Write-Host "   $v=$val" -ForegroundColor Gray
    }
}
function Test-AppiumAlive {
    try {
        $res = Invoke-RestMethod "http://127.0.0.1:4723/wd/hub/status"

        Write-Host "✅ Appium is running (v$($res.value.build.version))"
        return
    }
    catch {
        Write-Host ""
        Write-Host "❌ Appium is not running."
        Write-Host "Start it in another terminal:"
        Write-Host "    .\start-appium.ps1"
        exit 1
    }
}


function Test-AllureReportValid {
    param([string]$Path)

    if (-not (Test-Path "$Path\index.html")) { return $false }
    if (-not (Test-Path "$Path\app.js")) { return $false }
    if (-not (Test-Path "$Path\data")) { return $false }

    $json = Get-ChildItem "$Path\data" -Filter "*.json" -ErrorAction SilentlyContinue
    return ($json.Count -gt 0)
}

# ---------------------------------------------------------------
# XRAY
# ---------------------------------------------------------------

$XrayAuthUrl = "https://xray.cloud.getxray.app/api/v2/authenticate"
$XrayImportUrl = "https://xray.cloud.getxray.app/api/v2/import/execution"

function Get-XrayToken {
    param([string]$clientId, [string]$clientSecret, [string]$authUrl)

    Write-Host "🔐 Authenticating to Xray..."
    $tokenResp = Invoke-RestMethod -Method Post -Uri $authUrl `
        -Body (@{ client_id = $clientId; client_secret = $clientSecret } | ConvertTo-Json) `
        -ContentType "application/json"

    return $tokenResp.ToString().Trim('"')
}
function Invoke-AllureResultsUploadToXray {
    param(
        [Parameter(Mandatory)] [string] $AllureResultsPath,
        [Parameter(Mandatory)] [string] $XrayToken,
        [Parameter(Mandatory)] [string] $XrayImportUrl,
        [Parameter(Mandatory)] [string] $TestExecutionKey,
        [Parameter(Mandatory)] [string] $EnvInfo,
        [Parameter(Mandatory)] [string] $UploadedRunsFile,
        [Parameter()] [string] $CurrentRunId,
        [Parameter()] [string] $TargetRunId
    )

    Write-Host "📦 Loading uploaded Xray runs..."
    $UploadedRuns = @()
    if (Test-Path $UploadedRunsFile) {
        try {
            $loaded = Get-Content $UploadedRunsFile -Raw | ConvertFrom-Json
            if ($null -ne $loaded) { $UploadedRuns = @($loaded | ForEach-Object { $_.Trim() }) }
        }
        catch {
            Write-Host "⚠️ Failed to parse uploaded runs file, resetting"
            $UploadedRuns = @()
        }
    }
    Write-Host "📄 Uploaded runs so far: $($UploadedRuns -join ', ')"

    # $resultFiles = Get-ChildItem $AllureResultsPath -Filter "*.json" -File
    $resultFiles = Get-ChildItem $AllureResultsPath -Filter "*-result.json" -File
    $allResults = @{}

    foreach ($file in $resultFiles) {
        $json = Get-Content $file.FullName -Raw | ConvertFrom-Json
        $labels = $json.labels

        $testKey = ($labels | Where-Object { $_.name -eq "testKey" }).value
        $runId = ($labels | Where-Object { $_.name -eq "runId" } | Select-Object -First 1 -ExpandProperty value).Trim()

        if (-not $testKey -or $testKey -notlike "TM-*") { continue }
        if (-not $runId) { continue }

        if ($TargetRunId) { if ($runId -ne $TargetRunId) { continue } }
        elseif ($CurrentRunId) { if ($runId -ne $CurrentRunId) { continue } }
        else { if ($UploadedRuns -contains $runId) { continue } }

        if (-not $allResults.ContainsKey($testKey)) { 
            $allResults[$testKey] = @{}
        }

        $timestamps = Get-TestTimestamps $json

        if (-not $allResults[$testKey].ContainsKey($runId)) {
            $allResults[$testKey][$runId] = @{
                start    = $timestamps.start
                stop     = $timestamps.stop
                status   = $json.status
                messages = @()
            }
        }
        else {
            $entry = $allResults[$testKey][$runId]

            $entry.start = [Math]::Min($entry.start, $timestamps.start)
            $entry.stop = [Math]::Max($entry.stop, $timestamps.stop)

            if ($json.status -in @("failed", "broken")) {
                $entry.status = $json.status
            }
        }

        if ($json.statusDetails.trace) {
            $allResults[$testKey][$runId].messages += $json.statusDetails.trace
        }
        elseif ($json.statusDetails.message) {
            $allResults[$testKey][$runId].messages += $json.statusDetails.message
        }
    }

    if ($allResults.Count -eq 0) {
        Write-Host "ℹ️ No new runs were uploaded to Xray";
        return
    }

    # Write-Host ($allResults | ConvertTo-Json -Depth 6)

    $testsPayload = @()
    $runIdsUploaded = [System.Collections.Generic.HashSet[string]]::new()

    foreach ($testKey in $allResults.Keys) {
        $runs = $allResults[$testKey]
        $latest = $runs.GetEnumerator() |
        Sort-Object { $_.Value.stop } -Descending |
        Select-Object -First 1

        $latestRunId = $latest.Key
        $data = $latest.Value

        # Correct status mapping
        $status = if ($data.status -in @("failed", "broken")) { "FAILED" } else { "PASSED" }

        # Correct duration
        $durationMs = $data.stop - $data.start
        $ts = [TimeSpan]::FromMilliseconds($durationMs)
        $durationStr = "{0:D2}:{1:D2}:{2:D2}.{3:D3}" -f $ts.Hours, $ts.Minutes, $ts.Seconds, $ts.Milliseconds

        # Prepare messages text safely
        $messagesText = ""
        if ($data.messages -and $data.messages.Count -gt 0) {
            $messagesText = ($data.messages | Where-Object { $_ } | Out-String).Trim()
        }

        # Comment
        $commentLines = @(
            $EnvInfo,
            "Duration: $durationStr [$latestRunId]"
        )

        if ($messagesText) {
            $commentLines += $messagesText
        }

        $comment = $commentLines -join "`r`n"

        $testsPayload += @{
            testKey = $testKey
            status  = $status
            comment = $comment
            start   = Convert-EpochMsToIso $data.start
            finish  = Convert-EpochMsToIso $data.stop
        }

        $runIdsUploaded.Add($latestRunId) | Out-Null
    }

    $payload = @{
        testExecutionKey = $TestExecutionKey
        tests            = $testsPayload
    } | ConvertTo-Json -Depth 6

    Write-Host "`n📤 Uploading $($testsPayload.Count) tests to Xray..."
    Write-Host $payload
    Write-Host "xray real upload commented"

    # try {
    #     Invoke-RestMethod `
    #         -Uri $XrayImportUrl `
    #         -Method Post `
    #         -Headers @{ Authorization = "Bearer $XrayToken" } `
    #         -Body $payload `
    #         -ContentType "application/json"

    #     Write-Host "✅ Xray upload successful"

    #     $UpdatedRuns = $UploadedRuns + $runIdsUploaded
    #     $UpdatedRuns | ConvertTo-Json | Set-Content $UploadedRunsFile
    #     Write-Host "✅ xrayUploadedRuns.json updated"
    # }
    # catch {
    #     Write-Host "❌ Failed to upload to Xray" -ForegroundColor Red
    #     Write-Host "Error details: $_" -ForegroundColor Red
    # }
}

function Convert-EpochMsToIso($ms) {
    return [DateTimeOffset]::FromUnixTimeMilliseconds($ms).UtcDateTime.ToString("o")
}

function Get-TestTimestamps($json) {

    # Case 1 — standard Allure result
    if ($json.time -and $json.time.start -and $json.time.stop) {
        return @{
            start = [long]$json.time.start
            stop  = [long]$json.time.stop
        }
    }

    # Case 2 — root level timestamps (test with one step)
    if ($json.start -and $json.stop) {
        return @{
            start = [long]$json.start
            stop  = [long]$json.stop
        }
    }

    throw "❌ Cannot find timestamps in Allure JSON for $($json.name)"
}


# ---------------------------------------------------------------
# START
# ---------------------------------------------------------------
Test-NodeVersion

Write-Host "🚀 Running GEN1 tests..."

Import-EnvLocal

$XrayClientId = $env:XRAY_CLIENT_ID
$XrayClientSecret = $env:XRAY_CLIENT_SECRET
$TestExecutionKey = $env:XRAY_TEST_EXECUTION_KEY
$EnvInfo = $env:XRAY_ENV_INFO
Write-Host "LANGUAGE: $env:LANGUAGE"
if ($env:LANGUAGE) {
    $EnvInfo += " - Language $env:LANGUAGE"
}
Write-Host "EnvInfo: $EnvInfo"

if ($RunId) {
    $EffectiveRunId = $RunId
    Write-Host "🆔 Using provided Run ID: $EffectiveRunId"
}
else {
    $EffectiveRunId = (Get-Date).ToString("yyyyMMdd-HHmmss")
    Write-Host "🆔 Generated Run ID: $EffectiveRunId"
}

$env:XRAY_RUN_ID = $EffectiveRunId

# File to track uploaded runs
$UploadedRunsFile = Join-Path $PSScriptRoot "xrayUploadedRuns.json"

# ---------------------------------------------------------------
# CLEAN
# ---------------------------------------------------------------
if ($Clean) {
    Write-Host "🧹 Cleaning artifacts..."
    Remove-Item $AllureResults, $AllureReport -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "✅ Removed Allure results and report"

    # Reset Xray uploaded runs tracking
    "[]" | Set-Content $UploadedRunsFile
    Write-Host "✅ Cleared xrayUploadedRuns.json"

    Write-Host "✅ Clean completed."
}

# ---------------------------------------------------------------
# VALIDATE ARCHIVE
# ---------------------------------------------------------------
if ($ValidateArchive) {
    if (Test-AllureReportValid $AllureReport) {
        Write-Host "✅ Allure report is valid"
    }
    else {
        Write-Host "❌ Invalid Allure report" -ForegroundColor Red
        exit 1
    }
    exit 0
}

# ---------------------------------------------------------------
# ARCHIVE ONLY
# ---------------------------------------------------------------
if ($ArchiveOnly) {
    Write-Host "=== ARCHIVE ONLY MODE ==="
    npx allure generate $AllureResults -o $AllureReport --clean

    if (-not (Test-AllureReportValid $AllureReport)) {
        Write-Host "❌ Invalid Allure report. Archive skipped." -ForegroundColor Red
        exit 1
    }

    $ts = Get-Date -Format "yyyy-MM-dd_HH-mm"
    $labelSafe = $Label -replace '[^\w\-]', '_'
    $archivePath = Join-Path $ArchiveRoot "$ts-$labelSafe"

    New-Item $archivePath -ItemType Directory | Out-Null
    Copy-Item $AllureReport "$archivePath\allure-report" -Recurse

    # open-report.bat (portable)
    @"
@echo off
echo ==========================================
echo   Allure Report Opener
echo ==========================================
where npx >nul 2>&1 || (
  echo Node.js / npx not found.
  pause
  exit /b 1
)
npx allure open "allure-report"
pause
"@ | Set-Content "$archivePath\open-report.bat" -Encoding ASCII

    Write-Host "✅ Archive completed: $archivePath"
    exit 0
}

# ---------------------------------------------------------------
# XRAY ONLY
# ---------------------------------------------------------------
if ($XrayOnly) {
    Write-Host "=== XRAY ONLY MODE ==="
    if (-not (Test-Path $AllureResults)) {
        Write-Host "❌ No allure-results found." -ForegroundColor Red
        exit 1
    }

    $XrayToken = Get-XrayToken -clientId $XrayClientId -clientSecret $XrayClientSecret -authUrl $XrayAuthUrl

    Invoke-AllureResultsUploadToXray `
        -AllureResultsPath $AllureResults `
        -XrayToken $XrayToken `
        -XrayImportUrl $XrayImportUrl `
        -TestExecutionKey $TestExecutionKey `
        -EnvInfo $EnvInfo `
        -UploadedRunsFile $UploadedRunsFile `
        -TargetRunId $RunId

    exit 0
}

# ---------------------------------------------------------------
# RUN TESTS?
# ---------------------------------------------------------------
$RunTests = ($Spec -or $Suite -or $Suites)

if ($RunTests) {
    Write-Host "🚧 Real test execution detected - skipping Xray upload (temporary policy)"
    $SkipXray = $true

    Test-EnvironmentVariables

    Test-AppiumAlive

    Write-Host "🔄 Resetting flow state..."
    node -e "import('./helpers/flowState.js').then(m => m.resetState())"

    Write-Host "`n=== Running WDIO Tests ==="
    $runArgs = @("wdio", "run", "wdio.conf.js")

    if ($Spec) { $runArgs += @("--spec", $Spec) }
    if ($Suite) { $runArgs += @("--suite", $Suite) }
    if ($Suites) { $runArgs += @("--suite", $Suites) }
    Write-Host ">>> Running: npx $($runArgs -join ' ')"
    npx @runArgs
}

# ---------------------------------------------------------------
# GENERATE ALLURE
# ---------------------------------------------------------------
if (Test-Path $AllureResults) {
    Write-Host "`nGenerating Allure report..."
    npx allure generate $AllureResults -o $AllureReport --clean
}

# ---------------------------------------------------------------
# ARCHIVE AFTER RUN
# ---------------------------------------------------------------
if ($Archive -and (Test-AllureReportValid $AllureReport)) {
    $ts = Get-Date -Format "yyyy-MM-dd_HH-mm"
    $labelSafe = $Label -replace '[^\w\-]', '_'
    $archivePath = Join-Path $ArchiveRoot "$ts-$labelSafe"

    New-Item $archivePath -ItemType Directory | Out-Null
    Copy-Item $AllureReport "$archivePath\allure-report" -Recurse

    @"
@echo off
npx allure open "allure-report"
pause
"@ | Set-Content "$archivePath\open-report.bat" -Encoding ASCII

    Write-Host "📦 Archived to $archivePath"
}

# ---------------------------------------------------------------
# XRAY AFTER RUN
# ---------------------------------------------------------------
if (-not $SkipXray -and (Test-Path $AllureResults)) {
    $XrayToken = Get-XrayToken -clientId $XrayClientId -clientSecret $XrayClientSecret -authUrl $XrayAuthUrl

    Invoke-AllureResultsUploadToXray `
        -AllureResultsPath $AllureResults `
        -XrayToken $XrayToken `
        -XrayImportUrl $XrayImportUrl `
        -TestExecutionKey $TestExecutionKey `
        -EnvInfo $EnvInfo `
        -UploadedRunsFile $UploadedRunsFile `
        -CurrentRunId $EffectiveRunId

}
else {
    Write-Host "⏭ Skipping Xray upload for this run"
}

Write-Host "`nAll tasks completed."
