import { getBackend, isBackendConfigured } from "./backend.js";

const loginLinks = document.querySelectorAll('a[href="login.html"]');
const profileLinks = document.querySelectorAll('a[href="profile.html"]');

if (isBackendConfigured()) {
  document.body.classList.add("auth-checking");
}

const menuAuthItems = [];
document.querySelectorAll(".mobile-menu nav").forEach((nav) => {
  const item = document.createElement("a");
  item.className = "menu-auth";
  item.href = "login.html";
  item.textContent = "Sign in ↗";
  item.hidden = !isBackendConfigured();
  nav.append(item);
  menuAuthItems.push(item);
});

const bellSvg = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';

async function addBell(backend) {
  if (document.querySelector(".notif-bell")) return;
  const actions = document.querySelector(".header-actions");
  if (!actions) return;
  const bell = document.createElement("a");
  bell.className = "notif-bell";
  bell.href = "window.html#activity";
  bell.setAttribute("aria-label", "Notifications");
  bell.innerHTML = bellSvg;
  actions.prepend(bell);
  try {
    const { data: count } = await backend.rpc("get_unread_notification_count");
    if (count > 0) {
      const badge = document.createElement("span");
      badge.className = "nav-badge";
      badge.textContent = count > 9 ? "9+" : String(count);
      bell.append(badge);
      bell.setAttribute("aria-label", `Notifications, ${count} unread`);
    }
  } catch (error) {
    console.error("Could not load notifications.", error);
  }
}

let adminChecked = false;
async function addAdminLink() {
  if (adminChecked) return;
  adminChecked = true;
  try {
    const backend = await getBackend();
    addBell(backend);
    const { data } = await backend.rpc("is_admin");
    if (data !== true) return;
    document.querySelectorAll(".main-nav, .mobile-menu nav").forEach((nav) => {
      const link = document.createElement("a");
      link.className = "admin-link";
      link.href = "admin.html";
      link.textContent = "Admin";
      nav.insertBefore(link, nav.querySelector(".mobile-profile-link, .menu-auth"));
    });
  } catch (error) {
    console.error("Admin check failed.", error);
  }
}

async function signOut(event) {
  event.preventDefault();
  try {
    const backend = await getBackend();
    const { error } = await backend.auth.signOut();
    if (error) throw error;
    window.location.assign("index.html");
  } catch (error) {
    console.error("Could not sign out of TRGGA.", error);
  }
}

function showSignedIn(session) {
  const signedIn = Boolean(session?.user);
  menuAuthItems.forEach((item) => {
    item.textContent = signedIn ? "Sign out" : "Sign in ↗";
    item.href = signedIn ? "#" : "login.html";
    item.onclick = signedIn ? signOut : null;
  });
  document.body.classList.toggle("is-signed-in", signedIn);
  if (signedIn) addAdminLink(); else document.querySelectorAll(".admin-link, .notif-bell").forEach((a) => a.remove());
  document.body.classList.remove("auth-checking");
  loginLinks.forEach((link) => {
    link.hidden = signedIn;
  });
  profileLinks.forEach((link) => {
    if (link.classList.contains("mobile-profile-link")) {
      link.hidden = !signedIn;
    } else if (link.classList.contains("button-profile")) {
      if (document.body.querySelector(".auth-layout")) {
        link.hidden = !signedIn;
        return;
      }
      link.classList.toggle("icon-only", signedIn);
      if (signedIn) {
        link.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>';
      } else {
        const arrow = document.createElement("span");
        arrow.setAttribute("aria-hidden", "true");
        arrow.textContent = "↗";
        link.replaceChildren(document.createTextNode("Sign in "), arrow);
      }
      link.href = signedIn ? "profile.html" : "login.html";
      link.setAttribute("aria-label", signedIn ? "Open your profile" : "Sign in");
    }
  });
}

async function initializeNavigation() {
  if (!isBackendConfigured()) {
    showSignedIn(null);
    return;
  }
  try {
    const backend = await getBackend();
    const { data, error } = await backend.auth.getSession();
    if (error) throw error;
    showSignedIn(data.session);
    backend.auth.onAuthStateChange((_event, session) => {
      showSignedIn(session);
    });
  } catch (error) {
    console.error("Could not update the account navigation.", error);
    document.body.classList.remove("auth-checking");
  }
}

initializeNavigation();

if ("serviceWorker" in navigator && window.location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch((error) => console.warn("Could not register the offline cache.", error));
}

let installPrompt = null;
const installed = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
function addInstallButton() {
  const actions = document.querySelector(".header-actions");
  if (!actions || installed || actions.querySelector(".install-btn")) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "install-btn";
  button.setAttribute("aria-label", "Install Trgga");
  button.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m0 0-4-4m4 4 4-4M5 21h14"/></svg><span>Install</span>';
  button.addEventListener("click", async () => {
    if (installPrompt) {
      installPrompt.prompt();
      await installPrompt.userChoice.catch(() => null);
      installPrompt = null;
      button.remove();
    } else {
      window.alert("To install Trgga: tap Share, then 'Add to Home Screen' (iPhone), or open the browser menu and choose 'Install app'.");
    }
  });
  actions.prepend(button);
}
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  addInstallButton();
});
window.addEventListener("appinstalled", () => document.querySelectorAll(".install-btn").forEach((b) => b.remove()));
if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) addInstallButton();
