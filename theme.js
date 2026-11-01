(function () {
  var root = document.documentElement;
  var stored = null;
  try { stored = localStorage.getItem("trgga-theme"); } catch (error) { stored = null; }
  var prefersLight = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
  root.dataset.theme = stored || (prefersLight ? "light" : "dark");

  var sun = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  var moon = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

  function sync(button) {
    var light = root.dataset.theme === "light";
    button.innerHTML = light ? moon : sun;
    button.setAttribute("aria-label", light ? "Switch to night mode" : "Switch to day mode");
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", light ? "#f4f3ec" : "#11120f");
  }

  document.addEventListener("DOMContentLoaded", function () {
    var actions = document.querySelector(".header-actions");
    if (!actions) return;
    var button = document.createElement("button");
    button.type = "button";
    button.className = "theme-toggle";
    sync(button);
    button.addEventListener("click", function () {
      root.dataset.theme = root.dataset.theme === "light" ? "dark" : "light";
      try { localStorage.setItem("trgga-theme", root.dataset.theme); } catch (error) { /* private mode */ }
      sync(button);
    });
    actions.prepend(button);
  });
})();
