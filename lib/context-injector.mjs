/**
 * UserPromptSubmit hook — lightweight context injection.
 * Reads the user's prompt, detects keywords/file paths,
 * and injects project context as a system-reminder.
 *
 * MUST complete within 3 seconds.
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname, basename } from 'path';
import { execSync } from 'child_process';

const CONFIG_PATH = join('.claude-workflow', 'config.json');
const RULES_DIR = join('.claude', 'rules');

async function main() {
  try {
    // Read hook payload from stdin
    const input = readStdin();
    if (!input) return emptyResponse();

    const payload = JSON.parse(input);
    const prompt = payload?.prompt || payload?.content || '';
    if (!prompt) return emptyResponse();

    // Check if auto context is enabled
    const config = loadConfig();
    if (!config?.pipeline?.pre?.autoContext) return emptyResponse();

    // Build context
    const context = buildContext(prompt, config);
    if (!context) return emptyResponse();

    // Output system-reminder
    const output = {
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: context,
      },
    };

    process.stdout.write(JSON.stringify(output));
  } catch {
    // Never block the prompt — fail silently
    emptyResponse();
  }
}

function readStdin() {
  try {
    return readFileSync('/dev/stdin', 'utf-8');
  } catch {
    try {
      return readFileSync(0, 'utf-8');
    } catch {
      return null;
    }
  }
}

function emptyResponse() {
  process.stdout.write(JSON.stringify({ continue: true }));
}

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

function buildContext(prompt, config) {
  const parts = [];

  // 1. Project structure summary
  if (config?.project) {
    const p = config.project;
    const info = [p.language, p.packageManager, p.testRunner, p.linter].filter(Boolean).join(', ');
    if (info) {
      parts.push(`[Project] ${info}`);
    }
  }

  // 2. Detect file paths mentioned in prompt
  const mentionedFiles = extractFilePaths(prompt);
  if (mentionedFiles.length > 0) {
    const relatedFiles = findRelatedFiles(mentionedFiles);
    if (relatedFiles.length > 0) {
      parts.push(`[Related files] ${relatedFiles.join(', ')}`);
    }
  }

  // 3. Load .claude/rules/ summaries
  const rules = loadRules();
  if (rules) {
    parts.push(`[Project rules] ${rules}`);
  }

  // 4. Recent git changes
  const recentChanges = getRecentChanges(config?.enhance?.injectRecentChanges || 5);
  if (recentChanges) {
    parts.push(`[Recent changes]\n${recentChanges}`);
  }

  if (parts.length === 0) return null;
  return parts.join('\n\n');
}

function extractFilePaths(prompt) {
  // Match common file path patterns
  const patterns = [
    /(?:^|\s)((?:src|lib|app|pages|components|services|api|routes|utils|hooks|models|types|config)\/[\w./-]+)/g,
    /(?:^|\s)([\w-]+\.(?:ts|tsx|js|jsx|py|go|rs|java|sql|md|json|yaml|yml|toml))/g,
  ];

  const files = new Set();
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(prompt)) !== null) {
      files.add(match[1].trim());
    }
  }
  return [...files];
}

function findRelatedFiles(files) {
  const related = new Set();

  for (const file of files) {
    const dir = dirname(file);
    if (dir === '.') continue;

    // Find siblings in same directory (quick ls, no deep search)
    try {
      const siblings = execSync(`ls "${dir}" 2>/dev/null`, { encoding: 'utf-8', timeout: 1000 })
        .trim()
        .split('\n')
        .filter(f => f && f !== basename(file))
        .slice(0, 5); // Max 5 siblings

      for (const sib of siblings) {
        related.add(join(dir, sib));
      }
    } catch {
      // Directory doesn't exist or timeout — skip
    }
  }

  return [...related].slice(0, 10); // Max 10 related files
}

function loadRules() {
  if (!existsSync(RULES_DIR)) return null;

  try {
    const files = execSync(`ls "${RULES_DIR}" 2>/dev/null`, { encoding: 'utf-8', timeout: 500 })
      .trim()
      .split('\n')
      .filter(f => f.endsWith('.md') || f.endsWith('.txt'));

    if (files.length === 0) return null;

    // Read first 200 chars of each rule file (keep it light)
    const summaries = [];
    for (const file of files.slice(0, 3)) {
      try {
        const content = readFileSync(join(RULES_DIR, file), 'utf-8').substring(0, 200);
        summaries.push(`${file}: ${content.split('\n')[0]}`);
      } catch {
        // skip
      }
    }
    return summaries.join('; ');
  } catch {
    return null;
  }
}

function getRecentChanges(count) {
  try {
    return execSync(`git log --oneline -${count} 2>/dev/null`, {
      encoding: 'utf-8',
      timeout: 1000,
    }).trim();
  } catch {
    return null;
  }
}

main();
