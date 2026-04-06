Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$poolerPath = Join-Path $repoRoot "supabase/.temp/pooler-url"

if (-not (Test-Path -LiteralPath $poolerPath)) {
  throw "Linked Supabase pooler URL is missing at $poolerPath. Link the project before running db:types."
}

$password = "$env:SUPABASE_DB_PASSWORD".Trim()
if (-not $password) {
  throw "SUPABASE_DB_PASSWORD is required to generate linked Supabase types."
}

$poolerUrl = (Get-Content -LiteralPath $poolerPath -Raw).Trim()
$builder = [System.UriBuilder]$poolerUrl
$builder.Password = $password

$query = "$($builder.Query)".TrimStart("?")
if ($query -notmatch "(^|&)sslmode=") {
  if ([string]::IsNullOrWhiteSpace($query)) {
    $builder.Query = "sslmode=require"
  } else {
    $builder.Query = "$query&sslmode=require"
  }
}

$dbUrl = $builder.Uri.AbsoluteUri

Push-Location $repoRoot
try {
  supabase db push --dry-run --linked
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }

  supabase gen types typescript --db-url $dbUrl --schema public | node scripts/generate-supabase-types.cjs --linked --stdin
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
} finally {
  Pop-Location
}
