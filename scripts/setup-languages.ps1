# Always run from the script's own directory
Set-Location -Path $PSScriptRoot

# Fail on error
$ErrorActionPreference = "Stop"

$requiredPaths = @(
    "strings_en_US.json",
    "strings_en_150.json",
    "strings_de_DE.json",
    "video_en_US",
    "video_en_150",
    "video_de"
)

foreach ($path in $requiredPaths) {
    if (-not (Test-Path $path)) {
        throw "❌ Required file or folder missing: $path"
    }
}

Write-Host "📱 Creating /data/testmock and initializing to 0.."

adb shell "echo 0 > /data/testmock"

Write-Host "📱 Preparing device directories..."

adb shell "mkdir -p /data/NEURODERM/LANGUAGES/TEXT/en_US"
adb shell "mkdir -p /data/NEURODERM/LANGUAGES/TEXT/en_150"
adb shell "mkdir -p /data/NEURODERM/LANGUAGES/TEXT/de_DE"

adb shell "mkdir -p /data/NEURODERM/LANGUAGES/VIDEO/en_US"
adb shell "mkdir -p /data/NEURODERM/LANGUAGES/VIDEO/en_150"
adb shell "mkdir -p /data/NEURODERM/LANGUAGES/VIDEO/de_DE"

Write-Host "📄 Pushing language JSON files..."

adb push strings_en_US.json /data/NEURODERM/LANGUAGES/TEXT/en_US/
adb push strings_en_150.json /data/NEURODERM/LANGUAGES/TEXT/en_150/
adb push strings_de_DE.json /data/NEURODERM/LANGUAGES/TEXT/de_DE/

Write-Host "🎥 Pushing EN_US videos..."

adb push video_en_US/en_US_Cleaning_infusion_sites.mp4       /data/NEURODERM/LANGUAGES/VIDEO/en_US/
adb push video_en_US/en_US_Identifying_infusion_sites.mp4    /data/NEURODERM/LANGUAGES/VIDEO/en_US/
adb push video_en_US/en_US_Inserting_cannulas.mp4            /data/NEURODERM/LANGUAGES/VIDEO/en_US/
adb push video_en_US/en_US_Pausing_treatment.mp4             /data/NEURODERM/LANGUAGES/VIDEO/en_US/
adb push video_en_US/en_US_Resuming_treatment.mp4            /data/NEURODERM/LANGUAGES/VIDEO/en_US/
adb push video_en_US/en_US_Verifying_treatment_status.mp4    /data/NEURODERM/LANGUAGES/VIDEO/en_US/

Write-Host "🎥 Pushing EN_150 videos..."

adb push video_en_150/en_150_Cleaning_infusion_sites.mp4       /data/NEURODERM/LANGUAGES/VIDEO/en_150/
adb push video_en_150/en_150_Identifying_infusion_sites.mp4    /data/NEURODERM/LANGUAGES/VIDEO/en_150/
adb push video_en_150/en_150_Inserting_cannulas.mp4            /data/NEURODERM/LANGUAGES/VIDEO/en_150/
adb push video_en_150/en_150_Pausing_treatment.mp4             /data/NEURODERM/LANGUAGES/VIDEO/en_150/
adb push video_en_150/en_150_Resuming_treatment.mp4            /data/NEURODERM/LANGUAGES/VIDEO/en_150/
adb push video_en_150/en_150_Verifying_treatment_status.mp4    /data/NEURODERM/LANGUAGES/VIDEO/en_150/

Write-Host "🎥 Pushing DE videos..."

adb push video_de/de_DE_Cleaning_infusion_sites.mp4       /data/NEURODERM/LANGUAGES/VIDEO/de_DE/
adb push video_de/de_DE_Identifying_infusion_sites.mp4    /data/NEURODERM/LANGUAGES/VIDEO/de_DE/
adb push video_de/de_DE_Inserting_cannulas.mp4            /data/NEURODERM/LANGUAGES/VIDEO/de_DE/
adb push video_de/de_DE_Pausing_treatment.mp4             /data/NEURODERM/LANGUAGES/VIDEO/de_DE/
adb push video_de/de_DE_Resuming_treatment.mp4            /data/NEURODERM/LANGUAGES/VIDEO/de_DE/
adb push video_de/de_DE_Verifying_treatment_status.mp4    /data/NEURODERM/LANGUAGES/VIDEO/de_DE/

Write-Host "🔁 Running daemon + reboot..."

adb shell "server_daemon_monitor_language_create"
adb shell "reboot"

Write-Host "✅ Done"
