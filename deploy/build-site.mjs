#!/usr/bin/env node
// Build the game page for a SELF-HOSTED box (deploy/README.md).
//
// It is the repo's own `pnpm build` with ONE thing changed, so a deployment cannot quietly
// disagree with this file:
//
//     VITE_OFFICIAL_SERVER=""   — this build watches NO official server.
//
// **Why that is the change, and only that.** The client always watches two kinds of relay
// (src/net/lobby.ts):
//
//   • its OWN origin, derived from `window.location` (`defaultRelayUrl`, src/net/transport.ts) —
//     on a self-hosted box that is already `ws://<that-box>/relay`, because `electron/server.mjs`
//     serves the page and the relay from one port. Nothing needs pointing anywhere;
//   • plus the OFFICIAL server, a compiled-in hostname every shipped copy watches out of the box
//     (src/net/officialServer.ts) so the player base has one meeting place.
//
// On a box that serves its own relay the second one is wrong in two ways at once: it puts a
// foreign server in the player's Servers List as a row they cannot remove (an official row has
// no ✕), and a game created there is played on someone else's infrastructure. Emptying the
// constant leaves exactly one relay — the box's own — which is what "self-hosted" means.
//
// Deliberately NOT a `.env.production` in the repository: that file would strip the official
// server from the RELEASED desktop app too, which is the one build that must keep it. The
// deployment passes it here instead, and the release scripts (`pnpm release:win`, …) never see it.

import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

console.log("[build-site] building for a self-hosted box:");
console.log("[build-site]   VITE_OFFICIAL_SERVER= (empty) — this build watches its OWN relay only");
console.log("[build-site]   the relay itself needs no address: it is same-origin with the page");

execSync("pnpm build", {
  cwd: REPO,
  stdio: "inherit",
  env: { ...process.env, VITE_OFFICIAL_SERVER: "" },
});

console.log("[build-site] done — dist/ is ready to copy to the box (deploy/README.md)");
