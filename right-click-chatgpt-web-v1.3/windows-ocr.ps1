param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$ImagePath
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding

Add-Type -AssemblyName System.Runtime.WindowsRuntime

# Explicitly load the WinRT generic async interface before reflecting over
# WindowsRuntimeSystemExtensions. This is required on some Windows PowerShell
# 5.1/.NET Framework installations.
$null = [Windows.Foundation.IAsyncOperation`1, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Storage.FileAccessMode, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType = WindowsRuntime]

# Windows PowerShell 5.1 exposes these WinRT bridge methods differently across
# Windows/.NET builds. Do NOT require IsGenericMethodDefinition here: on some
# systems that filter hides the correct method even though MakeGenericMethod()
# works. Prefer GetAwaiter, then fall back to AsTask.
$getAwaiterBaseMethod = [System.WindowsRuntimeSystemExtensions].GetMember("GetAwaiter") |
    Where-Object {
        try {
            $_ -is [System.Reflection.MethodInfo] -and
            $_.GetParameters().Count -eq 1 -and
            $_.GetParameters()[0].ParameterType.Name -eq "IAsyncOperation`1"
        }
        catch {
            $false
        }
    } |
    Select-Object -First 1

$asTaskBaseMethod = $null
if (-not $getAwaiterBaseMethod) {
    $asTaskBaseMethod = [System.WindowsRuntimeSystemExtensions].GetMember("AsTask") |
        Where-Object {
            try {
                $_ -is [System.Reflection.MethodInfo] -and
                $_.GetParameters().Count -eq 1 -and
                $_.GetParameters()[0].ParameterType.Name -eq "IAsyncOperation`1"
            }
            catch {
                $false
            }
        } |
        Select-Object -First 1
}

if (-not $getAwaiterBaseMethod -and -not $asTaskBaseMethod) {
    $available = [System.WindowsRuntimeSystemExtensions].GetMethods() |
        Where-Object { $_.Name -in @("GetAwaiter", "AsTask") } |
        ForEach-Object {
            try {
                $p = ($_.GetParameters() | ForEach-Object { $_.ParameterType.Name }) -join ", "
                "$($_.Name)($p)"
            }
            catch {
                $_.Name
            }
        } |
        Select-Object -Unique

    $detail = ($available -join "; ")
    throw "No compatible WinRT await bridge was found. Available methods: $detail"
}

function Await-WinRt {
    param(
        [Parameter(Mandatory = $true)]
        $AsyncOperation,

        [Parameter(Mandatory = $true)]
        [Type]$ResultType
    )

    try {
        if ($script:getAwaiterBaseMethod) {
            $method = $script:getAwaiterBaseMethod.MakeGenericMethod($ResultType)
            $awaiter = $method.Invoke($null, @($AsyncOperation))
            return $awaiter.GetResult()
        }

        $method = $script:asTaskBaseMethod.MakeGenericMethod($ResultType)
        $task = $method.Invoke($null, @($AsyncOperation))
        $task.Wait(-1) | Out-Null
        return $task.Result
    }
    catch {
        $current = $_.Exception
        while ($null -ne $current.InnerException) {
            $current = $current.InnerException
        }
        throw $current
    }
}

$fullPath = [System.IO.Path]::GetFullPath($ImagePath)
if (-not [System.IO.File]::Exists($fullPath)) {
    throw "OCR image file was not found: $fullPath"
}

$storageFile = Await-WinRt `
    ([Windows.Storage.StorageFile]::GetFileFromPathAsync($fullPath)) `
    ([Windows.Storage.StorageFile])

$fileStream = Await-WinRt `
    ($storageFile.OpenAsync([Windows.Storage.FileAccessMode]::Read)) `
    ([Windows.Storage.Streams.IRandomAccessStream])

try {
    $decoder = Await-WinRt `
        ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($fileStream)) `
        ([Windows.Graphics.Imaging.BitmapDecoder])

    $softwareBitmap = Await-WinRt `
        ($decoder.GetSoftwareBitmapAsync()) `
        ([Windows.Graphics.Imaging.SoftwareBitmap])

    try {
        $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
        if ($null -eq $engine) {
            throw "Windows OCR has no installed recognition language. Install an OCR language feature in Windows."
        }

        $result = Await-WinRt `
            ($engine.RecognizeAsync($softwareBitmap)) `
            ([Windows.Media.Ocr.OcrResult])

        if ($null -ne $result -and $null -ne $result.Text) {
            [Console]::Write($result.Text)
        }
    }
    finally {
        if ($null -ne $softwareBitmap) {
            $softwareBitmap.Dispose()
        }
    }
}
finally {
    if ($null -ne $fileStream) {
        $fileStream.Dispose()
    }
}
