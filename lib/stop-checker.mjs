/**
 * Stop hook — check for uncommitted changes and suggest pipeline execution.
 * Fires when Claude finishes responding.
 * Only active when trigger.autoPostWork is true.
 */

import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';

const CONFIG_PATH = join('.claude-workflow', 'config.json');

async function main() {
  try {
    const input = readStdin();
    if (!input) return emptyResponse();

    // Check if auto post-work is enabled
    const config = loadConfig();
    if (!config?.trigger?.autoPostWork) return emptyResponse();

    // Check for file changes
    const hasChanges = checkForChanges(config);
    if (!hasChanges) return emptyResponse();

    // Suggest pipeline execution
    const output = {
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'Stop',
        additionalContext: '[workflow-plugin] Changes detected. Run `/flow post` to review, verify, and commit your changes.',
      },
    };

    process.stdout.write(JSON.stringify(output));
  } catch {
    emptyResponse();
  }
}

function readStdin() {
  try { return readFileSync('/dev/stdin', 'utf-8'); } catch {
    try { return readFileSync(0, 'utf-8'); } catch { return null; }
  }
}

function emptyResponse() {
  process.stdout.write(JSON.stringify({ continue: true }));
}

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) return null;
  try { return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')); } catch { return null; }
}

function checkForChanges(config) {
  try {
    const ignorePatterns = config?.trigger?.ignorePatterns || [];
    const diff = execSync('git diff --name-only', { encoding: 'utf-8', timeout: 2000 }).trim();
    const staged = execSync('git diff --cached --name-only', { encoding: 'utf-8', timeout: 2000 }).trim();

    const allFiles = [...diff.split('\n'), ...staged.split('\n')].filter(f => f.trim());
    if (allFiles.length === 0) return false;

    // Filter out ignored patterns
    const meaningful = allFiles.filter(f => !ignorePatterns.some(p => f.includes(p.replace('**/', '').replace('/**', ''))));
    return meaningful.length > 0;
  } catch {
    return false;
  }
}

main();
