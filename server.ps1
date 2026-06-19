# Einfacher lokaler Webserver für den BMW M4 Viewer (kein Python/Node nötig)
$port = 8000
$root = $PSScriptRoot

$mime = @{
    ".html" = "text/html; charset=utf-8"
    ".js"   = "text/javascript; charset=utf-8"
    ".css"  = "text/css; charset=utf-8"
    ".json" = "application/json"
    ".glb"  = "model/gltf-binary"
    ".gltf" = "model/gltf+json"
    ".png"  = "image/png"
    ".jpg"  = "image/jpeg"
    ".ico"  = "image/x-icon"
    ".bin"  = "application/octet-stream"
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()
Write-Host ""
Write-Host "  BMW M4 Viewer laeuft auf  http://localhost:$port" -ForegroundColor Green
Write-Host "  Zum Beenden dieses Fenster schliessen (oder Strg+C)." -ForegroundColor DarkGray
Write-Host ""

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $req = $context.Request
        $res = $context.Response

        $path = [System.Uri]::UnescapeDataString($req.Url.AbsolutePath)
        if ($path -eq "/") { $path = "/index.html" }
        $file = Join-Path $root ($path -replace "/", "\")

        if ((Test-Path $file -PathType Leaf) -and ([System.IO.Path]::GetFullPath($file)).StartsWith($root)) {
            $ext = [System.IO.Path]::GetExtension($file).ToLower()
            $type = $mime[$ext]
            if (-not $type) { $type = "application/octet-stream" }
            $bytes = [System.IO.File]::ReadAllBytes($file)
            $res.ContentType = $type
            $res.ContentLength64 = $bytes.Length
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $res.StatusCode = 404
            $msg = [System.Text.Encoding]::UTF8.GetBytes("404 - Nicht gefunden: $path")
            $res.OutputStream.Write($msg, 0, $msg.Length)
        }
        $res.OutputStream.Close()
    }
} finally {
    $listener.Stop()
}
