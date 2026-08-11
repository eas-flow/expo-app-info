#!/usr/bin/env node
// expo-shelfit — List every Expo (EAS) app with its latest build version per platform.
// MIT License. No runtime dependencies.
//
// Thin entry point: all logic lives in ../src so it can be unit tested via
// import without triggering process.exit side effects.

import { run } from '../src/cli.mjs';
import { red } from '../src/shared/terminal/render.mjs';

function fail(msg) {
  if (process.stderr.isTTY) process.stderr.write('\r\x1b[2K');
  console.error(red(`✖ ${msg}`));
  process.exit(1);
}

run().catch((err) => fail(err?.message ?? String(err)));
