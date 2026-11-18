if ($env:AIDE_NO_BROWSER -eq '1') { exit 0 }
$port = if ($env:AIDE_PORT) { $env:AIDE_PORT } else { '7800' }
$url = "http://127.0.0.1:$port"
for ($i = 0; $i -lt 80; $i++) {
  try {
    Invoke-RestMethod "$url/api/health" -TimeoutSec 1 | Out-Null
    Start-Process $url
    exit 0
  } catch {
    Start-Sleep -Milliseconds 500
  }
}
exit 1
