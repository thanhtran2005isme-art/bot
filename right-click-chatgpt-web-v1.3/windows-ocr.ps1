param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$ImagePath
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding

Add-Type -AssemblyName System.Runtime.WindowsRuntime

# Force-load the WinRT types used below. Loading IAsyncOperation explicitly is
# important on some Windows PowerShell/.NET installations because the generic
# awaiter methods are otherwise not exposed correctly through reflection.
$null = [Windows.Foundation.IAsyncOperation`1, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Storage.FileAccessMode, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType = WindowsRuntime]

# PowerShell cannot directly await WinRT IAsyncOperation<T>. GetAwaiter is more
# broadly compatible than looking for a specific AsTask overload, which is not
# exposed the same way on every Windows PowerShell/.NET build.
$getAwaiterBaseMethod = [System.WindowsRuntimeSystemExtensions].GetMember("GetAwaiter") |
    Where-Object {
        $_ -is [System.Reflection.MethodInfo] -and
        $_.IsGenericMethodDefinition -and
        $_.GetParameters().Count -eq 1 -and
        $_.GetParameters()[0].ParameterType.Name -eq "IAsyncOperation`1"
    } |
    Select-Object -First 1

if (-not $getAwaiterBaseMethod) {
    # Fallback: accept any single-argument generic GetAwaiter whose input is a
    # WinRT IAsyncOperation. This handles reflection differences across builds.
    $getAwaiterBaseMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() |
        Where-Object {
            $_.Name -eq "GetAwaiter" -and
            $_.IsGenericMethodDefinition -and
            $_.GetParameters().Count -eq 1 -and
            $_.GetParameters()[0].ParameterType.FullName -like "Windows.Foundation.IAsyncOperation*"
        } |
        Select-Object -First 1
}

if (-not $getAwaiterBaseMethod) {
    throw "WinRT GetAwaiter is unavailable in this Windows PowerShell runtime."
}

function Await-WinRt {
    param(
        [Parameter(Mandatory = $true)]
        $AsyncOperation,

        [Parameter(Mandatory = $true)]
        [Type]$ResultType
    )

    try {
        $method = $script:getAwaiterBaseMethod.MakeGenericMethod($ResultType)
        $awaiter = $method.Invoke($null, @($AsyncOperation))
        return $awaiter.GetResult()
    }
    catch {
        if ($null -ne $_.Exception.InnerException) {
            throw $_.Exception.InnerException
        }
        throw
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
            throw "Windows OCR has no available recognition language. Install a Windows OCR language feature and retry."
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
