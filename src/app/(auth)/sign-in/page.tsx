import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import { SignInForm } from "./sign-in-form";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("auth.signIn.title") };
}

export default function SignInPage() {
  return <SignInForm />;
}
