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
  document.body.classList.remove("auth-checking");
  loginLinks.forEach((link) => {
    link.hidden = signedIn;
  });
  profileLinks.forEach((link) => {
    if (link.classList.contains("button-profile")) {
      const label = document.createTextNode(signedIn ? "My profile " : "Profile ");
      const arrow = document.createElement("span");
      arrow.setAttribute("aria-hidden", "true");
      arrow.textContent = "↗";
      link.replaceChildren(label, arrow);
      link.setAttribute("aria-label", signedIn ? "Open your profile" : "Profile");
    }
  });
}

async function initializeNavigation() {
  if (!isBackendConfigured()) return;
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
