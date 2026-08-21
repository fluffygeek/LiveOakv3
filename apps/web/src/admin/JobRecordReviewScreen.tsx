import { useCallback, useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import {
  DISCREPANCY_REASONS,
  WORK_CODES,
  type AuditLogEntry,
  type JobRecord,
  type Role,
} from "@liveoakv3/shared";
import { functions } from "../firebase";
import { invokeFunction } from "../supabase";

type EditableJobRecordPatch = Partial<
  Pick<JobRecord, "jobId" | "address" | "workCode" | "footage" | "notes">
>;

// Ported to Supabase Edge Functions (ticket #23): listJobRecords/getJobRecord already existed
// as Edge Functions from an earlier ticket but this screen still called them via
// httpsCallable until now; editJobRecord/setPicturesDownloaded/listJobRecordAuditLog are new
// Edge Functions built by #23 itself. setDiscrepancy/setClosed ported by ticket #24.
const listJobRecordsFn = () => invokeFunction<JobRecord[]>("listJobRecords");
const getJobRecordFn = (body: { recordId: string }) =>
  invokeFunction<JobRecord>("getJobRecord", body);
const listJobRecordAuditLogFn = (body: { recordId: string }) =>
  invokeFunction<AuditLogEntry[]>("listJobRecordAuditLog", body);
const editJobRecordFn = (body: { recordId: string } & EditableJobRecordPatch) =>
  invokeFunction<JobRecord>("editJobRecord", body);
const setPicturesDownloadedFn = (body: { recordId: string; value: boolean }) =>
  invokeFunction<JobRecord>("setPicturesDownloaded", body);
const setDiscrepancyFn = (body: { recordId: string; active: boolean; reason: string | null }) =>
  invokeFunction<JobRecord>("setDiscrepancy", body);
const setClosedFn = (body: { recordId: string; value: boolean }) =>
  invokeFunction<JobRecord>("setClosed", body);

// Not yet ported -- no Edge Functions exist for these (overrideDuplicatePrimary/
// unlinkDuplicate are #25's scope), so they stay on httpsCallable.
const overrideDuplicatePrimaryFn = httpsCallable<{ recordId: string }, JobRecord[]>(
  functions,
  "overrideDuplicatePrimary",
);
const unlinkDuplicateFn = httpsCallable<
  { recordId: string; otherRecordId: string },
  { record: JobRecord; other: JobRecord }
>(functions, "unlinkDuplicate");

export function JobRecordReviewScreen({ roles }: { roles: Role[] }) {
  const isApplicationAdministrator = roles.includes("applicationAdministrator");

  const [records, setRecords] = useState<JobRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const refreshList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listJobRecordsFn();
      setRecords(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Job Records");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  return (
    <section>
      <h2>Job Record review</h2>
      {error ? <p role="alert">{error}</p> : null}
      {loading ? (
        <p>Loading…</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Record ID</th>
              <th>Job ID</th>
              <th>Technician</th>
              <th>Address</th>
              <th>Discrepancy</th>
              <th>Closed</th>
              <th>Pictures Downloaded</th>
              <th>Duplicate</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr key={record.recordId}>
                <td>{record.recordId}</td>
                <td>{record.jobId}</td>
                <td>{record.technicianEmail}</td>
                <td>{record.address}</td>
                <td>{record.discrepancy ? record.discrepancyReason : "—"}</td>
                <td>{record.closed ? "Closed" : "Open"}</td>
                <td>{record.picturesDownloaded ? "Yes" : "No"}</td>
                <td>{record.duplicate.isDuplicate ? (record.duplicate.isPrimary ? "Primary" : "Subordinate") : "—"}</td>
                <td>
                  <button onClick={() => setSelectedId(record.recordId)}>Review</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {selectedId ? (
        <JobRecordDetail
          // Remounts the panel on every record switch so per-record local
          // state (e.g. the pending discrepancy reason) can't leak from one
          // record's unsaved selection into the next.
          key={selectedId}
          recordId={selectedId}
          isApplicationAdministrator={isApplicationAdministrator}
          onClose={() => setSelectedId(null)}
          onChanged={refreshList}
        />
      ) : null}
    </section>
  );
}

function JobRecordDetail({
  recordId,
  isApplicationAdministrator,
  onClose,
  onChanged,
}: {
  recordId: string;
  isApplicationAdministrator: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [record, setRecord] = useState<JobRecord | null>(null);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [discrepancyReason, setDiscrepancyReason] = useState("");

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [recordResult, auditResult] = await Promise.all([
        getJobRecordFn({ recordId }),
        listJobRecordAuditLogFn({ recordId }),
      ]);
      setRecord(recordResult);
      setAuditLog(auditResult);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Job Record");
    }
  }, [recordId, onChanged]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!record) {
    return error ? <p role="alert">{error}</p> : <p>Loading…</p>;
  }

  const editable = !record.closed || isApplicationAdministrator;

  const runAction = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    }
  };

  const handleFieldEdit = (patch: EditableJobRecordPatch) =>
    runAction(() => editJobRecordFn({ recordId, ...patch }));

  return (
    <section>
      <h3>Job Record {record.recordId}</h3>
      <button onClick={onClose}>Close panel</button>
      {error ? <p role="alert">{error}</p> : null}
      {!editable ? <p>This record is Closed — only an Application Administrator can edit it.</p> : null}

      <dl>
        <dt>Job ID</dt>
        <dd>
          <input
            defaultValue={record.jobId}
            disabled={!editable}
            onBlur={(event) =>
              event.target.value !== record.jobId &&
              handleFieldEdit({ jobId: event.target.value })
            }
          />
        </dd>
        <dt>Address</dt>
        <dd>
          <input
            defaultValue={record.address}
            disabled={!editable}
            onBlur={(event) =>
              event.target.value !== record.address &&
              handleFieldEdit({ address: event.target.value })
            }
          />
        </dd>
        <dt>Work code</dt>
        <dd>
          <select
            defaultValue={record.workCode}
            disabled={!editable}
            onChange={(event) => handleFieldEdit({ workCode: event.target.value })}
          >
            {WORK_CODES.map((wc) => (
              <option key={wc.code} value={wc.code}>
                {wc.code} — {wc.description}
              </option>
            ))}
          </select>
        </dd>
        <dt>Footage</dt>
        <dd>
          <input
            type="number"
            defaultValue={record.footage}
            disabled={!editable}
            onBlur={(event) => {
              if (event.target.value.trim() === "") return;
              const next = Number(event.target.value);
              if (Number.isInteger(next) && next !== record.footage) {
                handleFieldEdit({ footage: next });
              }
            }}
          />
        </dd>
        <dt>Notes</dt>
        <dd>
          <textarea
            defaultValue={record.notes}
            disabled={!editable}
            onBlur={(event) =>
              event.target.value !== record.notes &&
              handleFieldEdit({ notes: event.target.value })
            }
          />
        </dd>
        <dt>Photos</dt>
        <dd>{record.photoUrls.length} attached</dd>
      </dl>

      <section>
        <h4>Discrepancy</h4>
        <label>
          <input
            type="checkbox"
            checked={record.discrepancy}
            disabled={!editable}
            onChange={(event) => {
              if (event.target.checked) return; // setting active requires a reason below
              void runAction(() =>
                setDiscrepancyFn({ recordId, active: false, reason: null }),
              );
            }}
          />
          Active
        </label>
        {record.discrepancy ? (
          <p>Reason: {record.discrepancyReason}</p>
        ) : (
          <>
            <select
              value={discrepancyReason}
              disabled={!editable}
              onChange={(event) => setDiscrepancyReason(event.target.value)}
            >
              <option value="">Select a reason…</option>
              {DISCREPANCY_REASONS.map((reason) => (
                <option key={reason.code} value={reason.code}>
                  {reason.description}
                </option>
              ))}
            </select>
            <button
              disabled={!editable || !discrepancyReason}
              onClick={() =>
                void runAction(() =>
                  setDiscrepancyFn({ recordId, active: true, reason: discrepancyReason }),
                )
              }
            >
              Flag Discrepancy
            </button>
          </>
        )}
      </section>

      <section>
        <h4>Pictures Downloaded</h4>
        <label>
          <input
            type="checkbox"
            checked={record.picturesDownloaded}
            onChange={(event) =>
              void runAction(() =>
                setPicturesDownloadedFn({ recordId, value: event.target.checked }),
              )
            }
          />
          Downloaded
        </label>
      </section>

      <section>
        <h4>Closed</h4>
        <label>
          <input
            type="checkbox"
            checked={record.closed}
            disabled={!editable || (!record.closed && record.discrepancy)}
            onChange={(event) =>
              void runAction(() => setClosedFn({ recordId, value: event.target.checked }))
            }
          />
          Closed
        </label>
        {!record.closed && record.discrepancy ? (
          <p>Clear the active Discrepancy before closing.</p>
        ) : null}
      </section>

      {record.duplicate.isDuplicate ? (
        <section>
          <h4>Duplicate</h4>
          <p>{record.duplicate.isPrimary ? "Primary (payable) record" : "Subordinate record"}</p>
          {!record.duplicate.isPrimary ? (
            <button
              disabled={!editable}
              onClick={() =>
                void runAction(() => overrideDuplicatePrimaryFn({ recordId }))
              }
            >
              Make primary
            </button>
          ) : null}
          <ul>
            {record.duplicate.linkedRecordIds.map((otherId) => (
              <li key={otherId}>
                {otherId}{" "}
                <button
                  disabled={!editable}
                  onClick={() =>
                    void runAction(() =>
                      unlinkDuplicateFn({ recordId, otherRecordId: otherId }),
                    )
                  }
                >
                  Unlink
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h4>Audit history</h4>
        <ul>
          {auditLog.map((entry) => (
            <li key={entry.id}>
              {entry.timestamp} — {entry.actorEmail} — {entry.action}
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
