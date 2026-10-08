// Comment mode in a mockup preview: added to the page by preview.rs only
// when the preview asks for it (?pick=1), so a page shown normally is served
// untouched. Outlines what the pointer is on, and a click picks it instead
// of acting on it: the element's selector and text go to Observatory, which
// asks what should change. Pins for the comments already made come back the
// other way and are drawn over the page. Talks only through postMessage; the
// page runs sandboxed, with no access to the app.
(() => {
  const app = window.parent;
  const send = (msg) => app.postMessage({ observatory: true, ...msg }, "*");

  const layer = document.createElement("div");
  layer.setAttribute("data-observatory", "");
  layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
  const box = document.createElement("div");
  box.style.cssText =
    "position:fixed;border:2px solid #3d5bd9;background:rgba(61,91,217,.08);border-radius:3px;display:none;transition:all 60ms";
  layer.appendChild(box);
  const mount = () => document.body && !layer.isConnected && document.body.appendChild(layer);

  const ours = (el) => el && el.closest && el.closest("[data-observatory]");

  /** A selector that finds `el` again: its id if that's unique, else a
   *  short path of tags, a class, and positions among same-tag siblings. */
  function selector(el) {
    const parts = [];
    for (let node = el; node && node.nodeType === 1 && node !== document.documentElement; node = node.parentElement) {
      if (node.id && document.querySelectorAll("#" + CSS.escape(node.id)).length === 1) {
        parts.unshift("#" + CSS.escape(node.id));
        break;
      }
      let part = node.tagName.toLowerCase();
      const cls = [...node.classList].find((c) => /^[a-zA-Z][\w-]*$/.test(c));
      if (cls) part += "." + cls;
      const parent = node.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.tagName === node.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      if (node === document.body || parts.length >= 5) break;
    }
    return parts.join(" > ");
  }

  /** What the element says: its text, or for a field its placeholder. */
  function label(el) {
    const text = (el.innerText || el.value || el.getAttribute("placeholder") || el.getAttribute("aria-label") || el.getAttribute("alt") || "")
      .replace(/\s+/g, " ")
      .trim();
    return text.length > 80 ? text.slice(0, 77) + "…" : text;
  }

  function place(node, el) {
    const r = el.getBoundingClientRect();
    node.style.left = r.left - 2 + "px";
    node.style.top = r.top - 2 + "px";
    node.style.width = r.width + 4 + "px";
    node.style.height = r.height + 4 + "px";
  }

  document.addEventListener(
    "mousemove",
    (e) => {
      mount();
      const el = e.target;
      if (!el || ours(el) || el === document.documentElement) return (box.style.display = "none");
      box.style.display = "block";
      place(box, el);
    },
    true,
  );
  document.addEventListener("mouseleave", () => (box.style.display = "none"));

  // A click picks; nothing on the page acts on it.
  const swallow = (e) => {
    if (ours(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
  };
  for (const type of ["mousedown", "mouseup", "pointerdown", "pointerup", "dblclick", "submit"]) {
    document.addEventListener(type, swallow, true);
  }
  document.addEventListener(
    "click",
    (e) => {
      swallow(e);
      const el = e.target;
      if (!el || ours(el) || el === document.documentElement) return;
      const r = el.getBoundingClientRect();
      send({
        type: "pick",
        selector: selector(el),
        tag: el.tagName.toLowerCase(),
        text: label(el),
        rect: { x: r.left, y: r.top, width: r.width, height: r.height },
      });
    },
    true,
  );
  document.addEventListener("keydown", (e) => e.key === "Escape" && send({ type: "escape" }), true);

  // Pins for the comments made so far: numbered, where each element is.
  let pins = [];
  const drawn = [];
  function draw() {
    mount();
    drawn.splice(0).forEach((d) => d.remove());
    for (const pin of pins) {
      let el = null;
      try {
        el = document.querySelector(pin.selector);
      } catch {}
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const dot = document.createElement("div");
      dot.textContent = String(pin.n);
      dot.style.cssText =
        "position:fixed;min-width:20px;height:20px;padding:0 5px;box-sizing:border-box;border-radius:10px;" +
        "font:600 11px/20px -apple-system,system-ui,sans-serif;text-align:center;color:#fff;box-shadow:0 1px 4px rgba(0,0,0,.3);" +
        `background:${pin.sent ? "#8a93a8" : "#3d5bd9"};left:${Math.min(innerWidth - 26, Math.max(2, r.right - 12))}px;top:${Math.min(innerHeight - 22, Math.max(2, r.top - 10))}px`;
      layer.appendChild(dot);
      drawn.push(dot);
    }
  }
  window.addEventListener("message", (e) => {
    if (e.source !== app || !e.data || e.data.observatory !== true) return;
    if (e.data.type === "pins") {
      pins = e.data.pins || [];
      draw();
    }
  });
  window.addEventListener("scroll", draw, true);
  window.addEventListener("resize", draw);
  window.addEventListener("load", () => {
    mount();
    send({ type: "ready" });
  });
  if (document.readyState === "complete") send({ type: "ready" });
})();
