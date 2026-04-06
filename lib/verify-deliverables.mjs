/**
 * SubagentStop hook — verify that subagent produced expected deliverables.
 * Checks if state/*.json files exist and have valid schema after agent completes.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const STATE_DIR = join('.claude-workflow', 'state');

const EXPECTED_OUTPUTS = {
  'reviewer-backend': 'review.json',
  'reviewer-frontend': 'review.json',
  'reviewer-docs': 'review.json',
  'reviewer-data': 'review.json',
  'reviewer-security': 'review.json',
  'fixer': 'fix.json',
  'verifier': 'verify.json',
  'committer': 'commit.json',
};

async function main() {
  try {
    const input = readStdin();
    if (!input) return emptyResponse();

    const payload = JSON.parse(input);
    const agentName = payload?.agent_name || payload?.name || '';

    // Check if this agent has expected output
    const expectedFile = EXPECTED_OUTPUTS[agentName];
    if (!expectedFile) return emptyResponse(); // Not a pipeline agent, skip

    const filePath = join(STATE_DIR, expectedFile);

    // Note: The orchestrator (SKILL.md) writes state files, not agents directly.
    // This hook checks if the orchestrator has written the file after processing
    // the agent's response. If not, it provides a reminder.
    //
    // Since the orchestrator writes state AFTER processing the agent response,
    // the file may not exist yet at SubagentStop time. This is expected.
    // We only warn if the file exists but is malformed.

    if (existsSync(filePath)) {
      try {
        const data = JSON.parse(readFileSync(filePath, 'utf-8'));
        if (!data || Object.keys(data).length === 0) {
          return warnResponse(`[workflow-plugin] Warning: ${expectedFile} exists but is empty. The orchestrator may need to re-process ${agentName}'s output.`);
        }
      } catch {
        return warnResponse(`[workflow-plugin] Warning: ${expectedFile} exists but is not valid JSON. The orchestrator should re-write it.`);
      }
    }

    return emptyResponse();
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

function warnResponse(message) {
  process.stdout.write(JSON.stringify({
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'SubagentStop',
      additionalContext: message,
    },
  }));
}

main();
