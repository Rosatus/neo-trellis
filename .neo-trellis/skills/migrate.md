# Finish a Trellis migration

Use for a requested Trellis migration or semantic cleanup after the CLI has
copied the files. This is a one-time maintenance skill, not a daily workflow.
Respect preview-only requests. Do not resume imported PRDs automatically.

Read .neo-trellis/migration/trellis-report.json, map.md and routes.json first.
CLI copying is not semantic completion. Source paths and import ledgers are
provenance, never a second set of rules to maintain.

Inspect imported module/spec indexes and their relevant code entry points in
bounded passes. Standard backend/frontend scopes and declared packages were
placed in modules/<scope>/; other specs kept their original names under spec/.
Review ambiguous scopes. Rename only with evidence, such as frontend to
godot-client when its index and actual entry points establish that identity.
Keep useful document splits; do not flatten a module into a giant document.

Put module facts and local constraints under modules/, cross-module contracts
under spec/, research under research/, and old journals/task evidence under
history/. General thinking guides are not automatically global contracts.
Do not invent, broaden, or weaken requirements while reclassifying them.
Keep logs and binary evidence intact regardless of size. Unknown material may
remain at a normal destination with a review note, not a source-branded inbox.

Retire old workflow/delegation/validation machinery rather than porting it.
In current knowledge, remove obsolete execution instructions and replace their
links with applicable current contracts only when justified. Preserve domain
acceptance requirements. Historical commands may stay explicitly historical;
do not rewrite experimental evidence to imply it was produced by the new CLI.

Update map.md and routes.json together. Path references are discovery evidence,
not proof of ownership. Confirm affected modules and shared-contract coverage;
keep unknown scope explicit. Users should navigate from map.md directly to
normal knowledge without opening migration reports during everyday work.

When moving files, verify source/target containment and collisions, preserve
attachments, repair incoming/outgoing Markdown and JSON/JSONL references, and
update destinations in migration ledgers as well as report mappings. Preserve
source hashes. Never overwrite edited files or move/delete an unchecked path.

Verify routes and relevant links against saved files. Record findings and any
remaining gaps in migration/semantic-review.md with status pending or complete.
Separate current dependencies from historical mentions and source provenance.
Inspect references outside migrated files (project instructions, host configs,
scripts and external tool entry points) before claiming .trellis is removable.
Old unsupported integrations need retirement, not compatibility reimplementation.
Only delete the original directory when that deletion is explicitly authorized,
the dependency audit is resolved, and needed evidence is preserved. Otherwise
report that it remains. No automatic commits, publishing or old-task execution.
