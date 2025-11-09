#!/usr/bin/env pwsh
# Comprehensive Document Classification Test Script
# Tests all sample documents and displays results

param(
    [switch]$Detailed,
    [switch]$ShowLogs
)

$testFiles = @(
    @{
        Name     = "TC1: Public Marketing Document"
        Path     = "HitachiDS_Datathon_Challenges_Package\TC1_Sample_Public_Marketing_Document.pdf"
        Expected = "Public Marketing Document"
    },
    @{
        Name     = "TC2: Employee Application"
        Path     = "HitachiDS_Datathon_Challenges_Package\TC2_Filled_In_Employement_Application.pdf"
        Expected = "Employee Application"
    },
    @{
        Name     = "TC3: Internal Memo"
        Path     = "HitachiDS_Datathon_Challenges_Package\TC3_Sample_Internal_Memo.pdf"
        Expected = "Internal Memo"
    }
)

# Additional test cases (optional files)
$testFiles += @{
    Name     = "TC4: Stealth Fighter Image"
    Path     = "HitachiDS_Datathon_Challenges_Package\TC4_Stealth_Fighter_Image.pdf"
    Expected = "Other"
}
$testFiles += @{
    Name     = "TC5: Non-Compliance Mixed"
    Path     = "HitachiDS_Datathon_Challenges_Package\TC5_Testing_Multiple_Non_Compliance_Categorization.docx"
    Expected = "Other"
}

Write-Host "`n╔════════════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║        Document Classification System - Test Suite                ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════════════════════════════════╝`n" -ForegroundColor Cyan

# Check if services are running
Write-Host "🔍 Checking system status..." -ForegroundColor Yellow
try {
    $gpuHealth = Invoke-WebRequest -Uri "http://localhost:8080/health" -UseBasicParsing -ErrorAction Stop
    Write-Host "  ✅ GPU Server (port 8080): Running" -ForegroundColor Green
}
catch {
    Write-Host "  ❌ GPU Server (port 8080): Not responding" -ForegroundColor Red
    Write-Host "     Run: .\start-gpu-server.ps1" -ForegroundColor Yellow
    exit 1
}

try {
    $serverHealth = Invoke-WebRequest -Uri "http://localhost:5055/health" -UseBasicParsing -ErrorAction Stop
    Write-Host "  ✅ Classification Server (port 5055): Running" -ForegroundColor Green
}
catch {
    Write-Host "  ❌ Classification Server (port 5055): Not responding" -ForegroundColor Red
    Write-Host "     Run: docker compose up -d" -ForegroundColor Yellow
    exit 1
}

Write-Host "`n📊 Running classification tests...`n" -ForegroundColor Yellow

$results = @()
$correctCount = 0

foreach ($test in $testFiles) {
    $filePath = Join-Path $PSScriptRoot $test.Path
    
    if (-not (Test-Path $filePath)) {
        Write-Host "⚠️  File not found: $($test.Name)" -ForegroundColor Yellow
        continue
    }
    
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkGray
    Write-Host "📄 Testing: $($test.Name)" -ForegroundColor Cyan
    Write-Host "   Expected: $($test.Expected)" -ForegroundColor Gray
    
    try {
        $form = @{ file = Get-Item $filePath }
        $startTime = Get-Date
        $result = Invoke-RestMethod -Uri "http://localhost:5055/api/process" -Method Post -Form $form -ErrorAction Stop
        $duration = ((Get-Date) - $startTime).TotalSeconds
        
        $isCorrect = $result.local.label -eq $test.Expected
        if ($isCorrect) { $correctCount++ }
        
        # Display results
        Write-Host "`n   📊 Results:" -ForegroundColor Yellow
        Write-Host "      Extraction: $($result.meta.pipeline)" -ForegroundColor Gray
        Write-Host "      Images: $($result.meta.images)" -ForegroundColor Gray
        Write-Host "      Text Length: $($result.meta.avgCharsPerPage) chars/page" -ForegroundColor Gray
        Write-Host "      Duration: $([math]::Round($duration, 2))s" -ForegroundColor Gray
        if ($result.policy) {
            Write-Host "      Policy: $($result.policy.category) - $($result.policy.rationale)" -ForegroundColor Gray
        }
        if ($result.pii) {
            $piiTotal = $result.pii.summary.total
            Write-Host "      PII Detected: $piiTotal" -ForegroundColor Gray
        }
        
        Write-Host "`n   🏷️  Classification:" -ForegroundColor Yellow
        $localColor = if ($result.local.label -eq $test.Expected) { "Green" } else { "Red" }
        Write-Host "      Local:  $($result.local.label)" -ForegroundColor $localColor
        if ($result.verifier.classifier.label) {
            $verifierColor = if ($result.verifier.classifier.label -eq $test.Expected) { "Green" } else { "Yellow" }
            Write-Host "      Verifier: $($result.verifier.classifier.label)" -ForegroundColor $verifierColor
        }
        $finalColor = if ($result.final.label -eq $test.Expected) { "Green" } else { "Red" }
        Write-Host "      Final:  $($result.final.label) $(if ($result.final.accepted) { '✅' } else { '⚠️' })" -ForegroundColor $finalColor
        
        if ($Detailed) {
            Write-Host "`n   📝 Rationale:" -ForegroundColor Yellow
            Write-Host "      $($result.local.raw.rationale)" -ForegroundColor Gray
        }
        
        $results += @{
            Test     = $test.Name
            Expected = $test.Expected
            Got      = $result.local.label
            Final    = $result.final.label
            Correct  = $isCorrect
            Pipeline = $result.meta.pipeline
            Duration = $duration
            Policy   = $result.policy.category
            PII      = $result.pii.summary.total
        }
        
    }
    catch {
        Write-Host "   ❌ Error: $($_.Exception.Message)" -ForegroundColor Red
        $results += @{
            Test     = $test.Name
            Expected = $test.Expected
            Got      = "ERROR"
            Correct  = $false
            Error    = $_.Exception.Message
        }
    }
    
    Write-Host ""
}

# Summary
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkGray
Write-Host "`n📈 Summary" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkGray

$accuracy = if ($testFiles.Count -gt 0) { ($correctCount / $testFiles.Count) * 100 } else { 0 }
$accuracyColor = if ($accuracy -ge 90) { "Green" } elseif ($accuracy -ge 70) { "Yellow" } else { "Red" }

Write-Host "   Total Tests: $($testFiles.Count)" -ForegroundColor White
Write-Host "   Correct: $correctCount" -ForegroundColor Green
Write-Host "   Incorrect: $($testFiles.Count - $correctCount)" -ForegroundColor Red
Write-Host "   Accuracy: $([math]::Round($accuracy, 1))%" -ForegroundColor $accuracyColor

Write-Host "`n   Results by Test:" -ForegroundColor White
foreach ($r in $results) {
    $icon = if ($r.Correct) { "✅" } else { "❌" }
    $color = if ($r.Correct) { "Green" } else { "Red" }
    Write-Host "      $icon $($r.Test)" -ForegroundColor $color
    Write-Host "         Expected: $($r.Expected) | Got: $($r.Got) | Pipeline: $($r.Pipeline)" -ForegroundColor Gray
}

if ($ShowLogs) {
    Write-Host "`n📋 Recent Server Logs:" -ForegroundColor Yellow
    docker logs classification-document-analyzer-datathon-server-1 --tail 30
}

Write-Host "`n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`n" -ForegroundColor DarkGray

# Return exit code based on accuracy
if ($accuracy -eq 100) {
    exit 0
}
else {
    exit 1
}
