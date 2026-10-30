$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$repo = 'hyanmandian/focus-diff'
$base = "https://github.com/$repo/releases/download/desktop-latest"
$setup = Join-Path ([IO.Path]::GetTempPath()) 'Focus-Diff-Setup.exe'
$sums = Join-Path ([IO.Path]::GetTempPath()) 'Focus-Diff-SHA256SUMS'

Write-Host 'Downloading Focus Diff...'
Invoke-WebRequest -UseBasicParsing -Uri "$base/Focus-Diff-Setup.exe" -OutFile $setup
try {
  Invoke-WebRequest -UseBasicParsing -Uri "$base/SHA256SUMS" -OutFile $sums
} catch {
  Remove-Item $setup -ErrorAction SilentlyContinue
  throw "Couldn't download SHA256SUMS to check the download. Nothing was installed. Try again in a minute."
}

$entry = Get-Content $sums | ForEach-Object { , ($_ -split '\s+\*?', 2) } |
  Where-Object { $_[1] -eq 'Focus-Diff-Setup.exe' } | Select-Object -First 1
Remove-Item $sums -ErrorAction SilentlyContinue
$actual = (Get-FileHash -Algorithm SHA256 -Path $setup).Hash
if (-not $entry -or $actual -ne $entry[0]) {
  Remove-Item $setup -ErrorAction SilentlyContinue
  throw "Focus-Diff-Setup.exe doesn't match its SHA256SUMS entry. Nothing was installed."
}

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  Write-Host "Notice: the GitHub CLI (gh) isn't installed, so the build provenance wasn't checked. The checksum was."
} else {
  $ErrorActionPreference = 'Continue'
  & gh auth status *> $null
  $signedIn = $LASTEXITCODE -eq 0
  $global:LASTEXITCODE = 0
  $ErrorActionPreference = 'Stop'
  if (-not $signedIn) {
    Write-Host "Notice: the GitHub CLI (gh) isn't signed in, so the build provenance wasn't checked. The checksum was."
  } else {
    & gh attestation verify $setup --repo $repo > $null
    if ($LASTEXITCODE -ne 0) {
      Remove-Item $setup -ErrorAction SilentlyContinue
      throw "The download's build provenance doesn't check out. Nothing was installed."
    }
    Write-Host 'Checked the build provenance with the GitHub CLI.'
  }
}

Write-Host 'Installing...'
$install = Start-Process -FilePath $setup -ArgumentList '/S' -Wait -PassThru
Remove-Item $setup -ErrorAction SilentlyContinue
if ($install.ExitCode -ne 0) { throw "The installer stopped with code $($install.ExitCode)." }

$app = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA 'Focus Diff') -Filter '*.exe' |
  Where-Object { $_.Name -notlike 'uninstall*' } | Select-Object -First 1
if (-not $app) { throw 'Focus Diff was installed, but its app was not found.' }

Write-Host "Installed in $($app.DirectoryName). Opening it..."
Start-Process -FilePath $app.FullName
