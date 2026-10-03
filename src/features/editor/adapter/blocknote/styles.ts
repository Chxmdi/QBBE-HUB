/**
 * Every stylesheet the block editor uses, in cascade order.
 *
 * Imported by ../block-editor.tsx, which pages load with the page itself, so
 * these arrive with the page's own CSS. They used to be imported by the
 * editor's code, which loads lazily; the editor could then render and take
 * typing before its styles arrived, showing unstyled menus and a touch
 * toolbar of 20 px buttons for up to a second or more (seen in CI and
 * reproduced 4 times in 15 local runs). The editor's code stays lazy.
 */
import "@blocknote/ariakit/style.css";
import "./editor.css";
import "./units/c1-presence.css";
import "./units/e1-paste.css";
import "./units/e2-history.css";
import "./units/e3-blocks.css";
import "./units/e4-mobile.css";
import "./units/e5-performance.css";
