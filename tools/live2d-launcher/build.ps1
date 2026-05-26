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

function Find-DependencyFile {
    param(
        [Parameter(Mandatory = $true)][string]$FileName
    )

    foreach ($root in $dependencyRoots) {
        $direct = Join-Path $root $FileName
        if (Test-Path $direct) {
            return $direct
        }
        $found = Get-ChildItem -Path $root -Recurse -Filter $FileName -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($found) {
            return $found.FullName
        }
    }

    throw "Missing WebView2 dependency: $FileName"
}

$webViewCore = Find-DependencyFile 'Microsoft.Web.WebView2.Core.dll'
$webViewWinForms = Find-DependencyFile 'Microsoft.Web.WebView2.WinForms.dll'
$webViewLoader = Find-DependencyFile 'WebView2Loader.dll'
$icon = Join-Path $repoRoot 'favicon.ico'

$arguments = @(
    '/nologo',
    '/target:winexe',
    '/platform:x64',
    "/out:$output",
    '/reference:System.Windows.Forms.dll',
    '/reference:System.Drawing.dll',
    '/reference:System.Web.Extensions.dll',
    "/reference:$webViewCore",
    "/reference:$webViewWinForms"
)

if (Test-Path $icon) {
    $arguments += "/win32icon:$icon"
}

$arguments += $source

& $csc @arguments

Copy-Item -LiteralPath $webViewCore -Destination (Join-Path $repoRoot 'Microsoft.Web.WebView2.Core.dll') -Force
Copy-Item -LiteralPath $webViewWinForms -Destination (Join-Path $repoRoot 'Microsoft.Web.WebView2.WinForms.dll') -Force
Copy-Item -LiteralPath $webViewLoader -Destination (Join-Path $repoRoot 'WebView2Loader.dll') -Force

Write-Host "Built $output"
