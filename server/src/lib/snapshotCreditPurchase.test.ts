import test from "node:test";
import assert from "node:assert/strict";
import {
  applySnapshotCreditPackPurchase,
  parseSnapshotCheckoutSession,
  SnapshotPurchaseValidationError,
} from "./snapshotCreditPurchase.js";

test("parseSnapshotCheckoutSession validates paid snapshot session for expected agency", () => {
  const parsed = parseSnapshotCheckoutSession(
    {
      id: "cs_test_123",
      payment_status: "paid",
      metadata: {
        agencyId: "agency_1",
        addOnType: "local_map_snapshot_credit_pack",
        addOnOption: "25",
      },
    },
    "agency_1"
  );

  assert.equal(parsed.agencyId, "agency_1");
  assert.equal(parsed.option, "25");
  assert.equal(parsed.details, "Stripe checkout session cs_test_123");
});

test("parseSnapshotCheckoutSession rejects unpaid or mismatched sessions", () => {
  assert.throws(
    () =>
      parseSnapshotCheckoutSession(
        {
          id: "cs_test_unpaid",
          payment_status: "unpaid",
          status: "open",
          metadata: {
            agencyId: "agency_1",
            addOnType: "local_map_snapshot_credit_pack",
          },
        },
        "agency_1"
      ),
    (err: any) => err instanceof SnapshotPurchaseValidationError && err.statusCode === 409
  );

  assert.throws(
    () =>
      parseSnapshotCheckoutSession(
        {
          id: "cs_test_mismatch",
          payment_status: "paid",
          metadata: {
            agencyId: "agency_2",
            addOnType: "local_map_snapshot_credit_pack",
          },
        },
        "agency_1"
      ),
    (err: any) => err instanceof SnapshotPurchaseValidationError && err.statusCode === 400
  );
});

test("applySnapshotCreditPackPurchase creates add-on and increments credits once", async () => {
  let updateCalls = 0;
  let createCalls = 0;
  const prismaMock = {
    agencyAddOn: {
      findFirst: async () => null,
      create: async () => {
        createCalls += 1;
        return { id: "addon_1" };
      },
    },
    agency: {
      update: async () => {
        updateCalls += 1;
        return { id: "agency_1" };
      },
    },
    $transaction: async (ops: Promise<any>[]) => Promise.all(ops),
  };

  const result = await applySnapshotCreditPackPurchase({
    prismaClient: prismaMock,
    agencyId: "agency_1",
    option: "10",
    details: "Stripe checkout session cs_test_1",
  });

  assert.equal(result.applied, true);
  assert.equal(result.credits, 10);
  assert.equal(result.priceCents, 3400);
  assert.equal(updateCalls, 1);
  assert.equal(createCalls, 1);
});

test("applySnapshotCreditPackPurchase is idempotent when existing row found", async () => {
  let updateCalls = 0;
  let createCalls = 0;
  const prismaMock = {
    agencyAddOn: {
      findFirst: async () => ({ id: "existing_addon" }),
      create: async () => {
        createCalls += 1;
        return { id: "addon_2" };
      },
    },
    agency: {
      update: async () => {
        updateCalls += 1;
        return { id: "agency_1" };
      },
    },
    $transaction: async (ops: Promise<any>[]) => Promise.all(ops),
  };

  const result = await applySnapshotCreditPackPurchase({
    prismaClient: prismaMock,
    agencyId: "agency_1",
    option: "5",
    details: "Stripe checkout session cs_existing",
  });

  assert.equal(result.applied, false);
  assert.equal(result.credits, 5);
  assert.equal(result.priceCents, 1900);
  assert.equal(updateCalls, 0);
  assert.equal(createCalls, 0);
});
