# Deploying OpenWar3 on a plain Linux box

This is the recipe for running OpenWar3 on a host you own rather than on the managed services
(`web/` normally goes to Vercel, and the relay in `server/` to Railway — see
[`docs/multiplayer.md`](../docs/multiplayer.md)). It is deliberately a recipe and not a record:
**the box it was written on is not named here.** Its address and login belong to whoever runs it,
and this repository is public.

Everything below lives under one directory on the host, called `$ROOT` from here on.

## What runs, and why it is two things

```
$ROOT/
  site/            the built game            (pnpm build → dist/, copied here)
  electron/        server.mjs — the page AND the relay, on one port
  server/          rooms.mjs, wsAdapter.mjs, hostInfo.mjs
  deploy/          serve.mjs — the entry point
  web/             the Next.js landing page  (its own build)
  node/            a Node the page is new enough for (see below)
  node_modules/    `ws`, the relay's only dependency
  run/             pid files and logs
```

| service | what it is | default port |
|---|---|---|
| `game` | `deploy/serve.mjs` — the built game **and** the relay, on ONE port | 8080 |
| `page` | `web/` under `next start` | 3000 |

The game and its relay share a port on purpose: the client derives its relay address from the
page's own origin, so **a machine that can load the page can reach the relay by construction**.
Two ports would mean two things to open in a firewall and a way for them to disagree.

## The three things a bare box does not have

1. **A new enough Node.** Debian 12 ships Node 18; Next 16 needs ≥ 20.9. Install one per-user,
   under `$ROOT/node`, and make sure it is **first on `PATH`** — a nested `next build` resolves
   `node` from `PATH`, not from whatever launched it, and will otherwise fail with
   "You are using Node.js 18.20.4."
2. **systemd, in a usable form.** A host whose PID 1 is systemd still gives an SSH session no
   user bus (`systemctl --user` answers *"Failed to connect to bus: No medium found"*), and a
   system unit needs root. So persistence is **cron's `@reboot`**, which does work wherever cron
   runs. `deploy/openwar3.sh` is the unit that would have been.
3. **A firewall that knows about the ports.** These bind `0.0.0.0`; what makes them reachable is
   the network's firewall or security group, not the host's. A service that is up and unreachable
   looks exactly like one that is down, so **open the ports and then test from a different
   network** before believing it works.

## Deploying an update

```bash
# 1. the game  (from a checkout: pnpm build)
tar czf site.tgz -C dist .
scp site.tgz <host>:~/openwar3/          && ssh <host> 'tar xzf ~/openwar3/site.tgz -C ~/openwar3/site'

# 2. the server sources, when they change
scp electron/server.mjs server/*.mjs deploy/serve.mjs …

# 3. the landing page, when it changes — then rebuild ON THE BOX
ssh <host> 'cd ~/openwar3/web && PATH=$HOME/openwar3/node/bin:$PATH corepack pnpm@10.33.1 build'

# 4. restart
ssh <host> '~/openwar3/deploy/openwar3.sh restart'
```

**Build the page on the host, not on your laptop.** Next resolves platform-specific binaries
(`next-swc`) at install time, so a `.next/` and `node_modules/` built on Windows are not the ones
a Linux host can run.

## `deploy/serve.mjs` exists for one reason

`electron/server.mjs` already serves the game and the relay, and is deliberately free of Electron
— its header anticipates exactly this host. What it also is, is a module that **asks** for its
port and walks to the next one when it is busy (`8787 → 8788 → 8789 → 8790 → random`). That is
right for a desktop app and wrong here: on a firewalled host, a service that quietly lands on 8788
while only 8080 is open is one nobody can reach, and nothing says so. `serve.mjs` pins the port,
and if it did not get it, says so and exits non-zero — a service that fails to start is one the
operator sees.

## Operating it

```bash
deploy/openwar3.sh start|stop|restart|status
```

Ports are `SITE_PORT` and `WEB_PORT` (default 8080 and 3000), and the Node used is `$ROOT/node/bin/node`
when it exists, else `PATH`'s.

Two things that were learned the hard way and are commented at their call sites:

- **Never `setsid` when capturing a PID.** It forks, so `$!` is the wrapper — the wrapper exits at
  once, the pidfile names a process that no longer exists, and the real service is reparented to
  init and unstoppable. It left a stray process holding the game's port through one whole deploy.
- **`stop` also sweeps the PORT**, for anything still listening that lives under `$ROOT`, because
  Next forks a server child its launcher's PID never sees. The `$ROOT` check is what keeps that
  sweep from touching an unrelated process.
