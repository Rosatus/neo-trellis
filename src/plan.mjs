// Shared workflow for the project router and the three host skill directories.
export const PLAN_SKILL = `# Plan a project across feature PRDs

Use for splitting a project goal into deliverable features, or for a request to
list, read, revise or continue a project plan. A single clear feature can go
straight to neo-trellis-prd. Respond in the user's language.

## Choose depth and execution scope independently

- Progressive (default): outline the whole goal and develop complete PRDs for
  the selected near-term slices as needed.
- Full: clarify every in-scope slice before development. Offer this for a
  one-shot product request. Resolve shared decisions first, then local gaps.
- Derive execution scope from the user's words: planning only, named slice IDs,
  or the whole confirmed revision through product acceptance. For example,
  “plan it all” authorizes planning; “build the first two” bounds execution.
  Reuse clear instructions. Ask only if the choice would change the work.

## Shape and confirm the plan

Start with the product outcome and observable end-to-end acceptance scenarios.
Check the map, relevant modules and actual entry points. Slice vertically so
each item can be demonstrated independently once its prerequisites exist. In a
new project, the first slice can establish module boundaries by running a thin
real user path. In an existing project, build on the contracts already there.
Investigate unknowns that could invalidate downstream boundaries before
confirming dependent PRDs. Keep unresolved slices visibly provisional.

Show the proposed plan in delivery order. Give every slice a stable ID, its
outcome, an acceptance example and direct dependencies by ID. Check unique IDs,
existing dependency targets and absence of cycles (including self-dependencies).
Explain what unlocks the next slice. Record shared interfaces in one place.

Use the PRD workflow at \`.neo-trellis/skills/prd.md\` for each expanded slice.
In full mode show the complete plan and every PRD body, optionally in review
batches. For a long review, stage the PRD bodies in the usual draft directories
so the exact reviewed text survives a context reset. Identify the plan revision
and PRD IDs/revisions covered by the decision. One
confirmation can cover the set and one instruction can authorize its delivery.
In progressive mode confirm the outline and only the PRDs already expanded.
Preserve delegated choices. Revising a confirmed outcome, critical dependency,
shared contract or acceptance criterion requires targeted review of affected
items. Recheck the dependency order and reopen any product check invalidated
by the revision. Added or materially changed work needs matching authorization.

## Keep a recoverable record

Save the confirmed plan at \`.neo-trellis/plans/<plan-id>/plan.md\`, using a
unique readable directory ID. Use this compact Markdown layout:

- Header: title, stable plan ID, revision, depth and overall status.
- Goal and product acceptance: real entry points, expected outcomes, evidence
  when run. Include only shared contracts the slices depend on.
- Decisions: confirmed revision(s), user's confirmation and date, execution
  scope and its source. Keep later changes to scope and authorization visible.
- Delivery order: one row per slice (ID, outcome, acceptance example, direct
  dependencies, stable PRD ID or pending, last known status).
- Checkpoint: active blocker or next eligible slice, integration check results.

Reserve the linked PRD IDs in the plan before writing confirmed PRDs to the
usual active directories. Check for ID collisions across active, archive and
drafts. Use project-local directory names and preserve unrelated user files.
Each PRD names its parent plan ID and slice ID.
Use stable IDs for lookup across archive moves. On interrupted batch creation,
preserve existing documents, reconcile against the exact reviewed revisions,
and fill only missing confirmed documents whose reviewed text is available.
If reviewed text is unavailable, recover its draft or review the missing text
before execution. In full mode verify the entire confirmed set is on disk
before starting the first slice. Re-read the files you write.

## Read, resume and deliver

For a list, read plan headers under \`.neo-trellis/plans/*/plan.md\`. For a named
plan or item, resolve its ID or title and ask only if ambiguous. For a progress
request, reconcile the selected plan's rows with the linked PRD statuses. A
new session resumes development only when directed to the plan. A request for
status is read-only with respect to development.

For execution, load the plan summary, current PRD, direct dependency outcomes
and relevant module contracts. Resolve linked IDs under \`prds/active/<id>/\`
and \`prds/archive/<id>/\` inside .neo-trellis. Check the backlink, revision,
status and acceptance evidence. A stale row can be repaired from this record.
A missing or ambiguous record, a draft, or an archive with unverified evidence
cannot establish delivery. Report the discrepancy and keep dependents pending.
Upsert the existing slice row by ID after a PRD transition. Preserve unrelated
rows and concurrent edits by re-reading before a write. Cancelled or superseded
items stay distinguishable; confirm revised dependencies or a successor before
treating the affected plan scope as satisfied.

Continue the current eligible slice or take the first authorized unfinished
slice whose prerequisites are delivered. Expand a progressive outline item via
the PRD workflow before implementing it. Verify and archive each PRD, then
refresh its row. If a record update fails, distinguish verified delivery from
the pending writeback. Continue within the agreed execution scope without requesting
the same approval again. If a slice is blocked, record why and continue other
eligible authorized slices. Stop at the authorized boundary or when progress
requires a user decision or an external change.

For whole-product delivery, run the agreed scenarios through the real entry
points on the integrated result. Record observed outcomes, including failures.
Even when all PRDs passed individually, keep the plan open on a failed or
pending product check. Repair in-scope integration defects and rerun affected
checks. Mark the plan completed only after all agreed outcomes are delivered
and the product scenarios pass. Keep the plan at its stable lookup path.
`;

export const PLAN_SKILL_MD = `---
name: neo-trellis-plan
description: Split a project goal into feature PRDs progressively or upfront, and list, review, update or continue a named multi-feature delivery plan in Neo-Trellis.
---

${PLAN_SKILL}`;
