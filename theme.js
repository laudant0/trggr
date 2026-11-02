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

/* App-wide vibes: scroll progress, reveal on scroll, vote confetti */
(function () {
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.addEventListener("DOMContentLoaded", function () {
    var bar = document.createElement("div");
    bar.className = "scroll-progress";
    document.body.prepend(bar);
    var ticking = false;
    function paint() {
      var max = document.documentElement.scrollHeight - window.innerHeight;
      bar.style.transform = "scaleX(" + (max > 0 ? Math.min(1, window.scrollY / max) : 0) + ")";
      document.querySelector(".site-header") && document.querySelector(".site-header").classList.toggle("is-scrolled", window.scrollY > 8);
      ticking = false;
    }
    window.addEventListener("scroll", function () { if (!ticking) { ticking = true; requestAnimationFrame(paint); } }, { passive: true });
    paint();

    if (!reduce && "IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) { entry.target.classList.add("in-view"); io.unobserve(entry.target); }
        });
      }, { threshold: 0.08 });
      var watch = function (root) {
        root.querySelectorAll(".member-directory, .community-guidelines, .profile-panel, .room-card, .member-card, .hero-small").forEach(function (item) {
          if (item.dataset.reveal) return;
          item.dataset.reveal = "1";
          item.classList.add("reveal");
          io.observe(item);
        });
      };
      watch(document);
      new MutationObserver(function () { watch(document); }).observe(document.body, { childList: true, subtree: true });
    }

    document.addEventListener("click", function (event) {
      var option = event.target.closest && event.target.closest(".poll-option:not(:disabled)");
      if (!option || reduce) return;
      var rect = option.getBoundingClientRect();
      var colors = ["#c8f169", "#8fd13a", "#f4f3ec", "#ffd166", "#7cf0c9"];
      for (var i = 0; i < 18; i++) {
        var bit = document.createElement("i");
        bit.className = "confetti-bit";
        bit.style.left = (event.clientX || rect.left + rect.width / 2) + "px";
        bit.style.top = (event.clientY || rect.top + rect.height / 2) + "px";
        bit.style.background = colors[i % colors.length];
        bit.style.setProperty("--dx", (Math.random() * 220 - 110).toFixed(0) + "px");
        bit.style.setProperty("--dy", (-40 - Math.random() * 130).toFixed(0) + "px");
        bit.style.setProperty("--rot", (Math.random() * 540 - 270).toFixed(0) + "deg");
        document.body.append(bit);
        setTimeout(function (el) { el.remove(); }.bind(null, bit), 900);
      }
    });
  });
})();
