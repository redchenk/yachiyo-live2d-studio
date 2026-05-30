param(
    [string]$ModelName = "vosk-model-small-cn-0.22",
    [string]$Url = "https://alphacephei.com/vosk/models/vosk-model-small-cn-0.22.zip"
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..\..")
$modelsDir = Join-Path $repoRoot "models\vosk"
$targetDir = Join-Path $modelsDir $ModelName
$zipPath = Join-Path $modelsDir "$ModelName.zip"

New-Item -ItemType Directory -Force -Path $modelsDir | Out-Null

if (Test-Path -LiteralPath $targetDir) {
    Write-Host "Vosk model already installed: $targetDir"
    exit 0
}

Write-Host "Downloading Vosk model: $Url"
if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
    $curlArgs = @("-L", "--retry", "3", "--fail")
    if (Test-Path -LiteralPath $zipPath) {
        $curlArgs += @("-C", "-")
    }
    $curlArgs += @("-o", $zipPath, $Url)
    & curl.exe @curlArgs
} else {
    Invoke-WebRequest -Uri $Url -OutFile $zipPath
}

if (!(Test-Path -LiteralPath $zipPath)) {
    throw "Vosk model download did not create $zipPath"
}

Write-Host "Extracting Vosk model to: $modelsDir"
Expand-Archive -LiteralPath $zipPath -DestinationPath $modelsDir -Force

if (!(Test-Path -LiteralPath $targetDir)) {
    throw "Expected Vosk model directory was not found after extraction: $targetDir"
}

Remove-Item -LiteralPath $zipPath -Force
Write-Host "Vosk model installed: $targetDir"
