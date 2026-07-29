#!/usr/bin/env node
// expo-app-info — List every Expo (EAS) app with its latest build version per platform.
// MIT License. No runtime dependencies.
//
// Thin entry point: all logic lives in ../src so it can be unit tested via
// import without triggering process.exit side effects.

import { run } from '../src/cli.mjs';

function fail(msg) {
  if (process.stderr.isTTY) process.stderr.write('\r\x1b[2K');
  const isTTY = process.stdout.isTTY;
  console.error(`${isTTY ? '\x1b[31m' : ''}✖ ${msg}${isTTY ? '\x1b[0m' : ''}`);
  process.exit(1);
}

run().catch((err) => fail(err?.message ?? String(err)));
