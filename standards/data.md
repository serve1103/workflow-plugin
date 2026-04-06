# DA/Data Review Standards

## Schema Design
- Tables use appropriate data types (don't store numbers as strings)
- Primary keys are defined on every table
- Foreign keys have referential integrity constraints
- Nullable columns are intentional (prefer NOT NULL with defaults)
- Column names follow consistent convention (snake_case or camelCase, not mixed)
- Enum-like values use CHECK constraints or reference tables

## Normalization & Relationships
- No redundant data storage (normalize to 3NF unless denormalized for performance with justification)
- Many-to-many relationships use junction tables
- One-to-many relationships have foreign keys on the "many" side
- Polymorphic associations are avoided (prefer separate tables or STI)

## Query Optimization
- Queries hitting indexed columns in WHERE/JOIN/ORDER BY
- No SELECT * in production code — specify needed columns
- EXPLAIN/EXPLAIN ANALYZE reviewed for queries on large tables
- Subqueries replaced with JOINs where more efficient
- Pagination uses cursor-based (keyset) for large datasets, offset for small
- Aggregations don't scan full tables without WHERE filters

## Indexing
- Foreign key columns are indexed
- Composite indexes match query patterns (leftmost prefix rule)
- Partial indexes for frequently filtered subsets
- No duplicate or redundant indexes
- Index-only scans are leveraged where possible

## Migration Safety
- Migrations are reversible (have explicit rollback/down)
- No data-destructive operations without backup plan
- Large table alterations use online DDL or phased approach
- New NOT NULL columns have default values (avoid full table lock)
- Schema changes are backward compatible with running application
- Migration order is deterministic (timestamped filenames)

## Data Integrity
- Unique constraints on business-unique fields (email, slug)
- CHECK constraints for value ranges and formats
- Cascading deletes are intentional and documented
- Soft delete preferred over hard delete for audit-critical data
- Timestamps (created_at, updated_at) on all mutable tables

## Security
- Sensitive data (PII, passwords) is encrypted at rest
- Row-level security (RLS) for multi-tenant data
- Database credentials are not hardcoded
- Query parameters are always parameterized (no SQL string concatenation)
- Audit logging for sensitive data access
