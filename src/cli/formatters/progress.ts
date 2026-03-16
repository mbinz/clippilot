import cliProgress from 'cli-progress';
import chalk from 'chalk';

export function createProgressBar(label: string): cliProgress.SingleBar {
  return new cliProgress.SingleBar({
    format: `${chalk.cyan(label)} |${chalk.cyan('{bar}')}| {percentage}% | {value}/{total} | {filename}`,
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true,
    clearOnComplete: false,
  });
}
