export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div
            aria-hidden
            className="mx-auto mb-4 flex size-12 items-center justify-center rounded-(--radius-md) bg-brand text-lg font-bold text-white"
          >
            Q
          </div>
          <h1 className="text-[22px] font-semibold tracking-[-0.01em]">
            QBBE Hub
          </h1>
          <p className="mt-1 text-[13.5px] text-muted">
            Quebec Board of Black Educators — internal workspace
          </p>
        </div>
        {children}
      </div>
    </main>
  );
}
