param([string]$Python = '', [int]$Port = 8765)
$comparisonRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$siteRoot = Join-Path $comparisonRoot '02_대상사이트\email_page-bug-page'
$workspaceRoot = [IO.Path]::GetFullPath((Join-Path $comparisonRoot '..\..\..\..'))
if (-not $Python) { $Python = Join-Path $workspaceRoot 'WebTestPilot\.venv\Scripts\python.exe' }
if (-not (Test-Path -LiteralPath $Python)) { throw 'Specify a Python environment with backend requirements installed using -Python.' }
if (-not (Test-Path -LiteralPath (Join-Path $siteRoot 'backend\app.py'))) { throw 'The supplied site folder 02_대상사이트/email_page-bug-page is required.' }
if ($Port -lt 1024 -or $Port -gt 65535) { throw 'Choose a local port between 1024 and 65535.' }
$manualDir = Join-Path $PSScriptRoot 'manual'
New-Item -ItemType Directory -Force -Path $manualDir | Out-Null
$database = (Join-Path $manualDir 'review.db').Replace('\','/')
$values = @{ APP_ENV='test'; DATABASE_URL=('sqlite:///' + $database); AUTH_ORIGINS=('http://127.0.0.1:'+$Port); AUTH_AUTO_MIGRATE='true'; AUTH_COOKIE_SECURE='false'; AUTH_DEV_ADMIN='false' }
$previous = @{}
foreach ($name in $values.Keys) { $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process'); [Environment]::SetEnvironmentVariable($name, $values[$name], 'Process') }
Write-Host ('Open http://127.0.0.1:'+$Port+'/signin.html')
Write-Host 'Local test credentials: test / testtesttest, admin / adminadminadmin'
Write-Host ('Isolated manual DB: '+$database)
Write-Host 'Press Ctrl+C to stop. Existing application databases are not used.'
Push-Location -LiteralPath $siteRoot
try { & $Python -m uvicorn backend.app:app --host 127.0.0.1 --port $Port --no-access-log }
finally {
    Pop-Location
    foreach ($name in $values.Keys) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
}
