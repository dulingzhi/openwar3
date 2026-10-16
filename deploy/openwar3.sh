#!/usr/bin/env bash
# OpenWar3 on this box — start, stop, restart, status.
#
# WHY THIS IS A SCRIPT AND NOT A systemd UNIT. The box this was written for is Debian 12 with
# systemd as PID 1, but an SSH session gets no user session bus (`systemctl --user` answers
# "Failed to connect to bus: No medium found"), and there is no usable sudo — so a system unit is
# out and a user unit is out. `cron` IS running, though, so `@reboot` is the one hook that
# survives a reboot: install it once with `deploy/install-cron.sh`, or by hand,
#
#     @reboot /home/<you>/openwar3/deploy/openwar3.sh start
#
# TWO SERVICES, TWO PORTS.
#   game    the built game AND the relay, on ONE port (deploy/serve.mjs) — the client derives its
#           relay address from the page's own origin, so the two must share an origin.
#   page    the Next.js landing page (web/), which needs Node >= 20.9 and cannot share a port
#           with the game because it is a different app with its own router.
#
# Both bind 0.0.0.0, so what makes them reachable is the NETWORK's firewall, not this box's — it
# has none. Open the two ports there; a service that is up and unreachable looks exactly like a
# service that is down.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SITE_PORT="${SITE_PORT:-8080}"
WEB_PORT="${WEB_PORT:-3000}"
# The box's own `node` may be older than the landing page needs (Debian 12 ships 18; Next 16 wants
# >= 20.9), so a newer one installed under the deploy root wins when it is there.
NODE="${NODE:-$(command -v node)}"
[ -x "$ROOT/node/bin/node" ] && NODE="$ROOT/node/bin/node"

pidfile() { echo "$ROOT/run/$1.pid"; }

# PIDs listening on a TCP port, from `ss`. Empty when `ss` cannot say.
port_pids() {
  ss -ltnp 2>/dev/null | grep ":$1 " | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u
}

# Is this PID one of OURS? Asked of its working directory, because the command line of a
# forked Next server (`next-server (v16.3.5)`) does not name the deploy root.
is_ours() {
  local cwd; cwd="$(readlink "/proc/$1/cwd" 2>/dev/null)"
  [ -n "$cwd" ] && case "$cwd" in "$ROOT"|"$ROOT"/*) return 0 ;; esac
  return 1
}

running() {
  local f; f="$(pidfile "$1")"
  [ -f "$f" ] && kill -0 "$(cat "$f")" 2>/dev/null
}

start_one() {
  local name="$1" port="$2" dir="$3"; shift 3
  if running "$name"; then
    echo "  $name: already running (pid $(cat "$(pidfile "$name")"), port $port)"
    return 0
  fi
  mkdir -p "$ROOT/run"
  # NO `setsid`, and that is deliberate. `setsid` forks, so the PID it leaves in `$!` is the
  # wrapper — the service is its CHILD, the wrapper exits immediately, and the pidfile names a
  # process that no longer exists while the real one is reparented to init and impossible to
  # stop. (That is exactly what left an orphan holding 8080 the first time this script ran.)
  # `nohup` alone is enough to outlive the SSH connection: it ignores SIGHUP and the stdio below
  # is already redirected away from the terminal, and it `exec`s the command, so `$!` IS the
  # service's own PID.
  ( cd "$dir" && PORT="$port" nohup "$@" >>"$ROOT/run/$name.log" 2>&1 < /dev/null & echo $! >"$(pidfile "$name")" )
  sleep 3
  if running "$name"; then
    echo "  $name: started (pid $(cat "$(pidfile "$name")"), port $port)"
  else
    echo "  $name: FAILED to start — see $ROOT/run/$name.log"
    tail -8 "$ROOT/run/$name.log" | sed 's/^/      /'
    return 1
  fi
}

stop_one() {
  local name="$1" port="$2" f; f="$(pidfile "$name")"
  local pid=""
  [ -f "$f" ] && pid="$(cat "$f")"

  if [ -z "$pid" ] && [ -z "$(port_pids "$port")" ]; then
    echo "  $name: not running"
    rm -f "$f"
    return 0
  fi

  [ -n "$pid" ] && kill -TERM "$pid" 2>/dev/null
  for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && kill -KILL "$pid" 2>/dev/null

  # Anything still holding the port and living under $ROOT is the rest of this service — Next
  # forks a server child the recorded PID never sees. Anything else on that port is not ours and
  # is left alone, which is why the cwd is checked rather than the port simply swept.
  local leftover=""
  for p in $(port_pids "$port"); do
    if is_ours "$p"; then kill -TERM "$p" 2>/dev/null; leftover="$leftover $p"; fi
  done
  [ -n "$leftover" ] && sleep 1 && echo "  $name: also stopped forked child(ren):$leftover"

  rm -f "$f"
  if [ -n "$pid" ]; then echo "  $name: stopped (was pid $pid)"; else echo "  $name: cleaned up"; fi
}

start() {
  echo "starting OpenWar3 from $ROOT  (node $("$NODE" -v))"
  # `deploy/serve.mjs` pins its port and exits non-zero if it cannot have it, so a silent
  # walk onto a port the firewall does not open is impossible here (see its header).
  start_one game "$SITE_PORT" "$ROOT" "$NODE" deploy/serve.mjs
  if [ -f "$ROOT/web/.next/BUILD_ID" ]; then
    start_one page "$WEB_PORT" "$ROOT/web" "$NODE" node_modules/next/dist/bin/next start -p "$WEB_PORT"
  else
    echo "  page: not built (no web/.next/BUILD_ID) — skipping"
  fi
}

stop() {
  echo "stopping OpenWar3"
  stop_one game "$SITE_PORT"
  stop_one page "$WEB_PORT"
}

status() {
  for pair in "game:$SITE_PORT" "page:$WEB_PORT"; do
    local name="${pair%%:*}" port="${pair##*:}"
    if running "$name"; then
      echo "  $name: up (pid $(cat "$(pidfile "$name")"), port $port)"
    else
      echo "  $name: down"
    fi
  done
  echo "  --- listening ---"
  ss -ltn 2>/dev/null | awk -v a=":$SITE_PORT" -v b=":$WEB_PORT" '$4 ~ a || $4 ~ b {print "  " $4}'
}

case "${1:-status}" in
  start)   start ;;
  stop)    stop ;;
  restart) stop; start ;;
  status)  status ;;
  *) echo "usage: $0 {start|stop|restart|status}"; exit 2 ;;
esac
