# livp2jpg.ps1 —— 批量把 iPhone 导出的 .livp 实况照片转成 Windows 能直接看的图片
#
# 背景：iPhone「实况照片」导出到电脑是 .livp 文件，本质是个 zip 包
# （一张 HEIC/JPG 静态图 + 一段 MOV 视频），Windows 资源管理器不认。
#
# 用法（在仓库根目录或任意位置都行）：
#   powershell -ExecutionPolicy Bypass -File tools\livp2jpg.ps1 "D:\照片\衣服"
# 不带参数则处理当前目录。每个 xxx.livp 在同目录生成 xxx.jpg（或 xxx.heic，见下）。
# 已存在同名输出的会跳过，可反复运行。
#
# 说明：静态图若是 HEIC，会尝试调用 Windows 解码器转 JPG；
# 转不了（没装解码器）时保留 .heic 文件——去微软商店装免费的
# 「HEIF 图像扩展」后 Windows 就能直接看，再跑一次本脚本即可转成 JPG。
# 另外电子衣柜 App 选图时已支持直接选 .livp / .heic（自动转换），不转也能用。

param([string]$Dir = (Get-Location).Path)

Add-Type -AssemblyName System.IO.Compression.FileSystem

# --- HEIC → JPG：走 Windows 自带的 WinRT 图像解码（装了 HEIF 扩展才可用） ---
$script:winrtReady = $false
$script:awaitGeneric = $null
function Init-WinRT {
    if ($script:winrtReady) { return $true }
    try {
        Add-Type -AssemblyName System.Runtime.WindowsRuntime
        $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
        $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
        $script:awaitGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
            $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetParameters().Count -eq 1
        })[0]
        $script:winrtReady = $true
        return $true
    } catch { return $false }
}
function Await-Op($op, [type]$t) {
    $task = $script:awaitGeneric.MakeGenericMethod($t).Invoke($null, @($op))
    $task.Wait() | Out-Null
    return $task.Result
}
function Convert-HeicToJpg([string]$src, [string]$dst) {
    try {
        if (-not (Init-WinRT)) { return $false }
        $file = Await-Op ([Windows.Storage.StorageFile]::GetFileFromPathAsync($src)) ([Windows.Storage.StorageFile])
        $inStream = Await-Op ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
        $decoder = Await-Op ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($inStream)) ([Windows.Graphics.Imaging.BitmapDecoder])
        $bitmap = Await-Op ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
        $outFile = Await-Op ([Windows.Storage.StorageFile]::GetFileFromPathAsync($dst)) ([Windows.Storage.StorageFile])
        $outStream = Await-Op ($outFile.OpenAsync([Windows.Storage.FileAccessMode]::ReadWrite)) ([Windows.Storage.Streams.IRandomAccessStream])
        $jpegId = [Windows.Graphics.Imaging.BitmapEncoder]::JpegEncoderId
        $encoder = Await-Op ([Windows.Graphics.Imaging.BitmapEncoder]::CreateAsync($jpegId, $outStream)) ([Windows.Graphics.Imaging.BitmapEncoder])
        $encoder.SetSoftwareBitmap($bitmap)
        Await-Op ($encoder.FlushAsync()) ([System.Object]) | Out-Null
        $outStream.Dispose(); $inStream.Dispose()
        return $true
    } catch { return $false }
}

# --- 主流程 ---
$files = Get-ChildItem -Path $Dir -Filter *.livp -File
if (-not $files) { Write-Host "在 $Dir 没找到 .livp 文件"; exit 0 }

$ok = 0; $heicLeft = 0; $failed = 0
foreach ($f in $files) {
    $base = Join-Path $f.DirectoryName $f.BaseName
    if ((Test-Path "$base.jpg") -or (Test-Path "$base.heic") -or (Test-Path "$base.png")) {
        Write-Host "→ 跳过（已转过）: $($f.Name)"; continue
    }
    try {
        $zip = [System.IO.Compression.ZipFile]::OpenRead($f.FullName)
        $entry = $zip.Entries |
            Where-Object { $_.FullName -match '\.(heic|heif|jpe?g|png)$' -and $_.Length -gt 0 } |
            Sort-Object Length -Descending | Select-Object -First 1
        if (-not $entry) { $zip.Dispose(); throw '包里没找到静态图片' }
        $ext = [IO.Path]::GetExtension($entry.FullName).ToLower()
        if ($ext -match '^\.(jpe?g|png)$') {
            [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, "$base$ext", $true)
            $zip.Dispose()
            $ok++; Write-Host "✓ $($f.Name) → $($f.BaseName)$ext"
        } else {
            # HEIC：先抽出 .heic，再尽量转成 .jpg
            [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, "$base.heic", $true)
            $zip.Dispose()
            New-Item -ItemType File -Path "$base.jpg" -Force | Out-Null  # 先占位，转换失败就删掉
            if (Convert-HeicToJpg "$base.heic" "$base.jpg") {
                Remove-Item "$base.heic"
                $ok++; Write-Host "✓ $($f.Name) → $($f.BaseName).jpg"
            } else {
                Remove-Item "$base.jpg"
                $heicLeft++; Write-Host "△ $($f.Name) → $($f.BaseName).heic（装「HEIF 图像扩展」后可再转 JPG）"
            }
        }
    } catch {
        $failed++; Write-Host "✗ $($f.Name)：$($_.Exception.Message)"
    }
}
Write-Host "`n完成：转 JPG/图片 $ok 个，仅抽出 HEIC $heicLeft 个，失败 $failed 个"
if ($heicLeft -gt 0) { Write-Host "提示：微软商店搜「HEIF 图像扩展」免费安装后，Windows 即可直接看 .heic" }
