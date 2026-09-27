import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import { SignUpForm } from "./sign-up-form";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("auth.signUp.title") };
}

export default function SignUpPage() {
  return <SignUpForm />;
}
