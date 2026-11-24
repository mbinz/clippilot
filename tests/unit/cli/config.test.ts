import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProgram } from '../../../src/cli/index.js';

describe('config set --global', () => {
  let dir: string;
  let cwd: string;
  let savedEnv: NodeJS.ProcessEnv;
  let logged: string[];

  beforeEach(() => {
    savedEnv = { ...process.env };
    cwd = process.cwd();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clippilot-cfgcli-'));
    fs.mkdirSync(path.join(dir, 'work'));
    process.env['CLIPPILOT_HOME'] = path.join(dir, 'home');
    process.chdir(path.join(dir, 'work'));
    logged = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => { logged.push(a.join(' ')); });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.chdir(cwd);
    process.env = savedEnv;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes the global file (0600) and not the project file; output hides the value', async () => {
    await createProgram().parseAsync(['node', 'clippilot', 'config', 'set', 'gemini_api_key', 'secret-xyz', '--global']);
    const g = path.join(dir, 'home', 'config.json');
    expect(JSON.parse(fs.readFileSync(g, 'utf-8'))).toEqual({ gemini_api_key: 'secret-xyz' });
    expect(fs.statSync(g).mode & 0o777).toBe(0o600);
    expect(fs.existsSync(path.join(dir, 'work', '.clippilot', 'config.json'))).toBe(false);
    expect(logged.join('\n')).not.toContain('secret-xyz');
  });

  it('without --global still writes the project file', async () => {
    await createProgram().parseAsync(['node', 'clippilot', 'config', 'set', 'gemini_model', 'm', ]);
    expect(fs.existsSync(path.join(dir, 'work', '.clippilot', 'config.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'home', 'config.json'))).toBe(false);
  });

  it('languages is stored as a list', async () => {
    await createProgram().parseAsync(['node', 'clippilot', 'config', 'set', 'languages', 'de, en,pt', '--global']);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'home', 'config.json'), 'utf-8'))).toEqual({ languages: ['de', 'en', 'pt'] });
  });
});
