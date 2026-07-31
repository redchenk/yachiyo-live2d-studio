$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent (Split-Path -Parent $scriptDir)
$source = Join-Path $scriptDir 'Live2DStudioLauncher.cs'
$output = Join-Path $repoRoot 'Start-Live2D-Studio.exe'
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'

if (-not (Test-Path $csc)) {
    throw "C# compiler not found: $csc"
}

$dependencyRoots = @(
    $repoRoot,
    (Join-Path $scriptDir 'deps'),
    'C:\Program Files\SakuraFrpLauncher',
    'C:\Program Files\Microsoft OfficePLUS\3.16.0.46159\addin',
    'C:\Program Files (x86)\Microsoft Office\root\Office16\ADDINS\Microsoft Power Query for Excel Integrated\bin'
) | Where-Object { Test-Path $_ }

function Get-PeMachine {
    param(
        [Parameter(Mandatory = $true)][string]$Path
    )

    $bytes = [System.IO.File]::ReadAllBytes($Path)
    $peOffset = [BitConverter]::ToInt32($bytes, 0x3c)
    $machine = [BitConverter]::ToUInt16($bytes, $peOffset + 4)
    switch ($machine) {
        0x8664 { return 'x64' }
        0x14c { return 'x86' }
        0xaa64 { return 'arm64' }
        default { return ('0x{0:x}' -f $machine) }
    }
}

function Find-DependencyFile {
    param(
        [Parameter(Mandatory = $true)][string]$FileName,
        [string]$ExpectedMachine = ''
    )

    foreach ($root in $dependencyRoots) {
        $direct = Join-Path $root $FileName
        if (Test-Path $direct) {
            if (-not $ExpectedMachine -or (Get-PeMachine $direct) -eq $ExpectedMachine) {
                return $direct
            }
        }
        foreach ($candidate in @(Get-ChildItem -Path $root -Recurse -Filter $FileName -ErrorAction SilentlyContinue)) {
            if (-not $ExpectedMachine -or (Get-PeMachine $candidate.FullName) -eq $ExpectedMachine) {
                return $candidate.FullName
            }
        }
    }

    $machineText = if ($ExpectedMachine) { " ($ExpectedMachine)" } else { '' }
    throw "Missing WebView2 dependency: $FileName$machineText"
}

$webViewCore = Find-DependencyFile 'Microsoft.Web.WebView2.Core.dll'
$webViewWinForms = Find-DependencyFile 'Microsoft.Web.WebView2.WinForms.dll'
$webViewLoader = Find-DependencyFile 'WebView2Loader.dll' 'x64'
$icon = Join-Path $repoRoot 'favicon.ico'

$arguments = @(
    '/nologo',
    '/target:winexe',
    '/platform:x64',
    "/out:$output",
    '/reference:System.Windows.Forms.dll',
    '/reference:System.Drawing.dll',
    '/reference:System.Security.dll',
    '/reference:System.Web.Extensions.dll',
    "/reference:$webViewCore",
    "/reference:$webViewWinForms"
)

if (Test-Path $icon) {
    $arguments += "/win32icon:$icon"
}

$arguments += $source

& $csc @arguments
if ($LASTEXITCODE -ne 0) {
    throw "C# compiler failed with exit code $LASTEXITCODE."
}

function Copy-Dependency {
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Destination
    )

    if ([System.IO.Path]::GetFullPath($Source) -ieq [System.IO.Path]::GetFullPath($Destination)) {
        return
    }

    Copy-Item -LiteralPath $Source -Destination $Destination -Force
}

Copy-Dependency $webViewCore (Join-Path $repoRoot 'Microsoft.Web.WebView2.Core.dll')
Copy-Dependency $webViewWinForms (Join-Path $repoRoot 'Microsoft.Web.WebView2.WinForms.dll')
Copy-Dependency $webViewLoader (Join-Path $repoRoot 'WebView2Loader.dll')

$memoryRuntimeProbe = Join-Path $repoRoot 'tools\memory\check-memory-runtime.mjs'
$nodeDirectories = @(
    (Join-Path $repoRoot 'tools\node-v22.11.0-win-x64'),
    (Join-Path (Split-Path -Parent $repoRoot) 'tools\node-v22.11.0-win-x64'),
    (Join-Path (Split-Path -Parent $repoRoot) '.codex_tmp\node-v20.19.0-win-x64'),
    (Join-Path (Split-Path -Parent $repoRoot) '.codex_tmp\node-v22.11.0-win-x64')
)
$nodeDirectories += (($env:PATH -split [IO.Path]::PathSeparator) | ForEach-Object { $_.Trim('"') })
$compatibleMemoryNode = $null
foreach ($nodeDirectory in @($nodeDirectories | Where-Object { $_ } | Select-Object -Unique)) {
    $nodeCandidate = Join-Path $nodeDirectory 'node.exe'
    if (-not (Test-Path -LiteralPath $nodeCandidate)) { continue }
    $probeErrorPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & $nodeCandidate $memoryRuntimeProbe 2>$null | Out-Null
    $probeExitCode = $LASTEXITCODE
    $ErrorActionPreference = $probeErrorPreference
    if ($probeExitCode -eq 0) {
        $compatibleMemoryNode = $nodeCandidate
        break
    }
}
if (-not $compatibleMemoryNode) {
    throw 'No Node.js runtime can load better-sqlite3. Run npm install with the Node.js version that will launch the memory sidecar.'
}

Write-Host "Built $output (memory runtime: $compatibleMemoryNode)"
