# LiveOakv3

A job tracking web and mobile application.

## Language

### Roles

**Technician**:
Field worker who submits Job Records via the mobile app. May submit new records and view their own submissions on a weekly list, but cannot modify a record once submitted.
_Avoid_: Employee, field worker, user

**Payroll Administrator**:
Reviews and edits Technician-submitted Job Records for accuracy (address, footage, discrepancies, etc.) as part of processing payroll.
_Avoid_: Reviewer, payroll user

**Application Administrator**:
Manages user access (invites accounts, assigns roles) and can modify any Job Record, including ones a Payroll Administrator has already edited. A user may hold this role alongside Payroll Administrator or Technician — roles are a set per user, not mutually exclusive.
_Avoid_: Superuser, system admin, root

### Core entity

**Job Record**:
A single unit of field work submitted by a Technician: address, work code, footage, photos, and notes. Immutable to the Technician once submitted; editable by Payroll and Application Administrators.
_Avoid_: Job, ticket, submission (as a noun — "submit"/"submission" is fine as the verb/event of creating one)

**Job ID**:
The Technician-entered, free-text reference to a Job Record's originating entry in the external dispatch/work-order system. Not required to be unique — informational, not a key.
_Avoid_: Record ID, ticket number

**Record ID**:
The system-generated internal identifier for a Job Record, used for audit, duplicate-linking, and administrative reference. The actual primary key.
_Avoid_: Job ID

**Footage**:
A whole-number measurement, in linear feet, entered by the Technician for a Job Record.

### Record status

**Discrepancy**:
A boolean flag on a Job Record with an accompanying dropdown reason, set during Payroll/Application Administrator review to indicate an accuracy issue. Cleared (unset) once the issue is resolved — clearing is itself an edit, so it's captured by the field-level audit log without needing a separate "resolved" state.

**Closed**:
A flag set by a Payroll or Application Administrator once payroll processing on a Job Record is finished. Cannot be set while the record has an active Discrepancy. Once Closed, a Payroll Administrator can no longer edit the record; an Application Administrator still can.
_Avoid_: Complete, done, finalized

**Pictures Downloaded**:
An independent flag tracking whether a record's photos have been retrieved for payroll processing. Not gated by Discrepancy or Closed status.

**Duplicate**:
Two or more Job Records auto-detected within a rolling 6-month window as sharing the same normalized (verified) address. Linked to each other, with one designated **primary** (the first-submitted, payable record) and the rest subordinate. Defaults to first-submitted; an administrator can override which record is primary, or unlink a false positive.

### Notifications

**Distribution List**:
The set of existing app users (Payroll or Application Administrators) who receive the nightly discrepancy-report email. Limited to app users — not an arbitrary external address list.
