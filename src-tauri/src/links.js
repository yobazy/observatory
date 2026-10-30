// Added by preview.rs to every page it serves, so a web link in a previewed
// page opens in the browser instead of replacing the preview. window.open
// reaches the app's new-window handler (lib.rs), which hands the link to the
// browser. A page that handles its own clicks (preventDefault) keeps them.
document.addEventListener("click", (e) => {
  if (e.defaultPrevented || e.button !== 0) return;
  const a = e.target.closest && e.target.closest("a[href]");
  if (!a) return;
  const url = new URL(a.href, location.href);
  if (!/^(https?|mailto):$/.test(url.protocol)) return;
  e.preventDefault();
  window.open(url.href, "_blank");
});
