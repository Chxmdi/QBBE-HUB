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
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f5f2" },
    { media: "(prefers-color-scheme: dark)", color: "#17151a" },
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
