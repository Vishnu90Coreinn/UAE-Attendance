<#
.SYNOPSIS
  Creates the VAPID key pair that phone notifications are signed with. Run once, on any machine.
.DESCRIPTION
  Prints three settings. Put them on the server (IIS site environment variables, or appsettings.Production.json under
  "Push") and restart the site. Keep the private key secret and do not commit it; keep using the SAME pair afterwards,
  because phones that turned notifications on are tied to the public key.
.EXAMPLE
  ./scripts/new-vapid-keys.ps1 -Subject mailto:it@yourcompany.com
#>
param([Parameter(Mandatory)][string]$Subject)

function ConvertTo-Base64Url([byte[]]$Bytes) { [Convert]::ToBase64String($Bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_') }

# CNG works on Windows PowerShell 5.1 and PowerShell 7: export the P-256 key blob (8-byte header, then X, Y, D of 32 bytes each).
$options = New-Object System.Security.Cryptography.CngKeyCreationParameters
$options.ExportPolicy = [System.Security.Cryptography.CngExportPolicies]::AllowPlaintextExport
$key = [System.Security.Cryptography.CngKey]::Create([System.Security.Cryptography.CngAlgorithm]::ECDsaP256, $null, $options)
$blob = $key.Export([System.Security.Cryptography.CngKeyBlobFormat]::EccPrivateBlob)
$x = $blob[8..39]; $y = $blob[40..71]; $d = $blob[72..103]
$public = [byte[]](@(4) + $x + $y)   # uncompressed P-256 point, 65 bytes

"Push__PublicKey=$(ConvertTo-Base64Url $public)"
"Push__PrivateKey=$(ConvertTo-Base64Url ([byte[]]$d))"
"Push__Subject=$Subject"
