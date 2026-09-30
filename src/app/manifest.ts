import type { MetadataRoute } from "next";

/**
 * Installable web app (Workspace OS V1-16, plan A12): QBBE Hub installs from
 * the browser on phones and computers; there are no app-store apps. Served at
 * /manifest.webmanifest and linked from every page by Next.js.
 *
 * It opens on Home: the phone screens under /m stay behind their switch.
 * A manifest cannot read CSS variables, so its colours are the canvas and
 * brand tokens written out; tests/unit/design-tokens.test.ts keeps them equal.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "QBBE Hub",
    short_name: "QBBE Hub",
    description: "The Quebec Board of Black Educators' workspace.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f7f8fc",
    theme_color: "#2a3c90",
    lang: "en",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
