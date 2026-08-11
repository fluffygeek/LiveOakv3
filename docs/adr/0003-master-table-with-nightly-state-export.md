---
status: accepted
---

# Single master table with a nightly per-state export, not sharded-by-state storage

The spec describes records as "split by state... merged into a master list nightly," which reads as if per-state storage is primary and the master list is derived. We inverted this: one master Job Records table is the actual source of truth, and "split by state" is a nightly-generated per-state export/report for payroll's downstream state-by-state process. There is no two-way sync — edits always happen against the master table. We chose this because a genuinely sharded-by-state store would need reconciliation logic for cross-state duplicate detection and audit history, with no stated requirement that state payroll systems write back into the app. If that requirement turns out to be real, this decision needs revisiting before build.
