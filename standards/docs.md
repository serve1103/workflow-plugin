# Documentation Review Standards

## Accuracy
- Code examples must match the actual codebase (function names, parameters, return types)
- API documentation reflects current endpoints, request/response shapes
- Version numbers and dependency references are up to date
- Links are not broken (internal cross-references and external URLs)

## Completeness
- Public APIs have documented parameters, return values, and examples
- Setup/installation steps are complete and ordered correctly
- Error scenarios and troubleshooting are covered
- Changelogs include all user-facing changes

## Consistency
- Terminology is used consistently throughout (no mixing "user/account/member" for same concept)
- Heading hierarchy is logical (H1 > H2 > H3, no skips)
- Code block language tags are correct (```typescript not ```ts for full examples)
- Date formats, naming conventions are uniform

## Clarity
- Sentences are concise — no unnecessary jargon or filler
- Steps are numbered when order matters, bulleted when it doesn't
- Abbreviations are defined on first use
- Target audience is appropriate (not too technical for user docs, not too basic for dev docs)

## Formatting
- Markdown renders correctly (tables, lists, code blocks)
- Images have alt text
- No trailing whitespace or excessive blank lines
- File follows project's markdown lint rules if defined
