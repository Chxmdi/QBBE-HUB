import { notFound } from "next/navigation";
import { mobileEnabled } from "@/features/mobile/flag";
import { PhoneStatusProvider } from "@/features/mobile/components/phone-status";
import { TabBar } from "@/features/mobile/components/tab-bar";

/**
 * Phone screens (Workspace OS V1-16): one column sized for a 390px screen,
 * large touch targets and its own tab bar. Builder screens stay desktop-only.
 */
export default async function PhoneLayout({ children }: { children: React.ReactNode }) {
  if (!(await mobileEnabled())) notFound();
  return (
    <div className="mx-auto w-full max-w-md">
      <TabBar />
      <PhoneStatusProvider>{children}</PhoneStatusProvider>
    </div>
  );
}
