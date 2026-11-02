import { streakPanel } from "./streak.js";

const store = {
  get(key) { try { return localStorage.getItem(key); } catch (error) { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch (error) { /* private mode */ } },
  remove(key) { try { localStorage.removeItem(key); } catch (error) { /* private mode */ } }
};

const themeButtons = document.querySelectorAll("#set-theme button");
function paintTheme() {
  const saved = store.get("trgga-theme") || "auto";
  themeButtons.forEach((button) => button.classList.toggle("active", button.dataset.mode === saved));
}
themeButtons.forEach((button) => button.addEventListener("click", () => {
  window.trggaSetTheme?.(button.dataset.mode);
  paintTheme();
}));
paintTheme();

const forYou = document.querySelector("#set-foryou");
forYou.checked = store.get("trgga-pref-foryou") !== "off";
forYou.addEventListener("change", () => store.set("trgga-pref-foryou", forYou.checked ? "on" : "off"));

const calm = document.querySelector("#set-calm");
calm.checked = store.get("trgga-pref-calm") === "on";
calm.addEventListener("change", () => {
  store.set("trgga-pref-calm", calm.checked ? "on" : "off");
  document.documentElement.classList.toggle("calm", calm.checked);
});

document.querySelector("#set-streak").append(streakPanel());
