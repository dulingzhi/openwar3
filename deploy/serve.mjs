// The OpenWar3 web host: the built game and the relay, on ONE port, for a headless box.
//
// `electron/server.mjs` already does the serving, and does it deliberately without Electron —
// its header anticipates exactly this ("the half a headless dedicated host would keep"). What it
// is not is an entry point, and it ASKS for its port rather than taking it: if 8787 is busy it
// walks to 8788, 8789, 8790 and finally a random one. That is right for a desktop app, where a
// game that refuses to launch is worse than one whose address moved. It is wrong here. Behind a
// firewall or a cloud security group, a service that quietly lands on 8788 while only 8080 is
// open is a service NOBODY CAN REACH, and nothing anywhere says so — the process is up, the port
// is listening, and every client times out.
//
// So this entry pins the port and, if it did not get it, says so and exits non-zero. A service
// that fails to start is a service the operator sees; one that starts on the wrong port is one
// they debug for an hour.
//
// Run:   PORT=8080 node deploy/serve.mjs
// Env:   PORT  the port to bind (default 8080)
//        SITE  the built game to serve (default ./site, beside this repo's deploy/ folder)
//        HOST  the interface (default 0.0.0.0 — a public host is reached from elsewhere)

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "../electron/server.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(process.env.SITE ?? join(here, "..", "site"));
const port = Number(process.env.PORT) || 8080;
const host = process.env.HOST ?? "0.0.0.0";

if (!existsSync(join(root, "index.html"))) {
  console.error(`[openwar3] no built game at ${root} — expected an index.html in it.`);
  console.error("[openwar3] build with `pnpm build` and copy dist/ there, or set SITE.");
  process.exit(1);
}

const server = await startServer({ root, port, host });

if (server.port !== port) {
  // The walk is the desktop app's behaviour and cannot be turned off from outside, so it is
  // caught on the way out instead. Nothing has been served yet; the sockets are already closed.
  await server.stop();
  console.error(`[openwar3] wanted port ${port} and got ${server.port} — something else is on it.`);
  console.error("[openwar3] refusing to serve on a port the firewall does not open.");
  process.exit(2);
}

console.log(`[openwar3] serving the game and the relay on http://${host}:${server.port}`);
console.log(`[openwar3]   page     http://<this-host>:${server.port}/`);
console.log(`[openwar3]   relay    ws://<this-host>:${server.port}/relay  (protocol ${server.protocol})`);
console.log(`[openwar3]   site     ${root}`);

/** Stay alive until told to stop, so the process is never a short-lived one under a supervisor. */
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    console.log(`[openwar3] ${signal} — closing.`);
    void server.stop().then(() => process.exit(0));
  });
}
