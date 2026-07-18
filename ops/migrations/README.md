# Production migrations

Migrations are structured data, never SQL supplied through MCP. The root worker accepts only `create_index` on its fixed schema/table/column target allowlist, derives and validates the index name, generates both transactional directions itself, and checks the manifest digest from an immutable CI-passing commit.

Before production, the worker creates and verifies a fresh off-VM dump, restores it into a disposable database, runs up and down, and requires exact schema and data fingerprints after the inverse. It then applies the additive index transactionally. Cancellation, failure, or crash recovery removes only that worker-derived index and verifies the original fingerprint. The first release contains no data-changing or arbitrary SQL capability.
