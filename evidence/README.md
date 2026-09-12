# Generated evidence archive

Operational harness output is intentionally ignored by Git because it contains
run timestamps and environment-specific measurements. Keep each run under a
named directory, preserve its `manifest.json`, and attach or copy the directory
to an approved evidence store when a result is used in a release decision.

Generators and schemas live in `bench/operations/`; commands are documented in
`docs/OPERATIONS.md`. Run `pnpm ops:index` after a verification run to create a
metadata-only `evidence/index.json` listing every manifest without copying raw
payloads. Native SDK evidence is produced by the named jobs in
`.github/workflows/native.yml`; archive the workflow run URL and downloaded
artifacts under `evidence/sdk-verification/<run-id>/` when a supported runner
has completed successfully.

Retention: keep the raw artifact, its sidecar `manifest.json` (or
`*.manifest.json`), the generated index, the exact Git SHA, the command line,
the environment metadata, and the CI run URL together in a named run
directory. Do not retain API keys, raw customer payloads, provider responses,
or unredacted logs in the evidence archive. If a result informs a release or
incident decision, copy the named directory to the approved durable evidence
store before deleting the local checkout.
