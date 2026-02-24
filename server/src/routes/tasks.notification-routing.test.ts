import test from "node:test";
import assert from "node:assert/strict";
import { selectTaskActivityRecipientIds } from "./tasks.js";

function asSorted(ids: string[]) {
  return [...ids].sort();
}

test("client activity on agency-owned task notifies super admin + agency users", () => {
  const recipients = selectTaskActivityRecipientIds({
    authorRole: "USER",
    authorId: "client-author",
    assigneeId: "specialist-1",
    internalUserIds: ["super-admin-1", "agency-user-1", "agency-user-2"],
    clientUserIds: ["client-author", "client-user-2"],
  });

  assert.deepEqual(asSorted(recipients), ["agency-user-1", "agency-user-2", "super-admin-1"]);
});

test("client activity on super-admin-owned task notifies super admin only", () => {
  const recipients = selectTaskActivityRecipientIds({
    authorRole: "USER",
    authorId: "client-author",
    assigneeId: null,
    internalUserIds: ["super-admin-1"],
    clientUserIds: ["client-author"],
  });

  assert.deepEqual(recipients, ["super-admin-1"]);
});

test("super admin activity on task notifies client users", () => {
  const recipients = selectTaskActivityRecipientIds({
    authorRole: "SUPER_ADMIN",
    authorId: "super-admin-1",
    assigneeId: "specialist-1",
    internalUserIds: ["super-admin-1", "agency-user-1"],
    clientUserIds: ["client-user-1", "client-user-2"],
  });

  assert.deepEqual(asSorted(recipients), ["client-user-1", "client-user-2"]);
});

test("agency activity on task notifies client users", () => {
  const recipients = selectTaskActivityRecipientIds({
    authorRole: "AGENCY",
    authorId: "agency-user-1",
    assigneeId: "specialist-1",
    internalUserIds: ["super-admin-1", "agency-user-1", "agency-user-2"],
    clientUserIds: ["client-user-1"],
  });

  assert.deepEqual(recipients, ["client-user-1"]);
});

test("author never receives their own notification", () => {
  const fromClient = selectTaskActivityRecipientIds({
    authorRole: "USER",
    authorId: "super-admin-1",
    assigneeId: "specialist-1",
    internalUserIds: ["super-admin-1", "agency-user-1"],
    clientUserIds: ["client-user-1"],
  });
  assert.deepEqual(fromClient, ["agency-user-1"]);

  const fromInternal = selectTaskActivityRecipientIds({
    authorRole: "SUPER_ADMIN",
    authorId: "client-user-1",
    assigneeId: "specialist-1",
    internalUserIds: ["super-admin-1"],
    clientUserIds: ["client-user-1", "client-user-2"],
  });
  assert.deepEqual(fromInternal, ["client-user-2"]);
});

test("assignee activity notifies super admin + agency users (not client users)", () => {
  const recipients = selectTaskActivityRecipientIds({
    authorRole: "SPECIALIST",
    authorId: "specialist-1",
    assigneeId: "specialist-1",
    internalUserIds: ["super-admin-1", "agency-user-1", "specialist-1"],
    clientUserIds: ["client-user-1", "client-user-2"],
  });

  assert.deepEqual(asSorted(recipients), ["agency-user-1", "super-admin-1"]);
});

test("super admin assignee activity does not self-notify", () => {
  const recipients = selectTaskActivityRecipientIds({
    authorRole: "SUPER_ADMIN",
    authorId: "super-admin-1",
    assigneeId: "super-admin-1",
    internalUserIds: ["super-admin-1", "agency-user-1"],
    clientUserIds: ["client-user-1"],
  });

  assert.deepEqual(recipients, ["agency-user-1"]);
});
