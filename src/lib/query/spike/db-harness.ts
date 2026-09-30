// W0-8 spike: connect the DB suites to the LOCAL database only.
//
// The admin connection (the local stack's default postgres login) is used
// for one thing: giving wos_spike_lens_runner a fresh random password for
// this run, so no password is ever stored. Every lens query then runs over a
// pool that logs in as wos_spike_lens_runner, the same way the server would.

import { randomBytes } from "node:crypto";
import { Client, Pool } from "pg";

const HOST = "127.0.0.1";
const PORT = Number(process.env.SPIKE_DB_PORT ?? 54322);

export const QA = {
  owner: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1",
  staff: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2",
  volunteer: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3",
  guest: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5",
  lead: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6",
  pm: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa7",
  outsider: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
} as const;

export function adminClient(): Client {
  return new Client({ host: HOST, port: PORT, user: "postgres", password: "postgres", database: "postgres" });
}

export async function runnerPool(): Promise<Pool> {
  const admin = adminClient();
  await admin.connect();
  const password = randomBytes(24).toString("base64url");
  try {
    // A role name and a random base64url string: nothing here comes from input.
    await admin.query(`alter role wos_spike_lens_runner password '${password}'`);
  } finally {
    await admin.end();
  }
  return new Pool({ host: HOST, port: PORT, user: "wos_spike_lens_runner", password, database: "postgres", max: 4 });
}
