import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig, saveConfig } from '../../core/config/manager.js';

export function registerConfigCommand(parent: Command): void {
  parent
    .command('config')
    .description('View or edit configuration')
    .argument('[action]', 'Action: show, set')
    .argument('[key]', 'Config key (e.g., gemini_api_key)')
    .argument('[value]', 'Value to set')
    .action(async (action?: string, key?: string, value?: string) => {
      const basePath = process.cwd();

      if (!action || action === 'show') {
        const config = await loadConfig(basePath);
        const display = { ...config, gemini_api_key: config.gemini_api_key ? '***' : '(not set)' };
        console.log(JSON.stringify(display, null, 2));
        return;
      }

      if (action === 'set') {
        if (!key || value === undefined) {
          console.error(chalk.red('Usage: clippilot config set <key> <value>'));
          process.exit(1);
        }

        const config = await loadConfig(basePath);
        // Simple top-level key setting
        (config as any)[key] = value;
        await saveConfig(basePath, config);
        console.log(chalk.green(`Set ${key} = ${key.includes('key') ? '***' : value}`));
        return;
      }

      console.error(chalk.red(`Unknown action: ${action}. Use "show" or "set".`));
      process.exit(1);
    });
}
