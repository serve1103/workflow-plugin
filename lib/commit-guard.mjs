/**
 * PreToolUse hook — warn if committing without review.
 * Matcher: "Bash" — script checks if command is git commit internally.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const REVIEW_STATE = join('.claude-workflow', 'state', 'review.json');

async function main() {
  try {
    const input = readStdin();
    if (!input) return emptyResponse();

    const payload = JSON.parse(input);

    // Check if this is a git commit command
    const command = payload?.tool_input?.command || '';
    if (!command.match(/git\s+commit/)) return emptyResponse();

    // Check if review has been run
    if (existsSync(REVIEW_STATE)) {
      try {
        const review = JSON.parse(readFileSync(REVIEW_STATE, 'utf-8'));
        if (review.issues && review.summary) return emptyResponse(); // Review exists, allow commit
      } catch {
        // Corrupted review file — warn
      }
    }

    // No review found — warn
    const output = {
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: '[workflow-plugin] Warning: Committing without review. Run `/flow review` first to check for issues, or proceed if intentional.',
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

main();
