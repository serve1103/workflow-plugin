/**
 * Custom stage loader.
 * Discovers and parses user-defined stages from .claude-workflow/stages/*.md
 * Validates frontmatter interface and makes stages available to the pipeline.
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, basename } from 'path';

const STAGES_DIR = join('.claude-workflow', 'stages');

const REQUIRED_FIELDS = ['name', 'description'];
const VALID_ON_FAILURE = ['skip', 'abort', 'ask'];

/**
 * Load all custom stages from .claude-workflow/stages/
 * @param {string} rootDir - Project root
 * @returns {{ stages: object[], errors: string[] }}
 */
export function loadCustomStages(rootDir = '.') {
  const stagesDir = join(rootDir, STAGES_DIR);
  if (!existsSync(stagesDir)) return { stages: [], errors: [] };

  const files = readdirSync(stagesDir).filter(f => f.endsWith('.md'));
  if (files.length === 0) return { stages: [], errors: [] };

  const stages = [];
  const errors = [];

  for (const file of files) {
    const filePath = join(stagesDir, file);
    const result = parseStageFile(filePath);

    if (result.error) {
      errors.push(`${file}: ${result.error}`);
    } else {
      stages.push(result.stage);
    }
  }

  return { stages, errors };
}

/**
 * Parse a single stage markdown file.
 * Extracts YAML frontmatter and validates required fields.
 * @param {string} filePath
 * @returns {{ stage?: object, error?: string }}
 */
function parseStageFile(filePath) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);

    if (!fmMatch) {
      return { error: 'No YAML frontmatter found' };
    }

    const frontmatter = parseFrontmatter(fmMatch[1]);
    const body = content.substring(fmMatch[0].length).trim();

    // Validate required fields
    for (const field of REQUIRED_FIELDS) {
      if (!frontmatter[field]) {
        return { error: `Missing required field: ${field}` };
      }
    }

    // Validate onFailure
    if (frontmatter.onFailure && !VALID_ON_FAILURE.includes(frontmatter.onFailure)) {
      return { error: `Invalid onFailure: ${frontmatter.onFailure}. Must be: ${VALID_ON_FAILURE.join(', ')}` };
    }

    return {
      stage: {
        name: frontmatter.name,
        description: frontmatter.description,
        model: frontmatter.model || 'sonnet',
        tools: frontmatter.tools || [],
        inputs: frontmatter.inputs || [],
        outputs: frontmatter.outputs || [],
        onFailure: frontmatter.onFailure || 'skip',
        instructions: body,
        sourcePath: filePath,
      },
    };
  } catch (err) {
    return { error: `Failed to read: ${err.message}` };
  }
}

/**
 * Simple YAML frontmatter parser (no external deps).
 * Handles: strings, arrays (inline [...] and multi-line -), booleans.
 */
function parseFrontmatter(yaml) {
  const result = {};
  const lines = yaml.split('\n');

  for (const line of lines) {
    const match = line.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
    if (!match) continue;

    const key = match[1].trim();
    let value = match[2].trim();

    // Inline array: [a, b, c]
    if (value.startsWith('[') && value.endsWith(']')) {
      value = value.slice(1, -1).split(',').map(v => v.trim()).filter(v => v);
    }
    // Boolean
    else if (value === 'true') value = true;
    else if (value === 'false') value = false;
    // Quoted string
    else if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

/**
 * Check if a stage name in the pipeline config is a custom stage.
 * Built-in stages: review, confirm, fix, verify, commit
 * @param {string} stageName
 * @returns {boolean}
 */
export function isCustomStage(stageName) {
  const builtIn = ['review', 'confirm', 'fix', 'verify', 'commit'];
  return !builtIn.includes(stageName);
}

/**
 * Find a loaded custom stage by name.
 * @param {object[]} stages - From loadCustomStages()
 * @param {string} name
 * @returns {object|null}
 */
export function findStage(stages, name) {
  return stages.find(s => s.name === name) || null;
}

// CLI entry point
if (process.argv[1] && process.argv[1].includes('custom-stages')) {
  const rootDir = process.argv[2] || '.';
  const { stages, errors } = loadCustomStages(rootDir);

  if (errors.length > 0) {
    console.log('Errors:');
    errors.forEach(e => console.log('  ✗', e));
  }

  if (stages.length > 0) {
    console.log('Loaded stages:');
    stages.forEach(s => console.log(`  ✓ ${s.name} (${s.model}) — ${s.description} [onFailure: ${s.onFailure}]`));
  } else {
    console.log('No custom stages found in', join(rootDir, STAGES_DIR));
  }
}
