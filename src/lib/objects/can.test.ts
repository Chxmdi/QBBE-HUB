import { describe, expect, it } from "vitest";
import { createCan } from "./can";
import { fakeClient, json } from "./testing/fake-client";

const task = "22222222-2222-2222-2222-222222222222";

describe("can", () => {
  it("asks the database's public.can with the object and capability", async () => {
    const { client, requests } = fakeClient(() => json(true));
    expect(await createCan(client)(task, "edit_content")).toBe(true);
    expect(requests[0].url.pathname).toBe("/rest/v1/rpc/can");
    expect(requests[0].body).toEqual({ object_id: task, capability: "edit_content" });
  });

  it("answers false when the database says no", async () => {
    const { client } = fakeClient(() => json(false));
    expect(await createCan(client)(task, "manage")).toBe(false);
  });

  it("fails closed on a database error", async () => {
    const { client } = fakeClient(() => json({ message: "boom" }, 500));
    expect(await createCan(client)(task, "view")).toBe(false);
  });

  it("refuses an unknown capability without asking", async () => {
    const { client, requests } = fakeClient(() => json(true));
    // @ts-expect-error: not a Workspace OS capability
    expect(await createCan(client)(task, "delete_everything")).toBe(false);
    expect(requests).toHaveLength(0);
  });
});
