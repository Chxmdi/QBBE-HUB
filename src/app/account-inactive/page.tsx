import type { Metadata } from "next";
import { AccountInactivePage } from "./account-inactive-page";

export const metadata: Metadata = { title: "Account inactive" };

export default function Page() {
  return <AccountInactivePage />;
}
