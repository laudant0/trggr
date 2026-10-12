import { getBackend, isBackendConfigured } from "./backend.js";

const statusMessage = document.querySelector("#auth-status");
const signOutButton = document.querySelector("#sign-out");
const signInButtons = document.querySelectorAll("[data-provider]");
let supabase;

function providerName(provider) {
  if (provider === "twitter") return "X";
  if (provider === "facebook") return "Facebook";
  return "Google";
}

function showSignedInUser(session) {
  const user = session && session.user;
  if (user) {
    statusMessage.textContent = `You're signed in${user.email ? ` as ${user.email}` : ""}. Your TRGGA account is ready.`;
    signOutButton.hidden = false;
    signInButtons.forEach((button) => { button.hidden = true; });
  } else {
    statusMessage.textContent = "Choose a provider to get back in the mix.";
    signOutButton.hidden = true;
    signInButtons.forEach((button) => { button.hidden = false; });
  }
}

async function initializeAuth() {
  if (!isBackendConfigured()) {
    statusMessage.textContent = "Sign-in setup needed: add your Supabase project URL and publishable key in auth-config.js, then enable Google, Facebook, and X in Supabase Auth.";
    return;
  }

  try {
    supabase = await getBackend();
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    showSignedInUser(data.session);
    supabase.auth.onAuthStateChange((_event, session) => {
      showSignedInUser(session);
      if (session?.user) {
        const params = new URLSearchParams(window.location.search);
        let next = params.get("next");
        if (next) {
          try {
            sessionStorage.setItem("trggr-auth-next", next);
          } catch (error) {
            console.warn("Could not store the post-login destination.", error);
          }
        } else {
          try {
            next = sessionStorage.getItem("trggr-auth-next");
          } catch (error) {
            console.warn("Could not read the post-login destination.", error);
          }
        }
        const allowedDestinations = new Set(["index.html", "index.html#polls", "create.html", "profile.html", "window.html", "admin.html", "report.html"]);
        const memberDestination = /^member\.html\?id=[0-9a-f-]{36}$/i.test(next || "");
        if (next && (allowedDestinations.has(next) || memberDestination)) {
          sessionStorage.removeItem("trggr-auth-next");
          window.location.replace(next);
        } else if (!next) {
          window.location.replace("profile.html");
        }
      }
    });
  } catch (error) {
    console.error("Could not initialize Supabase authentication.", error);
    statusMessage.textContent = "Couldn't connect to the sign-in service. Check your Supabase settings and connection, then reload.";
  }
}

signInButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    if (!supabase) {
      statusMessage.textContent = "Sign-in isn't configured yet. Add the Supabase URL and publishable key to auth-config.js first.";
      return;
    }

    signInButtons.forEach((item) => { item.disabled = true; });
    statusMessage.textContent = `Connecting to ${providerName(button.dataset.provider)}…`;

    try {
      const next = new URLSearchParams(window.location.search).get("next");
      if (next) sessionStorage.setItem("trggr-auth-next", next);
      const redirectTo = window.location.href.split(/[?#]/, 1)[0];
      const { error } = await supabase.auth.signInWithOAuth({
        provider: button.dataset.provider,
        options: { redirectTo }
      });
      if (error) throw error;
    } catch (error) {
      console.error("Social sign-in failed.", error);
      statusMessage.textContent = `Sign-in couldn't start: ${error.message}`;
      signInButtons.forEach((item) => { item.disabled = false; });
    }
  });
});

signOutButton.addEventListener("click", async () => {
  if (!supabase) return;
  signOutButton.disabled = true;
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    showSignedInUser(null);
  } catch (error) {
    console.error("Could not sign out of Supabase.", error);
    statusMessage.textContent = `Sign-out failed: ${error.message}`;
  } finally {
    signOutButton.disabled = false;
  }
});

initializeAuth();
