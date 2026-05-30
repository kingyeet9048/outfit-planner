# AI Agent Rules

These rules apply to all Codex work in this repository.

## Branching and PRs

- Do not push directly to `main`. Direct pushes are blocked.
- Create or use a feature branch for every change set.
- Produce a pull request for every change set and keep the PR scoped to the requested work.

## Required Tests

- Every PR must include UI and E2E test coverage for the changed behavior.
- When changing existing behavior, update or add tests that protect the current expected functionality as well as the new path.
- Run the relevant local test suite before opening a PR and include the verification in the PR notes.

## Human Computer Interaction

- Evaluate all feature and UI changes through Human Computer Interaction principles.
- Consider usability, accessibility, consistency, discoverability, feedback, error prevention, recovery paths, cognitive load, and mobile/touch ergonomics.
- Preserve existing workflows unless the requested change intentionally improves them.

## Production Update Cache

- For every PR or production-facing change, bump the service worker cache version in `service-worker.js`.
- Keep the cache version change with the feature/fix so deployed updates reach existing production devices.
