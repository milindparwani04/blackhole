# Stops the Blackhole server (whatever is listening on its port). SearXNG/Docker are left running.
$port = 4317
$c = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($c) {
  Stop-Process -Id $c.OwningProcess -Confirm:$false
  "Blackhole stopped."
} else {
  "Blackhole is not running."
}
