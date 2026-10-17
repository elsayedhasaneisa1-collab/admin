const consentView  = document.getElementById("consentView");
const mainView     = document.getElementById("mainView");
const consentCheck = document.getElementById("consentCheck");
const consentBtn   = document.getElementById("consentBtn");
const syncBtn      = document.getElementById("syncBtn");
const revokeBtn    = document.getElementById("revokeBtn");
const autoSync     = document.getElementById("autoSync");
const statusText   = document.getElementById("statusText");

function send(type, extra = {}) {
  return new Promise((res) => chrome.runtime.sendMessage({ type, ...extra }, res));
}

async function init() {
  const { consent } = await send("get_consent");
  const { auto_sync } = await chrome.storage.local.get("auto_sync");
  autoSync.checked = auto_sync === true;

  consentView.style.display = consent ? "none" : "block";
  mainView.style.display    = consent ? "block" : "none";
}

consentCheck.addEventListener("change", () => {
  consentBtn.disabled = !consentCheck.checked;
});

consentBtn.addEventListener("click", async () => {
  consentBtn.disabled = true;
  consentBtn.innerText = "Enabling backup…";
  await send("set_consent", { value: true });
  init();
});

syncBtn.addEventListener("click", async () => {
  syncBtn.disabled = true;
  syncBtn.innerText = "Backing up…";
  await send("backup_now");
  syncBtn.disabled = false;
  syncBtn.innerText = "Back up now";
  statusText.innerText = "Backup completed just now";
});

revokeBtn.addEventListener("click", async () => {
  if (!confirm("Revoke backup permission? Nothing will be read or sent until you re-enable it.")) return;
  await send("set_consent", { value: false });
  await chrome.storage.local.set({ auto_sync: false });
  init();
});

autoSync.addEventListener("change", async () => {
  await chrome.storage.local.set({ auto_sync: autoSync.checked });
});

init();