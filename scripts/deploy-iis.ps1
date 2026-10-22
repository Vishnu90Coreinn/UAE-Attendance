<#
.SYNOPSIS
  Copies a release folder (from publish-iis.ps1) over the live IIS site with a short app_offline window,
  then checks /api/health. Run on the IIS server (the CI deploy job does this on a self-hosted runner).

.EXAMPLE
  ./scripts/deploy-iis.ps1 -Source D:\release -SitePath C:\inetpub\hr-payroll
#>
param(
  [Parameter(Mandatory)][string]$Source,
  [Parameter(Mandatory)][string]$SitePath,
  [string]$HealthUrl = 'http://localhost/api/health'
)

$ErrorActionPreference = 'Stop'
$Source = (Resolve-Path $Source).Path
if (-not (Test-Path (Join-Path $Source 'web.config'))) { throw "$Source is not a release folder (no web.config)." }
New-Item -ItemType Directory -Force $SitePath | Out-Null
$offline = Join-Path $SitePath 'app_offline.htm'

# IIS stops the app and releases its files while app_offline.htm exists.
Set-Content $offline '<html><body><h1>Updating, back in a minute.</h1></body></html>'
Start-Sleep -Seconds 3
try {
  # Mirror the release but keep the server's own logs, the offline marker and its production settings file.
  robocopy $Source $SitePath /MIR /XD logs /XF app_offline.htm appsettings.Production.json /R:3 /W:5 /NFL /NDL /NJH /NJS /NP
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed (exit code $LASTEXITCODE)" }
}
finally {
  Remove-Item $offline -Force -ErrorAction SilentlyContinue
}

Write-Host "Waiting for $HealthUrl" -ForegroundColor Cyan
for ($i = 1; $i -le 20; $i++) {
  try {
    $r = Invoke-WebRequest $HealthUrl -UseBasicParsing -TimeoutSec 10
    if ($r.StatusCode -eq 200 -and $r.Content -match '"database":"ok"') {
      Write-Host "Healthy: $($r.Content)" -ForegroundColor Green
      exit 0
    }
  } catch { }
  Start-Sleep -Seconds 3
}
throw "Health check failed after deploy: $HealthUrl"
