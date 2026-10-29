$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$setup = Join-Path ([IO.Path]::GetTempPath()) 'Focus-Diff-Setup.exe'
Write-Host 'Downloading Focus Diff...'
Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/hyanmandian/focus-diff/releases/download/desktop-latest/Focus-Diff-Setup.exe' -OutFile $setup

Write-Host 'Installing...'
$install = Start-Process -FilePath $setup -ArgumentList '/S' -Wait -PassThru
Remove-Item $setup -ErrorAction SilentlyContinue
if ($install.ExitCode -ne 0) { throw "The installer stopped with code $($install.ExitCode)." }

$app = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA 'Focus Diff') -Filter '*.exe' |
  Where-Object { $_.Name -notlike 'uninstall*' } | Select-Object -First 1
if (-not $app) { throw 'Focus Diff was installed, but its app was not found.' }

Write-Host "Installed in $($app.DirectoryName). Opening it..."
Start-Process -FilePath $app.FullName
