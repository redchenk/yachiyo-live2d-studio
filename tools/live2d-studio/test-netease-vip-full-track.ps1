param(
    [Parameter(Mandatory = $true)][string]$LauncherPath
)

$ErrorActionPreference = 'Stop'
$assembly = [Reflection.Assembly]::LoadFrom((Resolve-Path -LiteralPath $LauncherPath))
$type = $assembly.GetType('DesktopApiProxy', $true)
$flags = [Reflection.BindingFlags]::Static -bor [Reflection.BindingFlags]::NonPublic
$normalize = $type.GetMethod('NormalizeNeteaseCookie', $flags)
$isTrial = $type.GetMethod('IsNeteaseMusicTrialDetail', $flags)
$isTruncated = $type.GetMethod('IsNeteaseMusicTruncatedDetail', $flags)
if ($null -eq $normalize -or $null -eq $isTrial -or $null -eq $isTruncated) {
    throw 'NetEase VIP helpers are missing.'
}

$rawCookie = 'MUSIC_R_T=stale;Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; MUSIC_U=vip-token;Path=/;HttpOnly; __csrf=csrf-token; SameSite=Lax; MUSIC_R_T=fresh'
$normalized = [string]$normalize.Invoke($null, [object[]]@($rawCookie))

$preview = [System.Collections.Generic.Dictionary[string,object]]::new()
$preview['url'] = 'https://example.invalid/preview.mp3'
$preview['fee'] = 1
$preview['payed'] = 0
$trialInfo = [System.Collections.Generic.Dictionary[string,object]]::new()
$trialInfo['start'] = 1
$trialInfo['end'] = 21
$preview['freeTrialInfo'] = $trialInfo

$full = [System.Collections.Generic.Dictionary[string,object]]::new()
$full['url'] = 'https://example.invalid/full.mp3'
$full['fee'] = 1
$full['payed'] = 1
$full['freeTrialInfo'] = $null

$shortStream = [System.Collections.Generic.Dictionary[string,object]]::new()
$shortStream['size'] = 321036
$shortStream['br'] = 128018
$fullStream = [System.Collections.Generic.Dictionary[string,object]]::new()
$fullStream['size'] = 9855521
$fullStream['br'] = 320000

[ordered]@{
    normalized = $normalized
    previewRejected = [bool]$isTrial.Invoke($null, [object[]]@($preview))
    fullRejected = [bool]$isTrial.Invoke($null, [object[]]@($full))
    shortStreamRejected = [bool]$isTruncated.Invoke($null, [object[]]@($shortStream, 246333))
    fullStreamRejected = [bool]$isTruncated.Invoke($null, [object[]]@($fullStream, 246333))
} | ConvertTo-Json -Compress
