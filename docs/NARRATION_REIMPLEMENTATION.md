# Narration reimplementation plan

Status: proposed M3 architecture and delivery plan.

## Problem

Relay currently treats a script version, the text to be spoken, generated or
uploaded audio, timing, and the production timeline as one narration concept.
That boundary is not sufficient for real productions.

Project `n172xayxmnd74k247hec4knn218b87n2` demonstrates the failure:

- script version 1 contains 34,340 characters and approximately 5,043 words;
- the document includes production metadata, headings, 27 visual directions,
  and a narrator label alongside the spoken prose;
- two duplicate `relay-synthetic-test/deterministic-wave-v1` narration versions were
  generated from the complete Markdown document;
- each result was compressed into 119,981 milliseconds with 156 synthetic
  timing segments;
- the approximately 4,568 words that are candidates for narration would take
  roughly 30.5 minutes at 150 words per minute;
- no beats, compositions, or draft renders depend on either synthetic test narration
  version.

The existing synthetic output is useful as deterministic test infrastructure,
but it must not be presented as production narration or become authoritative
production timing.

## Current information flow

```text
immutable Markdown script version
  -> narration job pins scriptVersionId
  -> worker receives the complete raw Markdown
  -> punctuation and blank-line splitting
  -> all segments compressed to a two-minute maximum
  -> deterministic sine-wave WAV
  -> narrationVersions record with audio, duration, and synthetic timing
  -> project.currentNarrationVersionId
  -> beats pin narrationVersionId
  -> compositions pin narrationVersionId
  -> draft renders use the pinned audio and duration
```

This flow incorrectly includes titles, production metadata, headings,
`NARRATOR:`, and `[VISUAL: ...]` directions in the text described as spoken
narration. The resulting duration then constrains every downstream timeline.

## Product boundary

Replace the `Voice` production stage with a `Narration` workspace. A producer
may narrate the video personally, work with a human narrator, record inside
Relay later, upload a recording made elsewhere, or optionally use synthetic
speech. None of those performance sources defines the production artifact.

The new flow is:

```text
script version
  -> reviewable narration plan
  -> approved narration plan version
  -> human recording, uploaded take, or synthetic performance
  -> word-level alignment and producer review
  -> immutable editing-ready narration track
  -> semantic beats
  -> composition
  -> render
```

### Narration plan

A narration plan is an immutable, reviewable selection of what should be
spoken. It pins one exact immutable script version and contains ordered cues.

Each spoken cue records:

- stable order;
- exact source offsets into the pinned script;
- the exact text to synthesize or align;
- optional narrator or speaker role;
- optional pace, emphasis, pronunciation, and pause instructions;
- inclusion state and provenance.

The initial proposal should use deterministic Markdown parsing to exclude
headings, metadata, separators, visual directions, and speaker labels.
Model-assisted extraction may propose resolutions for ambiguous documents, but
it must not silently publish a plan.

The producer can include, exclude, split, merge, reorder, and edit proposed
spoken cues without mutating the pinned script. Relay displays spoken word
count and estimated duration before recording, assigning, or generating a
performance. Explicit approval publishes an immutable plan version.

Source offsets remain stable because a plan pins an immutable script version.
The plan also retains the exact synthesized text because pronunciation or
delivery edits may intentionally differ from the display script.

### Narrators and performance sources

The narration plan does not require a synthetic voice profile. A performance
source is selected only when producing audio and may be:

- a recording by the producer;
- a recording by another human narrator;
- a future in-Relay recording session;
- an externally recorded upload;
- optional synthetic speech.

Relay may keep channel-scoped narrator profiles for credits, language,
pronunciation guidance, and reusable delivery preferences. Human profiles do
not contain provider identifiers. Synthetic configuration is an optional,
separate profile that pins the provider voice and generation settings.

Provider credentials remain worker-only. Human narration remains a complete
first-class workflow when no synthetic provider is configured.

### Narration track

An audio take pins an approved narration-plan version and records its source:
human upload, future in-app recording, or synthetic generation. Synthetic work
also pins its optional provider configuration.

For synthetic speech, the worker may generate one bounded audio artifact per
spoken cue, probe the result independently, and assemble the exact cue sequence
into a take. This allows one cue to be regenerated without replacing or paying
for the entire track. A human narrator may instead provide one continuous file
or multiple takes.

Every source then passes through the same alignment boundary. Relay aligns the
actual audio against the approved spoken cues, presents uncertain matches and
deviations for review, and publishes a track only after its timing is valid.

An immutable narration-track version records:

- approved narration-plan version;
- assembled audio storage reference and content hash;
- actual probed duration and audio metadata;
- cue-level start and end timing;
- word-level start and end timing across the complete spoken performance;
- the relationship between every timed word and its cue and script text;
- omissions, insertions, and substitutions made in the actual performance;
- alignment confidence and producer corrections;
- performance source and narrator attribution;
- provider, model, and generation settings only for synthetic speech;
- applicable usage, cost, and wall time;
- terminal state and evidence for every cue.

Word timing is an editing contract, not optional provider metadata. When a
speech provider does not return usable word timing, Relay runs the resulting
audio through the same alignment path used for human narration.

There is no arbitrary two-minute production limit. Limits should bound an
individual provider or alignment request, job attempt, and resource budget
while allowing a long track to be processed in bounded ranges.

### Human and uploaded narration

An uploaded or recorded file is not an editing-ready narration merely because
FFprobe can read its duration.

The producer selects an approved narration plan before attaching audio. The
worker probes the file, performs speech recognition or forced alignment
against the plan, and publishes a reviewable word-level result. It identifies
unmatched ranges, omitted script words, inserted speech, substitutions, and
low-confidence boundaries. The producer can correct text associations and word
or cue boundaries before publishing an immutable narration track.

Forced alignment against the approved text is preferred when the narrator
followed the plan. Transcription remains necessary to detect real deviations
rather than forcing incorrect words onto the timeline. Manual correction
remains the final authority.

### Downstream ownership

Semantic beats pin an exact aligned narration-track version and retain the cue
and word ranges they summarize. The editing agent can therefore answer when an
exact word, phrase, sentence, or narration point starts and ends. Compositions
and renders continue to pin the exact track used.

A successor plan or track never silently retimes an approved composition,
replaces a working render, or changes prior output.

## Runtime and safety rules

- Human recording and upload workflows do not require a synthetic provider.
- Synthetic generation fails closed unless an explicitly selected real
  provider and server-only credential are configured.
- Deterministic provider implementations remain confined to automated-test
  configuration.
- Normal tests and CI never call paid providers.
- Provider credentials never enter Convex records, browser payloads, job logs,
  component inputs, or render inputs.
- Job claiming, leases, heartbeats, attempt fencing, cancellation, and
  bounded recovery retain the existing durable worker guarantees.
- A provider response, transcription, or alignment claim is not validation
  evidence. Relay probes audio and validates ordered, bounded word timing before
  publishing a track.
- Partial generation, incomplete upload, failed assembly, and invalid alignment
  cannot advance a project's current narration pointer.

## Initial data ownership

The alpha vertical slice uses the smallest records that protect the implemented
review boundaries:

- `narrationPlanVersions` pins a script and stores ordered source-spanned cues
  with review and approval state;
- `narrationJobs` owns an uploaded take while probing, transcription, and
  alignment are in flight;
- `narrationVersions` owns immutable reviewable or approved track candidates,
  including the take, transcript, cue timing, word timing, and deviations.

The project points separately to its approved narration plan and its approved
editing track. Old synthetic artifacts are not exposed as plans or valid
tracks, and the alpha makes no backward-compatibility promise for them.
Additional take, narrator-profile, generation-attempt, and timing-chunk tables
should be introduced only when an implemented workflow requires those
independent lifecycles or document-size boundaries.

## Delivery sequence

### 1. Narration-plan domain

- Add narration plan, immutable plan version, and cue contracts.
- Parse Markdown into deterministic spoken and non-spoken candidates.
- Validate source spans, ordering, exact pins, hashes, and runtime estimates.
- Prove the parser against realistic scripts, including the reference project.

### 2. Producer workspace

- Rename `Voice` to `Narration`.
- Present proposed spoken cues alongside excluded production directions.
- Add include, exclude, edit, split, merge, reorder, and approval controls.
- Do not expose paid generation until a plan is approved.

### 3. Human take and alignment boundary

- Attach one or more human audio takes to an approved narration plan.
- Probe audio and run bounded transcription plus forced alignment.
- Store cue and word timing with deviations and confidence.
- Add producer review and correction before track publication.

### 4. Optional synthetic provider boundary

- Introduce a narrow `NarrationProvider` interface in the Node worker.
- Use a configured real provider at worker startup and fail closed when its
  credential is incomplete.
- Refuse synthetic production when real configuration is incomplete without
  blocking human narration.
- Record provider identity, settings, usage, cost, and bounded failures.

### 5. Cue generation and assembly

- Generate, retry, cancel, and inspect cues independently.
- Assemble the approved sequence through FFmpeg.
- Probe and validate the result before immutable publication.
- Run generated audio through word alignment when provider timing is absent or
  insufficient.
- Support selected-cue regeneration while preserving prior working tracks.

### 6. Alignment review

- Produce reviewable word timing for human, uploaded, recorded, and synthetic
  performances through one contract.
- Show omissions, insertions, substitutions, confidence, and unmatched ranges.
- Add producer correction and immutable editing-ready track publication.

### 7. Downstream transition

- Make beats consume aligned track, cue timing, and word timing.
- Update editing-agent context, composition validation, preview, and rendering.
- Preserve exact legacy records and prior outputs.

### 8. Golden proof

Use project `n172xayxmnd74k247hec4knn218b87n2` as the real-route acceptance
case:

1. Pin script version 1.
2. Exclude all 27 visual directions, all headings, metadata, separators, and
   speaker labels.
3. Present approximately 4,568 spoken words and an approximately 30-minute
   estimate for producer review.
4. Approve an exact narration plan.
5. Upload a producer or human-narrator recording and verify cue and word timing.
6. Prove the editor can resolve exact word and phrase start/end times.
7. Optionally generate a synthetic take through the same alignment contract.
8. Create semantic beats from the aligned track.
9. Build a composition and render a selected range.
10. Replace or correct one take and prove that the prior approved track,
    composition, and render remain reproducible.

## Acceptance criteria

- Production never labels deterministic test audio as generated narration.
- A full production script is never sent directly to TTS without an approved
  narration plan.
- Visual directions, metadata, and headings are excluded unless a producer
  explicitly includes or rewrites them as spoken text.
- Human narration is fully supported without configuring a synthetic provider.
- Every aligned track resolves to an exact approved plan, exact cue text,
  performance source, and applicable narrator or synthetic settings.
- Duration, cue timing, and word timing derive from validated audio and
  reviewed alignment, not a text heuristic or global cap.
- Failed, canceled, or partial work cannot replace the last working track.
- Recorded, uploaded, and generated audio require reviewable alignment before
  they can drive beats.
- The editing process can query the actual start and end of every aligned word
  and phrase in the approved track.
- Beats, compositions, previews, and renders remain pinned and reproducible.
- CI remains deterministic and model-free.
