param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$ImagePath
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding

function Find-Tesseract {
    $candidates = New-Object System.Collections.Generic.List[string]

    if ($env:TESSERACT_PATH) {
        $candidates.Add($env:TESSERACT_PATH.Trim().Trim('"'))
    }

    try {
        $command = Get-Command tesseract.exe -ErrorAction Stop
        if ($command -and $command.Source) {
            $candidates.Add($command.Source)
        }
    }
    catch {}

    try {
        $command = Get-Command tesseract -ErrorAction Stop
        if ($command -and $command.Source) {
            $candidates.Add($command.Source)
        }
    }
    catch {}

    $candidates.Add((Join-Path $PSScriptRoot "tesseract.exe"))

    if ($env:ProgramFiles) {
        $candidates.Add((Join-Path $env:ProgramFiles "Tesseract-OCR\tesseract.exe"))
    }

    ${programFilesX86} = ${env:ProgramFiles(x86)}
    if (${programFilesX86}) {
        $candidates.Add((Join-Path ${programFilesX86} "Tesseract-OCR\tesseract.exe"))
    }

    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            return [System.IO.Path]::GetFullPath($candidate)
        }
    }

    return $null
}

function Invoke-ProcessUtf8 {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FileName,

        [Parameter(Mandatory = $true)]
        [string]$Arguments
    )

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $FileName
    $psi.Arguments = $Arguments
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true

    try {
        $utf8 = New-Object System.Text.UTF8Encoding($false)
        $psi.StandardOutputEncoding = $utf8
        $psi.StandardErrorEncoding = $utf8
    }
    catch {}

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $psi

    if (-not $process.Start()) {
        throw "Could not start: $FileName"
    }

    try {
        $stdout = $process.StandardOutput.ReadToEnd()
        $stderr = $process.StandardError.ReadToEnd()
        $process.WaitForExit()

        return [PSCustomObject]@{
            ExitCode = $process.ExitCode
            StdOut   = $stdout
            StdErr   = $stderr
        }
    }
    finally {
        $process.Dispose()
    }
}

$fullPath = [System.IO.Path]::GetFullPath($ImagePath)
if (-not [System.IO.File]::Exists($fullPath)) {
    throw "OCR image file was not found: $fullPath"
}

$tesseract = Find-Tesseract
if (-not $tesseract) {
    throw @"
Tesseract OCR was not found. Windows OCR does not reliably recognize Vietnamese on this Windows version.
Install Tesseract, then restart the bridge:
  winget install --id UB-Mannheim.TesseractOCR -e
If Tesseract is installed elsewhere, set TESSERACT_PATH to tesseract.exe.
"@
}

$listResult = Invoke-ProcessUtf8 -FileName $tesseract -Arguments "--list-langs"
if ($listResult.ExitCode -ne 0) {
    $detail = ($listResult.StdErr + " " + $listResult.StdOut).Trim()
    throw "Could not query Tesseract languages: $detail"
}

$languages = @(
    ($listResult.StdOut -split "`r?`n") |
        ForEach-Object { $_.Trim() } |
        Where-Object { $_ -and $_ -notmatch '^List of available languages' }
)

if ($languages -notcontains "vie") {
    $tessdataDir = Join-Path ([System.IO.Path]::GetDirectoryName($tesseract)) "tessdata"
    $available = if ($languages.Count -gt 0) { $languages -join ", " } else { "none" }
    throw @"
Tesseract is installed, but Vietnamese OCR data is missing (vie.traineddata).
Expected tessdata folder: $tessdataDir
Available languages: $available
Install/copy vie.traineddata into that tessdata folder, then restart the bridge.
"@
}

$ocrLanguage = if ($languages -contains "eng") { "vie+eng" } else { "vie" }

# PSM 6 works well for dense phone screenshots while preserving line order.
# Override with RCGPT_TESSERACT_PSM if another layout works better on a device.
$psm = if ($env:RCGPT_TESSERACT_PSM) { $env:RCGPT_TESSERACT_PSM.Trim() } else { "6" }
if ($psm -notmatch '^\d+$') {
    $psm = "6"
}

$escapedPath = $fullPath.Replace('"', '\"')
$arguments = "`"$escapedPath`" stdout -l $ocrLanguage --oem 1 --psm $psm -c preserve_interword_spaces=1"
$result = Invoke-ProcessUtf8 -FileName $tesseract -Arguments $arguments

if ($result.ExitCode -ne 0) {
    $detail = ($result.StdErr + " " + $result.StdOut).Trim()
    throw "Tesseract OCR failed: $detail"
}

$text = [string]$result.StdOut
$text = $text.Replace("`f", "").Trim()
if (-not $text) {
    throw "Tesseract did not recognize any text in the screenshot."
}

[Console]::Write($text)
