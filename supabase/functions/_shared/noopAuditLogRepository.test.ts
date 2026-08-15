import { assertEquals } from "jsr:@std/assert@1";
import { NoopAuditLogRepository } from "./noopAuditLogRepository.ts";

Deno.test("NoopAuditLogRepository.append - resolves without throwing (placeholder pending #23)", async () => {
  const repo = new NoopAuditLogRepository();
  await repo.append({
    id: "entry-1",
    recordId: "record-1",
    actorEmail: "tech@example.com",
    action: "created",
    timestamp: "2026-01-01T00:00:00.000Z",
    before: null,
    after: {},
  });
});

Deno.test("NoopAuditLogRepository.listByRecordId - always returns an empty array", async () => {
  const repo = new NoopAuditLogRepository();
  await repo.append({
    id: "entry-1",
    recordId: "record-1",
    actorEmail: "tech@example.com",
    action: "created",
    timestamp: "2026-01-01T00:00:00.000Z",
    before: null,
    after: {},
  });

  assertEquals(await repo.listByRecordId("record-1"), []);
});
