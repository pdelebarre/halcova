# PostgreSQL migrations

Use for schema and database initialization changes.

## Rules

- Make migrations ordered, repeatable where appropriate and reviewable.
- Use least-privilege roles.
- Keep application and migration privileges separate.
- Add tenant IDs and version columns to synchronizable tenant-owned entities.
- Review foreign keys, uniqueness and indexes.
- Define rollback or forward-fix strategy.
- Test initialization and migrations in clean and upgrade databases.
- Never commit production credentials.
