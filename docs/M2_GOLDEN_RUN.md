# M2 source-to-draft golden run

Date: 2026-07-26  
Linear issue: MED-153  
Project: `kx7etfyvj1mv6k4v91kjsfa3qs8b894k`

## Result

The M2 source-to-draft workflow completed through the real application routes.
The browser created one channel-owned project, added one URL source and one
uploaded file source, imported and revised a script, generated narration from
the current script, saved two timed semantic beats, and built an immutable
component composition.

The first beat was assigned manually to
`animated-bar-graph@1.1.0`. The editing agent proposed
`animated-line-chart@1.10.0` for the second beat; the creator accepted it after
review. Preview seeking exercised both beat ranges against the pinned narration
clock.

## Proposal and failure evidence

Three editing-agent proposals were exercised:

| Request                       | Result                       | Attempts | Input / output tokens |
| ----------------------------- | ---------------------------- | -------: | --------------------: |
| Put a chart on beat 2         | Accepted as composition v2   |        1 |               7 / 270 |
| Put a chart on missing beat 9 | Invalid; v2 remained current |        1 |                6 / 14 |
| Slow this chart down          | Accepted as composition v3   |        1 |               5 / 273 |

The final request produced a reviewable `set_inputs` patch against the exact
`animated-bar-graph@1.1.0` instance. Acceptance changed `durationPerBar` from
24 to 36 without changing the pinned component version. No proposal needed a
repair attempt, and the deliberately invalid proposal did not publish a
composition.

## Render evidence

Both full-project renders used the same four-second narration and completed as
640×360 H.264/AAC MP4 files:

| Composition              | Wall time |  Bytes | SHA-256                                                            |
| ------------------------ | --------: | -----: | ------------------------------------------------------------------ |
| v2, before pacing change |  5,489 ms | 36,647 | `0d170a543ac7b4c55abb24042835a7995534425f00f843e6820c750edfad7a0b` |
| v3, after pacing change  |  5,512 ms | 36,253 | `fa18b96cbbde07528e3bb457cfcda14dad21858414d4f6ed1fee7d47d6d27a55` |

The older v2 output remained downloadable after v3 completed. The different
content hashes prove that the accepted pacing change produced a new output,
while the immutable composition and render pins keep both results reproducible.

## Explicit real-model dogfood

Thread `loop-3302e784-47bc-4dc0-a6d8-3a69af779285` ran with the configured
`openai-codex/gpt-5.4-mini` provider. Relay created, independently validated,
previewed, and then approved `golden-telemetry-card@1.0.0` without a developer
editing generated source.

- Dialogue: 1,765 input, 255 output, estimated $0.00247125.
- Authoring: five model turns; 31,132 input, 2,096 output, 30,720 cached-input
  tokens; estimated $0.035085; 35,924 ms.
- Validation: six checks passed; source hash
  `64c5c54e1434dab8b2c683e9522305e7b21f9b11e6722ecc4bc9e41ad2d1a03b`.
- Review: default, large-change, and equal-value fixtures were exposed in the
  browser before explicit approval.

A stale OAuth credential was also exercised. The first provider transport
failure became a visible failed conversation message rather than a false
zero-token success; a current server-only credential then completed the run.

## Residual limitations before M3

- Authentication still uses a private-development identity bootstrap. The
  membership authorization boundary exists, but invitations and external
  identity UI do not.
- URL sources preserve a safe canonical reference and fingerprint; Relay does
  not yet extract claims, citations, or article content.
- The historical generated narration result is not a production integration.
  Current narration requires a configured provider and server-side credentials;
  uploaded narration is probed and versioned, but voice selection, mixing, and
  alignment refinement are not productized.
- Project editing proposals intentionally support a small set of bounded
  commands. They are not yet a general-purpose model editing session.
- Draft rendering is a single reduced-priority local worker at 640×360 with
  serial frame capture and H.264/AAC output. There is no render farm, cloud
  isolation, caching, subtitle burn-in, or final-quality preset yet.
- The approved component library is sufficient for this workflow but still has
  few visual families. Some valid schema-derived default inputs intentionally
  render an empty state until the creator supplies project data.
- Collaboration is represented by channels and memberships, but review
  comments, invitations, presence, and public review links remain M3 or later.
