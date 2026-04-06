import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, basename } from 'path';
import { execSync } from 'child_process';

const CONFIG_DIR = '.claude-workflow';
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

/**
 * Detect project structure and cache results.
 * @param {string} rootDir - Project root directory
 * @param {boolean} force - Force re-detection even if cache exists
 * @returns {object} Project configuration
 */
export async function detectProject(rootDir, force = false) {
  const configPath = join(rootDir, CONFIG_FILE);

  if (!force && existsSync(configPath)) {
    try {
      return JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch {
      // Cache corrupted, re-detect
    }
  }

  const project = {
    type: detectGitStructure(rootDir),
    language: detectLanguage(rootDir),
    packageManager: detectPackageManager(rootDir),
    testRunner: detectTestRunner(rootDir),
    linter: detectLinter(rootDir),
    buildCommand: detectBuildCommand(rootDir),
    testCommand: detectTestCommand(rootDir),
    platform: detectPlatform(rootDir),
    baseBranch: detectBaseBranch(rootDir),
    monorepo: detectMonorepo(rootDir),
  };

  const config = {
    project,
    pipeline: {
      pre: { autoContext: false, enhance: true },
      post: ['review', 'confirm', 'fix', 'verify', 'commit'],
      preset: 'auto',
      scaling: { trivialThreshold: 3, largeThreshold: 10 },
      overrides: {},
    },
    enhance: {
      mode: 'confirm',
      injectProjectStructure: true,
      injectRules: true,
      injectRecentChanges: 5,
    },
    trigger: {
      autoPostWork: false,
      ignorePatterns: ['*.lock', 'node_modules/**', 'dist/**'],
    },
    review: {
      parallelReviewers: true,
      confidenceThreshold: 80,
      autoMode: false,
      maxFixRounds: 3,
      maxVerifyRetries: 2,
      circuitBreakerThreshold: 3,
      autoFixSeverity: ['HIGH', 'MEDIUM'],
      blockSeverity: ['CRITICAL'],
      reportSeverity: ['LOW'],
      reviewerMapping: buildDefaultReviewerMapping(),
      defaultReviewer: 'backend',
    },
    commit: {
      style: 'conventional',
      generateSummaryReport: true,
      autoPush: false,
      autoCreatePR: false,
    },
    rollback: {
      strategy: 'stash',
      autoCleanup: true,
    },
  };

  // Save to cache
  const dir = join(rootDir, CONFIG_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

  return config;
}

// --- Detection functions ---

function detectGitStructure(rootDir) {
  if (!existsSync(join(rootDir, '.git'))) return 'non-git';
  try {
    const gitDir = execSync('git rev-parse --git-dir', { cwd: rootDir, encoding: 'utf-8' }).trim();
    // bare repo with worktree: .git is a file pointing to the real git dir
    if (existsSync(join(rootDir, '.git')) && !existsSync(join(rootDir, '.git', 'HEAD'))) {
      return 'worktree';
    }
    return 'git-repo';
  } catch {
    return 'non-git';
  }
}

function detectLanguage(rootDir) {
  const indicators = [
    { file: 'package.json', lang: 'typescript', check: (r) => existsSync(join(r, 'tsconfig.json')) },
    { file: 'package.json', lang: 'javascript' },
    { file: 'go.mod', lang: 'go' },
    { file: 'Cargo.toml', lang: 'rust' },
    { file: 'pyproject.toml', lang: 'python' },
    { file: 'setup.py', lang: 'python' },
    { file: 'requirements.txt', lang: 'python' },
    { file: 'pom.xml', lang: 'java' },
    { file: 'build.gradle', lang: 'java' },
    { file: 'build.gradle.kts', lang: 'kotlin' },
  ];

  for (const { file, lang, check } of indicators) {
    if (existsSync(join(rootDir, file))) {
      if (check && check(rootDir)) return lang;
      if (!check) return lang;
    }
  }
  return null;
}

function detectPackageManager(rootDir) {
  if (existsSync(join(rootDir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(rootDir, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(rootDir, 'package-lock.json'))) return 'npm';
  if (existsSync(join(rootDir, 'bun.lockb'))) return 'bun';
  if (existsSync(join(rootDir, 'go.mod'))) return 'go';
  if (existsSync(join(rootDir, 'Cargo.toml'))) return 'cargo';
  if (existsSync(join(rootDir, 'pyproject.toml')) || existsSync(join(rootDir, 'requirements.txt'))) return 'pip';
  return null;
}

function detectTestRunner(rootDir) {
  // Check package.json scripts
  const pkg = readPackageJson(rootDir);
  if (pkg) {
    const scripts = pkg.scripts || {};
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps.vitest) return 'vitest';
    if (deps.jest) return 'jest';
    if (deps.mocha) return 'mocha';
  }

  // Config files
  if (existsSync(join(rootDir, 'vitest.config.ts')) || existsSync(join(rootDir, 'vitest.config.js'))) return 'vitest';
  if (existsSync(join(rootDir, 'jest.config.ts')) || existsSync(join(rootDir, 'jest.config.js'))) return 'jest';
  if (existsSync(join(rootDir, 'pytest.ini')) || existsSync(join(rootDir, 'pyproject.toml'))) {
    if (existsSync(join(rootDir, 'pyproject.toml'))) {
      try {
        const content = readFileSync(join(rootDir, 'pyproject.toml'), 'utf-8');
        if (content.includes('[tool.pytest')) return 'pytest';
      } catch { /* ignore */ }
    }
    if (existsSync(join(rootDir, 'pytest.ini'))) return 'pytest';
  }
  if (existsSync(join(rootDir, 'go.mod'))) return 'go-test';
  return null;
}

function detectLinter(rootDir) {
  const linters = [];
  const eslintFiles = ['.eslintrc', '.eslintrc.js', '.eslintrc.json', '.eslintrc.yml', 'eslint.config.js', 'eslint.config.mjs'];
  if (eslintFiles.some(f => existsSync(join(rootDir, f)))) linters.push('eslint');

  const prettierFiles = ['.prettierrc', '.prettierrc.js', '.prettierrc.json', 'prettier.config.js'];
  if (prettierFiles.some(f => existsSync(join(rootDir, f)))) linters.push('prettier');

  if (existsSync(join(rootDir, 'ruff.toml')) || existsSync(join(rootDir, '.ruff.toml'))) linters.push('ruff');
  if (existsSync(join(rootDir, '.golangci.yml')) || existsSync(join(rootDir, '.golangci.yaml'))) linters.push('golangci-lint');

  return linters.length > 0 ? linters.join(',') : null;
}

function detectBuildCommand(rootDir) {
  const pkg = readPackageJson(rootDir);
  if (pkg?.scripts?.build) return `${detectPackageManager(rootDir) || 'npm'} run build`;
  if (existsSync(join(rootDir, 'Makefile'))) return 'make build';
  if (existsSync(join(rootDir, 'go.mod'))) return 'go build ./...';
  if (existsSync(join(rootDir, 'Cargo.toml'))) return 'cargo build';
  return null;
}

function detectTestCommand(rootDir) {
  const pm = detectPackageManager(rootDir);
  const runner = detectTestRunner(rootDir);

  if (runner === 'jest' || runner === 'vitest' || runner === 'mocha') {
    const pkg = readPackageJson(rootDir);
    if (pkg?.scripts?.test) return `${pm || 'npm'} test`;
    return `npx ${runner}`;
  }
  if (runner === 'pytest') return 'pytest';
  if (runner === 'go-test') return 'go test ./...';
  return null;
}

function detectPlatform(rootDir) {
  try {
    const remoteUrl = execSync('git remote get-url origin', { cwd: rootDir, encoding: 'utf-8' }).trim();
    if (remoteUrl.includes('github.com')) return 'github';
    if (remoteUrl.includes('gitlab.com') || remoteUrl.includes('gitlab')) return 'gitlab';
    if (remoteUrl.includes('bitbucket.org') || remoteUrl.includes('bitbucket')) return 'bitbucket';
    return null;
  } catch {
    return null;
  }
}

function detectBaseBranch(rootDir) {
  try {
    const result = execSync('git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null || echo refs/remotes/origin/main', {
      cwd: rootDir, encoding: 'utf-8',
    }).trim();
    return basename(result);
  } catch {
    return 'main';
  }
}

function detectMonorepo(rootDir) {
  const pkg = readPackageJson(rootDir);
  if (pkg?.workspaces) return { type: 'workspaces', packages: pkg.workspaces };
  if (existsSync(join(rootDir, 'pnpm-workspace.yaml'))) return { type: 'pnpm-workspace' };
  if (existsSync(join(rootDir, 'lerna.json'))) return { type: 'lerna' };
  if (existsSync(join(rootDir, 'nx.json'))) return { type: 'nx' };
  return null;
}

function buildDefaultReviewerMapping() {
  return {
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
}

// --- Helpers ---

function readPackageJson(rootDir) {
  try {
    return JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8'));
  } catch {
    return null;
  }
}

// CLI entry point
if (process.argv[1] && process.argv[1].includes('detect-project')) {
  const rootDir = process.argv[2] || process.cwd();
  const force = process.argv.includes('--force');
  detectProject(rootDir, force).then(config => {
    console.log(JSON.stringify(config, null, 2));
  });
}
