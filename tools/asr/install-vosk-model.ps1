param(
    [string]$ModelName = "vosk-model-small-cn-0.22",
    [string]$Url = "https://alphacephei.com/vosk/models/vosk-model-small-cn-0.22.zip",
    [long]$ExpectedBytes = 43898754
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

if ((Test-Path -LiteralPath $zipPath) -and $ExpectedBytes -gt 0) {
    $currentBytes = (Get-Item -LiteralPath $zipPath).Length
    if ($currentBytes -gt $ExpectedBytes) {
        Write-Host "Removing oversized partial download: $zipPath ($currentBytes bytes)"
        Remove-Item -LiteralPath $zipPath -Force
    }
}

Write-Host "Downloading Vosk model: $Url"
$attempt = 0
while ($true) {
    $attempt += 1
    if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
        $curlArgs = @("-L", "--retry", "10", "--fail")
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

    $downloadedBytes = (Get-Item -LiteralPath $zipPath).Length
    if ($ExpectedBytes -le 0 -or $downloadedBytes -eq $ExpectedBytes) {
        break
    }
    if ($downloadedBytes -gt $ExpectedBytes) {
        Write-Host "Partial zip is larger than expected; deleting corrupt download."
        Remove-Item -LiteralPath $zipPath -Force
    } elseif ($attempt -ge 30) {
        throw "Vosk model download is incomplete after $attempt attempts: $downloadedBytes / $ExpectedBytes bytes"
    } else {
        Write-Host "Partial download: $downloadedBytes / $ExpectedBytes bytes. Resuming..."
        Start-Sleep -Seconds 2
    }
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
