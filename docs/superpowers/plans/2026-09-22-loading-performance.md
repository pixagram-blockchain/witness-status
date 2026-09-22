# Dashboard loading performance implementation plan

Goal: independent section updates, validated persistent block summaries, and a minified browser bundle with existing functionality preserved.

Architecture: extend the shared snapshot pipeline with immutable stage callbacks; keep the completed model separate from the provisional display. Persist only finalized summaries per node, require matching chain identity and a live anchor block before reuse. Keep GitHub Pages serving the repository root and check a committed deterministic esbuild bundle in CI.

Constraints: Node >=20; no runtime dependencies; preserve CLI, custom RPC, all metrics, controls, history and partial failure reporting. Commit and push only when explicitly requested by the user.

- [x] Add block-cache storage validation and tests for corrupt/expired data, finalized-only records, node separation and storage failure.
- [x] Extend snapshot tests and implementation for independent completion ordering, cached anchor validation, incompatible chains and reversible-tail refetch.
- [x] Update the UI controller: stage-specific rendering, interactive provisional model, completed-snapshot history only, cache loading/saving and stale node guards. Test progressive updates and existing config behavior.
- [x] Add pinned esbuild development dependency, deterministic build/check scripts, committed bundle and CI checks. Update documentation and HTML.
- [x] Run unit tests, bundle checks, live read-only smoke test, and source/bundle browser checks. Review the full diff and record measurements.
