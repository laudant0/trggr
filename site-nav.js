import { getBackend, isBackendConfigured } from "./backend.js";

const loginLinks = document.querySelectorAll('a[href="login.html"]');
const profileLinks = document.querySelectorAll('a[href="profile.html"]');

function showSignedIn(session) {
  const signedIn = Boolean(session?.user);
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
  }
}

initializeNavigation();
