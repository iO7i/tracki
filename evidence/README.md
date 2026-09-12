# Generated evidence archive

Operational harness output is intentionally ignored by Git because it contains
run timestamps and environment-specific measurements. Keep each run under a
named directory, preserve its `manifest.json`, and attach or copy the directory
to an approved evidence store when a result is used in a release decision.

Generators and schemas live in `bench/operations/`; commands are documented in
`docs/OPERATIONS.md`. Native SDK evidence is produced by the named jobs in
`.github/workflows/native.yml`; archive the workflow run URL and downloaded
artifacts under `evidence/sdk-verification/<run-id>/` when a supported runner
has completed successfully.
