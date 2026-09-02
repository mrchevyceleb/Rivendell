# One-time installer for the Rivendell `rivendell://` URL scheme handler on
# Windows. Run on each Windows PC Matt uses with Rivendell:
#
#   powershell -ExecutionPolicy Bypass -File .\install-rivendell-handler.ps1
#
# To remove:
#
#   powershell -ExecutionPolicy Bypass -File .\install-rivendell-handler.ps1 -Uninstall
#
# Registers `rivendell://` under HKCU (no admin / UAC needed) and writes a
# sibling handler script. `rivendell://open?winpath=...` opens workspace files
# in their native apps; `rivendell://open?url=...` opens agent web links through
# Windows' default browser association.

[CmdletBinding()]
param(
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

$installDir   = Join-Path $env:LocalAppData 'Rivendell'
$handlerPath  = Join-Path $installDir 'rivendell-open.ps1'
$schemeKey    = 'HKCU:\Software\Classes\rivendell'
$commandKey   = "$schemeKey\shell\open\command"

if ($Uninstall) {
    if (Test-Path $schemeKey)  { Remove-Item -Path $schemeKey -Recurse -Force }
    if (Test-Path $installDir) { Remove-Item -Path $installDir -Recurse -Force }
    Write-Host "Rivendell native-open handler uninstalled." -ForegroundColor Green
    return
}

if (-not (Test-Path $installDir)) {
    New-Item -ItemType Directory -Path $installDir | Out-Null
}

# Handler script — receives the full `rivendell://open?...` URI as its only
# argument and turns it into a Start-Process call. Path safety is enforced
# here (not in the browser) because anyone on the tailnet could craft a
# malicious URI: web targets must be HTTP(S), and file targets must remain
# under the user's ASSISTANT-HUB.
$handlerSource = @'
[CmdletBinding()]
param([string]$Uri)

$ErrorActionPreference = 'Stop'

if (-not $Uri) { return }

Add-Type -AssemblyName System.Web | Out-Null

# Some launchers append a trailing slash to scheme URIs.
$Uri = $Uri.TrimEnd('/')

if (-not $Uri.StartsWith('rivendell://open', [StringComparison]::OrdinalIgnoreCase)) {
    Write-Error "Unsupported rivendell URI: $Uri"
    exit 1
}

$queryStart = $Uri.IndexOf('?')
if ($queryStart -lt 0) {
    Write-Error "rivendell URI has no parameters"
    exit 1
}
$queryString = $Uri.Substring($queryStart + 1).TrimEnd('/')

$pairs = @{}
foreach ($segment in $queryString.Split('&')) {
    if (-not $segment) { continue }
    $idx = $segment.IndexOf('=')
    if ($idx -lt 0) { continue }
    $key   = [System.Web.HttpUtility]::UrlDecode($segment.Substring(0, $idx))
    $value = [System.Web.HttpUtility]::UrlDecode($segment.Substring($idx + 1))
    $pairs[$key] = $value
}

if ($pairs.ContainsKey('url')) {
    $target = $pairs['url']
    [Uri]$parsedTarget = $null
    $validTarget = [Uri]::TryCreate($target, [UriKind]::Absolute, [ref]$parsedTarget)
    if (-not $validTarget -or @('http', 'https') -notcontains $parsedTarget.Scheme.ToLowerInvariant()) {
        Write-Error "rivendell url= parameter must be an absolute HTTP(S) URL"
        exit 1
    }
    Start-Process -FilePath $parsedTarget.AbsoluteUri
    return
}

if (-not $pairs.ContainsKey('winpath')) {
    Write-Error "rivendell URI missing winpath= parameter"
    exit 1
}

$winPath = $pairs['winpath']

$allowedRoot = Join-Path $env:UserProfile 'OneDrive\Documents\ASSISTANT-HUB'
$allowedRootResolved = $null
if (Test-Path -LiteralPath $allowedRoot) {
    $allowedRootResolved = (Resolve-Path -LiteralPath $allowedRoot).ProviderPath
}
if (-not $allowedRootResolved) {
    Write-Error "ASSISTANT-HUB not found at $allowedRoot. Is OneDrive set up?"
    exit 1
}

try {
    $resolved = (Resolve-Path -LiteralPath $winPath -ErrorAction Stop).ProviderPath
} catch {
    Write-Error "Path does not exist: $winPath"
    exit 1
}

# Path-prefix whitelist. Compare with a trailing separator so a sibling folder
# whose name starts with the root cannot sneak through.
$rootWithSep = $allowedRootResolved.TrimEnd('\') + '\'
if (
    $resolved -ne $allowedRootResolved -and
    -not $resolved.StartsWith($rootWithSep, [StringComparison]::OrdinalIgnoreCase)
) {
    Write-Error "Refused path outside ASSISTANT-HUB: $resolved"
    exit 1
}

if (Test-Path -LiteralPath $resolved -PathType Container) {
    Start-Process -FilePath 'explorer.exe' -ArgumentList "`"$resolved`""
} else {
    Start-Process -FilePath $resolved
}
'@

Set-Content -LiteralPath $handlerPath -Value $handlerSource -Encoding UTF8

# Register the URL scheme under HKCU.
if (-not (Test-Path $schemeKey)) {
    New-Item -Path $schemeKey -Force | Out-Null
}
Set-ItemProperty -Path $schemeKey -Name '(Default)'    -Value 'URL:Rivendell Native Open'
Set-ItemProperty -Path $schemeKey -Name 'URL Protocol' -Value ''

if (-not (Test-Path $commandKey)) {
    New-Item -Path $commandKey -Force | Out-Null
}

# %1 is substituted by the OS with the full rivendell:// URL when a browser
# fires a link. -WindowStyle Hidden keeps a console flash from appearing.
$commandLine = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$handlerPath`" `"%1`""
Set-ItemProperty -Path $commandKey -Name '(Default)' -Value $commandLine

Add-Type -AssemblyName System.Web | Out-Null
$testTarget = Join-Path $env:UserProfile 'OneDrive\Documents\ASSISTANT-HUB'
$testUri    = "rivendell://open?kind=folder&winpath=$([System.Web.HttpUtility]::UrlEncode($testTarget))"

Write-Host ""
Write-Host "Rivendell native-open handler installed." -ForegroundColor Green
Write-Host "  Handler: $handlerPath"
Write-Host ""
Write-Host "Test from a browser address bar:"
Write-Host "  $testUri"
Write-Host ""
Write-Host "If File Explorer opens to ASSISTANT-HUB, you're done. Future workspace"
Write-Host "links open in native apps and agent web links use your default browser."
