## Change Summary

### What changed
{{#each changedFiles}}
- {{this.file}}: {{this.description}}
{{/each}}

### Why
{{reason}}

### Auto-fixed items
{{#each fixedIssues}}
- [{{this.severity}}] {{this.message}} in {{this.file}}:{{this.line}} → {{this.fix}}
{{/each}}

### Remaining issues (unfixed)
{{#each remainingIssues}}
- [{{this.severity}}] {{this.message}} in {{this.file}}:{{this.line}} — {{this.reason}}
{{/each}}

### Verification
- Lint: {{lint.status}}
- TypeCheck: {{typeCheck.status}}
- Build: {{build.status}}
- Tests: {{test.status}}
