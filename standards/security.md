# Security Review Standards

## OWASP Top 10

### Injection (A03)
- All database queries use parameterized statements (no string concatenation)
- User input in shell commands is escaped or avoided entirely
- Template engines auto-escape output by default
- LDAP, XML, and OS command injection vectors are covered

### XSS — Cross-Site Scripting (A07)
- User-generated content is sanitized before rendering
- innerHTML / dangerouslySetInnerHTML usage is justified and sanitized
- CSP (Content Security Policy) headers are configured
- URL parameters are not reflected into HTML without encoding

### CSRF — Cross-Site Request Forgery
- State-changing requests require CSRF tokens
- SameSite cookie attribute is set (Lax or Strict)
- Custom headers required for API calls from browsers

### Broken Authentication (A07)
- Passwords are hashed with bcrypt/argon2 (not MD5/SHA1)
- Session tokens are cryptographically random and sufficient length
- Login has rate limiting / account lockout
- Password reset tokens expire within reasonable time (1 hour max)
- Multi-factor authentication is available for sensitive operations

### Broken Access Control (A01)
- Authorization checks on every protected endpoint (not just frontend)
- Resource access verified against authenticated user's permissions
- IDOR (Insecure Direct Object Reference) prevented — validate ownership
- Admin endpoints are not accessible by regular users
- Principle of least privilege applied

## Secrets Management
- No hardcoded API keys, passwords, tokens, or connection strings in code
- Secrets loaded from environment variables or secret manager
- .env files are in .gitignore
- No secrets in log output (mask sensitive fields)
- Secrets are rotatable without code changes

## Input Validation
- All external input validated at system boundary (type, format, range)
- File uploads validated: type, size, content (not just extension)
- URL redirects validated against allowlist (prevent open redirect)
- JSON/XML payloads validated against schema before processing
- Integer overflow and boundary conditions checked

## Cryptography
- Use standard libraries (no custom crypto implementations)
- TLS 1.2+ for all network communication
- Encryption keys are not hardcoded or logged
- JWT tokens have appropriate expiry and are validated properly
- Sensitive data encrypted at rest (PII, financial data)

## Logging & Monitoring
- Authentication events are logged (success and failure)
- Authorization failures are logged with context
- No sensitive data in logs (passwords, tokens, PII)
- Log injection prevented (newlines and control characters escaped)
- Security-relevant events trigger alerts

## Dependency Security
- Dependencies are from trusted sources
- Known vulnerabilities checked (npm audit, safety, cargo audit)
- Dependency versions are pinned (lockfile committed)
- No unnecessary dependencies (minimize attack surface)
