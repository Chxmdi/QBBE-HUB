import type { Metadata, Viewport } from "next";
import "@/design-system/styles/globals.css";

export const metadata: Metadata = {
  title: {
    default: "QBBE Hub",
    template: "%s · QBBE Hub",
  },
  description:
    "The Quebec Board of Black Educators' internal operating and communication system.",
};

export const viewport: Viewport = {
  // Browser chrome colour. A <meta> value cannot read CSS variables, so
  // these repeat --color-canvas for each theme (globals.css); keep in step.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f8fc" },
    { media: "(prefers-color-scheme: dark)", color: "#10172f" },
  ],
};

/** Applies the persisted theme before paint to avoid a flash. */
const themeScript = `
try {
  var t = localStorage.getItem('qbbe-theme');
  if (t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.classList.add('dark');
  }
} catch (e) {}
`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
