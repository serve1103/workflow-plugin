/**
 * JSON schemas for pipeline state files.
 * Used by state-manager for runtime validation.
 */

export const schemas = {
  'run': {
    required: ['id', 'startTime', 'preset', 'scale', 'stages', 'status'],
    properties: {
      id: 'string',
      startTime: 'string',
      endTime: 'string',
      preset: 'string',
      scale: 'string',
      stages: 'object',
      status: 'string', // running | completed | failed | aborted
      activeReviewers: 'object',
      userChoices: 'object',
    },
  },

  'review': {
    required: ['issues', 'summary', 'activeReviewers'],
    properties: {
      issues: 'object', // array
      summary: 'object', // { critical, high, medium, low }
      activeReviewers: 'object', // string[]
      filteredCount: 'number',
    },
  },

  'fix': {
    required: ['fixedIssues', 'remainingIssues', 'rounds'],
    properties: {
      fixedIssues: 'object', // array
      remainingIssues: 'object', // array
      rounds: 'number',
      circuitBreakerTriggered: 'boolean',
      diagnosticReport: 'string',
    },
  },

  'verify': {
    required: ['overallPass'],
    properties: {
      lint: 'object', // { pass, output }
      typeCheck: 'object',
      build: 'object',
      test: 'object',
      overallPass: 'boolean',
    },
  },

  'commit': {
    required: ['commitHash', 'message'],
    properties: {
      commitHash: 'string',
      message: 'string',
      changedFiles: 'object', // string[]
      summaryReport: 'string',
    },
  },
};

/**
 * Validate data against a schema.
 * @param {string} stage - Schema name (review, fix, verify, commit, run)
 * @param {object} data - Data to validate
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validate(stage, data) {
  const schema = schemas[stage];
  if (!schema) return { valid: false, errors: [`Unknown schema: ${stage}`] };

  const errors = [];

  for (const field of schema.required) {
    if (data[field] === undefined || data[field] === null) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  for (const [field, expectedType] of Object.entries(schema.properties)) {
    if (data[field] !== undefined && data[field] !== null) {
      const actualType = typeof data[field];
      if (actualType !== expectedType) {
        errors.push(`Field "${field}" expected ${expectedType}, got ${actualType}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
