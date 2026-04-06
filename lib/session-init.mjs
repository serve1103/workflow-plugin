/**
 * SessionStart hook — detect uncommitted changes and load config.
 * Suggests pipeline execution if there are pending changes.
 * Also detects interrupted pipeline runs for resume.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const CONFIG_PATH = join('.claude-workflow', 'config.json');
const CURRENT_RUN = join('.claude-workflow', 'state', 'current-run.json');

async function main() {
  try {
    const input = readStdin();
    if (!input) return emptyResponse();

    const messages = [];

    // 1. Check for uncommitted changes
    const uncommitted = checkUncommitted();
    if (uncommitted) {
      messages.push(`Uncommitted changes detected (${uncommitted} files). Use \`/flow post\` to review and commit.`);
    }

    // 2. Check for interrupted pipeline run
    const interrupted = checkInterruptedRun();
    if (interrupted) {
      messages.push(`Interrupted pipeline run found (started ${interrupted}). Use \`/flow post\` to resume or \`/flow rollback\` to undo.`);
    }

    // 3. Check if config exists (first run detection)
    if (!existsSync(CONFIG_PATH)) {
      messages.push('No workflow config found. Run `/flow config` or `/flow post` to auto-detect project structure.');
    }

    if (messages.length === 0) return emptyResponse();

    const output = {
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: '[workflow-plugin] ' + messages.join(' | '),
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

function checkUncommitted() {
  try {
    const status = execSync('git status --porcelain', { encoding: 'utf-8', timeout: 2000 }).trim();
    if (!status) return null;
    const files = status.split('\n').filter(l => l.trim());
    return files.length > 0 ? files.length : null;
  } catch {
    return null;
  }
}

function checkInterruptedRun() {
  if (!existsSync(CURRENT_RUN)) return null;
  try {
    const pointer = JSON.parse(readFileSync(CURRENT_RUN, 'utf-8'));
    if (!pointer.runId) return null;

    const runFile = join('.claude-workflow', 'state', `run-${pointer.runId}.json`);
    if (!existsSync(runFile)) return null;

    const run = JSON.parse(readFileSync(runFile, 'utf-8'));
    if (run.status === 'running') {
      return run.startTime;
    }
    return null;
  } catch {
    return null;
  }
}

main();
