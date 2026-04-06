# Backend Code Review Standards

## API Design
- REST endpoints use plural nouns (`/users`, `/orders`)
- Error responses never expose internal details (stack traces, SQL, file paths)
- All APIs return appropriate HTTP status codes (200/201/400/401/403/404/500)
- Request/response bodies have consistent shape (envelope pattern or direct)
- Pagination for list endpoints returning more than 20 items
- API versioning strategy is followed if present

## Error Handling
- Empty catch blocks are forbidden — minimum: log the error
- Async errors must be handled (no unhandled Promise rejections)
- External service calls must have timeout + retry strategy
- Error messages are user-friendly externally, detailed internally (logs)
- Errors propagate with appropriate context (no swallowing)

## Database Queries
- No database queries inside loops (N+1 problem) — use batch/join
- Transactions wrap related writes (atomic operations)
- Connection pooling is used (no per-request connections)
- Indexes exist for columns used in WHERE/JOIN/ORDER BY
- Raw SQL is parameterized (no string concatenation)
- Migrations are reversible (have down/rollback)

## Business Logic
- Business rules are in service layer (not controllers/routes)
- Input validation at system boundaries (controllers, API handlers)
- No duplicate business logic across endpoints
- Side effects (email, notifications) are separated from core logic
- State transitions follow defined rules (no impossible states)

## Performance
- Heavy operations are async/background (not blocking request)
- Caching strategy for frequently accessed, rarely changed data
- Response payloads are minimal (no over-fetching)
- File uploads have size limits
- Rate limiting on public endpoints

## Code Structure
- Single responsibility per function/class
- Dependencies are injected (not imported directly in business logic)
- Configuration via environment variables (no hardcoded values)
- Logging at appropriate levels (error/warn/info/debug)
- No magic numbers — use named constants
