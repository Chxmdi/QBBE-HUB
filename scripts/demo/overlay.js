// Drawn inside every page the demo recorder visits: a cursor, a click ripple,
// a caption bar and a highlight box, so a viewer sees where the presenter is
// and reads what is being said. Injected with addInitScript; it talks to the
// recorder through window.__demo and keeps the caption across navigations in
// sessionStorage. Nothing here is part of the application.
(() => {
  if (window.top !== window) return;
  const KEY = "demo.caption";
  const state = { x: -100, y: -100 };
  let root, cursor, caption, box, card;

  const css = `
    #demo-overlay, #demo-overlay * { box-sizing: border-box; pointer-events: none; }
    #demo-overlay { position: fixed; inset: 0; z-index: 2147483647; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    #demo-cursor { position: absolute; left: 0; top: 0; width: 30px; height: 30px; transform: translate(-100px,-100px);
      transition: transform 60ms linear; filter: drop-shadow(0 2px 3px rgba(0,0,0,.45)); }
    .demo-ripple { position: absolute; width: 14px; height: 14px; border-radius: 50%; border: 3px solid #f59e0b;
      transform: translate(-50%,-50%) scale(1); opacity: .95; animation: demo-ripple 650ms ease-out forwards; }
    @keyframes demo-ripple { to { transform: translate(-50%,-50%) scale(4.2); opacity: 0; } }
    #demo-caption { position: absolute; left: 50%; bottom: 42px; transform: translateX(-50%); max-width: 1440px;
      padding: 16px 26px; border-radius: 14px; background: rgba(17,19,28,.88); color: #fff; font-size: 30px; line-height: 1.35;
      letter-spacing: .1px; text-align: center; box-shadow: 0 8px 30px rgba(0,0,0,.35); opacity: 0; transition: opacity 220ms ease; }
    #demo-caption.on { opacity: 1; }
    #demo-box { position: absolute; border: 4px solid #f59e0b; border-radius: 10px; box-shadow: 0 0 0 6px rgba(245,158,11,.25);
      opacity: 0; transition: opacity 200ms ease; }
    #demo-box.on { opacity: 1; }
    #demo-card { position: absolute; inset: 0; display: none; align-items: center; justify-content: center; flex-direction: column;
      gap: 18px; background: linear-gradient(135deg, #0f172a, #1e3a5f 60%, #0f766e); color: #fff; text-align: center; padding: 80px; }
    #demo-card.on { display: flex; }
    #demo-card .kicker { font-size: 28px; letter-spacing: 4px; text-transform: uppercase; opacity: .8; }
    #demo-card h1 { font-size: 88px; margin: 0; font-weight: 700; line-height: 1.1; max-width: 1500px; }
    #demo-card p { font-size: 36px; margin: 0; opacity: .9; max-width: 1400px; }
  `;

  function mount() {
    if (root && document.documentElement.contains(root)) return;
    root = document.createElement("div");
    root.id = "demo-overlay";
    const style = document.createElement("style");
    style.textContent = css;
    cursor = document.createElement("div");
    cursor.id = "demo-cursor";
    cursor.innerHTML =
      '<svg viewBox="0 0 24 24" width="30" height="30"><path d="M5 3l14 9-6 1.5L16.5 20l-2.6 1.2L10.5 15 6 19z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    caption = document.createElement("div");
    caption.id = "demo-caption";
    box = document.createElement("div");
    box.id = "demo-box";
    card = document.createElement("div");
    card.id = "demo-card";
    root.append(style, box, card, caption, cursor);
    document.documentElement.appendChild(root);
    const text = sessionStorage.getItem(KEY) || "";
    caption.textContent = text;
    caption.classList.toggle("on", !!text);
    cursor.style.transform = `translate(${state.x}px, ${state.y}px)`;
  }

  window.addEventListener(
    "mousemove",
    (e) => {
      state.x = e.clientX;
      state.y = e.clientY;
      if (cursor) cursor.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    },
    true,
  );
  window.addEventListener(
    "mousedown",
    (e) => {
      if (!root) return;
      const r = document.createElement("div");
      r.className = "demo-ripple";
      r.style.left = `${e.clientX}px`;
      r.style.top = `${e.clientY}px`;
      root.appendChild(r);
      setTimeout(() => r.remove(), 700);
    },
    true,
  );

  window.__demo = {
    caption(text) {
      mount();
      sessionStorage.setItem(KEY, text || "");
      caption.textContent = text || "";
      caption.classList.toggle("on", !!text);
    },
    highlight(rect) {
      mount();
      if (!rect) {
        box.classList.remove("on");
        return;
      }
      box.style.left = `${rect.x - 6}px`;
      box.style.top = `${rect.y - 6}px`;
      box.style.width = `${rect.width + 12}px`;
      box.style.height = `${rect.height + 12}px`;
      box.classList.add("on");
    },
    card(kicker, title, subtitle) {
      mount();
      if (!title) {
        card.classList.remove("on");
        card.innerHTML = "";
        return;
      }
      card.innerHTML = "";
      const k = document.createElement("div");
      k.className = "kicker";
      k.textContent = kicker || "";
      const h = document.createElement("h1");
      h.textContent = title;
      const p = document.createElement("p");
      p.textContent = subtitle || "";
      card.append(k, h, p);
      card.classList.add("on");
    },
    cursorAt() {
      return { x: state.x, y: state.y };
    },
  };

  // Mount after the application has hydrated, and again if it ever removes
  // the overlay while reconciling the document.
  const start = () => {
    mount();
    setInterval(mount, 500);
  };
  if (document.readyState === "complete") setTimeout(start, 50);
  else window.addEventListener("load", () => setTimeout(start, 50));
})();
