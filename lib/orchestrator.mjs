import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { minimatch } from './minimatch.mjs';

/**
 * Deterministic orchestration logic.
 * No LLM calls — pure code for preset selection, scaling, reviewer routing.
 */

// --- Change analysis ---

/**
 * Analyze git diff to determine changed files and scale.
 * @param {string} rootDir
 * @returns {{ files: string[], additions: number, deletions: number, hasDeleted: boolean }}
 */
export function analyzeChanges(rootDir) {
  try {
    const stat = execSync('git diff --cached --stat --numstat', { cwd: rootDir, encoding: 'utf-8' }).trim();
    if (!stat) {
      // Try unstaged changes
      const unstaged = execSync('git diff --stat --numstat', { cwd: rootDir, encoding: 'utf-8' }).trim();
      return parseNumstat(unstaged);
    }
    return parseNumstat(stat);
  } catch {
    return { files: [], additions: 0, deletions: 0, hasDeleted: false };
  }
}

function parseNumstat(numstat) {
  const lines = numstat.split('\n').filter(l => l.trim());
  const files = [];
  let additions = 0;
  let deletions = 0;
  let hasDeleted = false;

  for (const line of lines) {
    const match = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
    if (match) {
      const add = match[1] === '-' ? 0 : parseInt(match[1], 10);
      const del = match[2] === '-' ? 0 : parseInt(match[2], 10);
      const file = match[3].trim();
      files.push(file);
      additions += add;
      deletions += del;
      if (del > 0 && add === 0) hasDeleted = true;
    }
  }

  return { files, additions, deletions, hasDeleted };
}

// --- Scale determination ---

/**
 * Determine pipeline scale based on change size.
 * @param {{ files: string[], additions: number, deletions: number, hasDeleted: boolean }} changes
 * @param {{ trivialThreshold: number, largeThreshold: number }} scaling
 * @returns {'trivial' | 'small' | 'normal' | 'large'}
 */
export function determineScale(changes, scaling = { trivialThreshold: 3, largeThreshold: 10 }) {
  const totalLines = changes.additions + changes.deletions;
  const fileCount = changes.files.length;

  if (totalLines <= scaling.trivialThreshold) return 'trivial';
  if (fileCount <= 3) return 'small';
  if (fileCount > scaling.largeThreshold || changes.hasDeleted) return 'large';
  return 'normal';
}

/**
 * Get pipeline stages for a given scale and preset.
 * @param {'trivial' | 'small' | 'normal' | 'large'} scale
 * @param {string} preset
 * @returns {string[]}
 */
export function getStagesForScale(scale, preset) {
  const presetStages = getPresetStages(preset);

  switch (scale) {
    case 'trivial':
      return ['review']; // Review only, no fix/verify/commit
    case 'small':
      return presetStages.filter(s => s !== 'fix'); // Skip fix for small changes
    case 'normal':
      return presetStages;
    case 'large':
      return presetStages; // Same as normal, but SKILL.md adds user confirmation gate
    default:
      return presetStages;
  }
}

// --- Preset selection ---

const PRESET_STAGES = {
  feature:  ['review', 'confirm', 'fix', 'verify', 'commit'],
  bugfix:   ['review', 'confirm', 'fix', 'verify', 'commit'],
  refactor: ['review', 'confirm', 'verify', 'commit'],
  docs:     ['review', 'commit'],
  security: ['review', 'confirm', 'fix', 'verify', 'commit'],
  custom:   null, // loaded from config
};

function getPresetStages(preset) {
  return PRESET_STAGES[preset] || PRESET_STAGES.feature;
}

/**
 * Auto-detect preset from changed files.
 * @param {string[]} files - Changed file paths
 * @param {object} overrides - Config overrides (path pattern → preset)
 * @returns {string}
 */
export function detectPreset(files, overrides = {}) {
  if (files.length === 0) return 'feature';

  // Check overrides first
  for (const [pattern, config] of Object.entries(overrides)) {
    const presetName = typeof config === 'string' ? config : config.preset;
    if (presetName && files.some(f => minimatch(f, pattern))) {
      return presetName;
    }
  }

  // Auto-detect by file patterns
  const allDocs = files.every(f => f.endsWith('.md') || f.startsWith('docs/'));
  if (allDocs) return 'docs';

  const hasSecurityFiles = files.some(f =>
    f.includes('/auth/') || f.includes('/crypto/') || f.includes('/security/')
  );
  if (hasSecurityFiles) return 'security';

  // Check if it's mostly renames/moves (refactor)
  const hasStructuralChange = files.some(f => f.includes('{') || f.includes('=>'));
  if (hasStructuralChange) return 'refactor';

  return 'feature';
}

// --- Reviewer selection ---

const DEFAULT_REVIEWER_MAPPING = {
  'docs/**/*': 'docs',
  '*.md': 'docs',
  'src/components/**/*': 'frontend',
  '*.tsx': 'frontend',
  '*.jsx': 'frontend',
  '*.vue': 'frontend',
  '*.css': 'frontend',
  '*.scss': 'frontend',
  'src/api/**/*': 'backend',
  'src/services/**/*': 'backend',
  'src/routes/**/*': 'backend',
  'migrations/**/*': 'data',
  '*.sql': 'data',
  'prisma/**/*': 'data',
  'src/auth/**/*': 'security',
  'src/crypto/**/*': 'security',
};

/**
 * Select reviewers based on changed files.
 * @param {string[]} files
 * @param {object} mapping - Path pattern → reviewer name
 * @param {string} defaultReviewer
 * @returns {string[]} - Unique reviewer names
 */
export function selectReviewers(files, mapping = DEFAULT_REVIEWER_MAPPING, defaultReviewer = 'backend') {
  const reviewers = new Set();

  for (const file of files) {
    let matched = false;
    for (const [pattern, reviewer] of Object.entries(mapping)) {
      if (minimatch(file, pattern)) {
        reviewers.add(reviewer);
        matched = true;
      }
    }
    if (!matched) {
      reviewers.add(defaultReviewer);
    }
  }

  // Security preset always includes security reviewer
  if (reviewers.size === 0) reviewers.add(defaultReviewer);

  return [...reviewers];
}

// --- Review result deduplication ---

/**
 * Deduplicate issues from multiple reviewers.
 * Same file + line → keep higher severity.
 * @param {object[]} issues - Combined issues from all reviewers
 * @returns {object[]}
 */
export function deduplicateIssues(issues) {
  const severityOrder = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
  const map = new Map();

  for (const issue of issues) {
    const key = `${issue.file}:${issue.line}`;
    const existing = map.get(key);

    if (!existing || (severityOrder[issue.severity] || 0) > (severityOrder[existing.severity] || 0)) {
      map.set(key, issue);
    }
  }

  return [...map.values()];
}

/**
 * Filter issues by confidence threshold.
 * @param {object[]} issues
 * @param {number} threshold
 * @returns {{ passed: object[], filtered: number }}
 */
export function filterByConfidence(issues, threshold = 80) {
  const passed = issues.filter(i => (i.confidence || 0) >= threshold);
  return { passed, filtered: issues.length - passed.length };
}

// --- Full orchestration ---

/**
 * Run full deterministic orchestration.
 * Returns all decisions needed by SKILL.md to call agents.
 * @param {string} rootDir
 * @param {object} config - From .claude-workflow/config.json
 * @returns {object}
 */
export function orchestrate(rootDir, config = {}) {
  const changes = analyzeChanges(rootDir);
  const pipeline = config.pipeline || {};
  const reviewConfig = config.review || {};

  const scale = determineScale(changes, pipeline.scaling);
  const preset = pipeline.preset === 'auto'
    ? detectPreset(changes.files, pipeline.overrides)
    : pipeline.preset || 'feature';

  const stages = pipeline.post && Array.isArray(pipeline.post)
    ? pipeline.post
    : getStagesForScale(scale, preset);

  const reviewers = selectReviewers(
    changes.files,
    reviewConfig.reviewerMapping || DEFAULT_REVIEWER_MAPPING,
    reviewConfig.defaultReviewer || 'backend'
  );

  return {
    changes: {
      files: changes.files,
      fileCount: changes.files.length,
      additions: changes.additions,
      deletions: changes.deletions,
      hasDeleted: changes.hasDeleted,
    },
    scale,
    preset,
    stages,
    reviewers,
    requiresConfirmation: scale === 'large',
  };
}

// CLI entry point
if (process.argv[1] && process.argv[1].includes('orchestrator')) {
  const rootDir = process.argv[2] || process.cwd();
  let config = {};
  const configPath = join(rootDir, '.claude-workflow', 'config.json');
  if (existsSync(configPath)) {
    try { config = JSON.parse(readFileSync(configPath, 'utf-8')); } catch { /* ignore */ }
  }
  const result = orchestrate(rootDir, config);
  console.log(JSON.stringify(result, null, 2));
}
