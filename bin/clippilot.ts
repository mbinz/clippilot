#!/usr/bin/env tsx
import { createProgram } from '../src/cli/index.js';

const program = createProgram();
program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
