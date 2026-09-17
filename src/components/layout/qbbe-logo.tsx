/**
 * Served from `public/`, not from qbbe.ca. The mark is identical — the file
 * was taken from the public site — but hosting it here keeps the sign-in
 * shell, the sidebar and onboarding from depending on a third-party request
 * that is outside this project's control, and keeps the accessibility suite
 * from reaching the public internet on every CI run.
 */
const QBBE_LOGO_URL = "/qbbe-logo.jpg";

/**
 * Approved bilingual QBBE brand mark.
 *
 * Keeping the image in this tiny component lets the shell use the real
 * organization identity while the rest of the application continues to
 * consume centralized design tokens.
 */
export function QbbeLogo({ collapsed = false }: { collapsed?: boolean }) {
  if (collapsed) {
    return (
      <span
        aria-label="QBBE Hub"
        className="flex size-9 items-center justify-center rounded-(--radius-sm) border border-white/15 bg-white/8 font-bold text-white shadow-(--shadow-raise)"
      >
        Q
      </span>
    );
  }

  return (
    <span className="block w-[205px] max-w-full">
      <img
        src={QBBE_LOGO_URL}
        alt="Quebec Board of Black Educators — Conseil des éducateurs noirs du Québec"
        width={1225}
        height={279}
        loading="eager"
        decoding="async"
        className="block h-auto w-full rounded-[5px]"
      />
      <span className="sr-only">QBBE Hub</span>
    </span>
  );
}
