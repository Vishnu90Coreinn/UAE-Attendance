<#
.SYNOPSIS
  Builds the web app and the API and assembles one folder to copy to the IIS server.

.EXAMPLE
  ./scripts/publish-iis.ps1                      # writes artifacts/iis
  ./scripts/publish-iis.ps1 -Output D:\release   # writes elsewhere
#>
param(
  [string]$Output = (Join-Path $PSScriptRoot '..\artifacts\iis'),
  # Reuse the installed node_modules (for a local run while the dev server is open). CI always installs.
  [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$Output = [System.IO.Path]::GetFullPath($Output)

function Invoke-Step([string]$Name, [scriptblock]$Command) {
  Write-Host "==> $Name" -ForegroundColor Cyan
  & $Command
  if ($LASTEXITCODE -ne 0) { throw "$Name failed (exit code $LASTEXITCODE)" }
}

if (Test-Path $Output) { Remove-Item $Output -Recurse -Force }

if (-not $SkipInstall) {
  Invoke-Step 'Install web dependencies' { npm --prefix "$root/apps/web" ci }
}
Invoke-Step 'Build web app' { npm --prefix "$root/apps/web" run build }
Invoke-Step 'Publish API' { dotnet publish "$root/apps/api" -c Release -o $Output --nologo }

# The API serves the web app from wwwroot, so one IIS site hosts both.
$web = Join-Path $Output 'wwwroot'
New-Item -ItemType Directory -Force $web | Out-Null
Copy-Item "$root/apps/web/dist/*" $web -Recurse -Force

# Never ship development settings or secrets.
Get-ChildItem $Output -Filter 'appsettings.Development.json' | Remove-Item -Force

Write-Host "Done. Copy the contents of $Output to the server (see docs/DEPLOY.md)." -ForegroundColor Green
