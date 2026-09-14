param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$ImagePath
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding

Add-Type -AssemblyName System.Runtime.WindowsRuntime

$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Storage.FileAccessMode, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType = WindowsRuntime]

function Await-WinRt {
    param(
        [Parameter(Mandatory = $true)]
        $AsyncOperation,

        [Parameter(Mandatory = $true)]
        [Type]$ResultType
    )

    $asTaskGeneric = [System.WindowsRuntimeSystemExtensions].GetMethods() |
        Where-Object {
            $_.Name -eq "AsTask" -and
            $_.IsGenericMethodDefinition -and
            $_.GetParameters().Count -eq 1
        } |
        Select-Object -First 1

    if (-not $asTaskGeneric) {
        throw "Không tìm thấy WindowsRuntime AsTask."
    }

    $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
    $netTask = $asTask.Invoke($null, @($AsyncOperation))
    $netTask.Wait()
    return $netTask.Result
}

$fullPath = [System.IO.Path]::GetFullPath($ImagePath)
if (-not [System.IO.File]::Exists($fullPath)) {
    throw "Không tìm thấy ảnh OCR: $fullPath"
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
            throw "Windows OCR không có ngôn ngữ OCR khả dụng. Hãy cài OCR language feature trong Windows."
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
