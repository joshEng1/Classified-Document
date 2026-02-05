[CmdletBinding()]
param(
  [switch]$Minify = $true
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$inputCss = Join-Path $repoRoot "public\\tailwind.input.css"
$outputCss = Join-Path $repoRoot "public\\tailwind.css"

if (!(Test-Path $inputCss)) {
  throw "Missing input file: $inputCss"
}

Write-Host "Building Tailwind..."
Write-Host "  input:  $inputCss"
Write-Host "  output: $outputCss"

$args = @("tailwindcss", "-i", $inputCss, "-o", $outputCss)
if ($Minify) { $args += "--minify" }

# Uses npx. If tailwindcss isn't installed, run:
#   npm install -D tailwindcss
# in a directory with a package.json, or install globally.
npx @args

Write-Host "Done."

