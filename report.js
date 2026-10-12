import { getBackend } from "./backend.js";

const form = document.querySelector("#report-form");
const message = document.querySelector("#report-message");
const submit = document.querySelector("#report-submit");
const statusEl = document.querySelector("#report-status");

async function init() {
  try {
    const backend = await getBackend();
    const { data } = await backend.auth.getSession();
    if (!data.session) {
      statusEl.hidden = false;
      statusEl.innerHTML = "";
      const link = document.createElement("a");
      link.href = "login.html?next=report.html";
      link.textContent = "Sign in";
      statusEl.append(link, " to send a report so we can follow up if needed.");
      submit.disabled = true;
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get("ref")) form.elements.reference.value = params.get("ref").slice(0, 300);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      submit.disabled = true;
      message.textContent = "Sending…";
      const { error } = await backend.rpc("submit_report", {
        p_kind: form.elements.kind.value,
        p_reference: form.elements.reference.value,
        p_reason: form.elements.reason.value,
        p_details: form.elements.details.value
      });
      if (error) {
        message.textContent = error.message;
        submit.disabled = false;
        return;
      }
      form.reset();
      message.textContent = "Thanks. Your report was sent to the TRGGA team.";
      submit.disabled = false;
    });
  } catch (error) {
    console.error("Could not set up the report form.", error);
    message.textContent = "Reporting isn't available right now.";
    submit.disabled = true;
  }
}

init();
