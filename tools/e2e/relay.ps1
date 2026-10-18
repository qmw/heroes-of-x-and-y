# Reverse TCP relay for WSL2 (NAT networking): Windows Chrome's DevTools port only listens on the
# Windows loopback, which WSL cannot reach. This script runs on Windows and keeps ONE standby
# connection to the driver's WSL listener (reachable as localhost through WSL localhost forwarding).
# When the driver needs a CDP connection it writes one byte 'G' on the standby connection; the script
# then dials Chrome, pumps bytes both ways and opens the next standby connection.
# It exits when the driver is gone (standby connection closed / WSL listener unreachable).
param([int]$ChromePort, [int]$WslPort)
$ErrorActionPreference = 'Stop'
$fails = 0
$buf = New-Object byte[] 1
while ($true) {
  $w = New-Object System.Net.Sockets.TcpClient
  try { $w.Connect('localhost', $WslPort) }
  catch { $w.Dispose(); $fails++; if ($fails -gt 50) { exit 0 }; Start-Sleep -Milliseconds 200; continue }
  $fails = 0
  $w.NoDelay = $true
  $ws = $w.GetStream()
  try { $n = $ws.Read($buf, 0, 1) } catch { $n = 0 }
  if ($n -le 0) { exit 0 }
  $c = New-Object System.Net.Sockets.TcpClient
  try { $c.Connect('127.0.0.1', $ChromePort) } catch { $w.Close(); exit 0 }
  $c.NoDelay = $true
  $cs = $c.GetStream()
  [void]$cs.CopyToAsync($ws); [void]$ws.CopyToAsync($cs)
}
