// Service worker for state management
// Timer is cumulative across all Substack tabs in a session.
// Resets when user leaves Substack entirely, closes all Substack tabs, or closes browser.
//
// All state lives in chrome.storage.session so it survives service worker restarts.
// Content scripts drive the tick — they message here each active second.

// --- Substack detection & content script injection ---

async function getSubstackTabs() {
  const { substackTabIds = [] } = await chrome.storage.session.get({ substackTabIds: [] });
  return new Set(substackTabIds);
}

async function addSubstackTab(tabId) {
  const tabs = await getSubstackTabs();
  tabs.add(tabId);
  await chrome.storage.session.set({ substackTabIds: [...tabs] });
}

async function removeSubstackTab(tabId) {
  const tabs = await getSubstackTabs();
  tabs.delete(tabId);
  await chrome.storage.session.set({ substackTabIds: [...tabs] });
  if (tabs.size === 0) {
    await chrome.storage.session.set({ sessionTime: 0, toastDismissed: false });
  }
}

function tryInject(tabId, url) {
  if (!url) return;
  try {
    const parsed = new URL(url);
    if (!parsed.pathname.includes("/p/")) return;
  } catch {
    return;
  }

  chrome.scripting.executeScript({
    target: { tabId },
    func: detectSubstack,
  }).then(async (results) => {
    if (results?.[0]?.result) {
      await addSubstackTab(tabId);
      chrome.scripting.insertCSS({ target: { tabId }, files: ["styles.css"] }).catch(() => {});
      chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] }).catch(() => {});
    }
  }).catch(() => {});
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    removeSubstackTab(tabId);
  }
  if (changeInfo.status === "complete") {
    tryInject(tabId, tab.url);
  }
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab?.url) return;
    tryInject(tabId, tab.url);
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  removeSubstackTab(tabId);
});

// --- Detect Substack by checking for known markers in the page ---

function detectSubstack() {
  const indicators = [
    () => !!document.querySelector('meta[content*="Substack"]'),
    () => !!document.querySelector('script[src*="substack.com"]'),
    () => !!document.querySelector('link[href*="substack.com"]'),
    () => !!document.querySelector('link[href*="substackcdn.com"]'),
    () => !!document.querySelector(".post-header, .single-post, .post-title"),
    () => typeof window._preloads !== "undefined",
    () => location.hostname.endsWith(".substack.com"),
    () => !!document.querySelector('a[href*="substack.com"]'),
  ];

  let matches = 0;
  for (const check of indicators) {
    try { if (check()) matches++; } catch {}
  }
  return matches >= 2;
}

// --- Message handling ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Content script reports an active second — increment the session timer
  if (message.type === "tick") {
    (async () => {
      const { enabled = true } = await chrome.storage.local.get({ enabled: true });
      if (!enabled) {
        sendResponse({ time: 0, showToast: false });
        return;
      }

      const { sessionTime = 0 } = await chrome.storage.session.get({ sessionTime: 0 });
      const newTime = sessionTime + 1;
      await chrome.storage.session.set({ sessionTime: newTime });

      const { threshold = 900 } = await chrome.storage.local.get({ threshold: 900 });
      const { toastDismissed = false } = await chrome.storage.session.get({ toastDismissed: false });

      sendResponse({
        time: newTime,
        showToast: newTime >= threshold && !toastDismissed,
      });
    })();
    return true;
  }

  if (message.type === "getSettings") {
    chrome.storage.local.get(
      { threshold: 15 * 60, enabled: true },
      (settings) => sendResponse(settings)
    );
    return true;
  }

  if (message.type === "getSessionTime") {
    chrome.storage.session.get({ sessionTime: 0 }, (data) => {
      sendResponse({ time: data.sessionTime });
    });
    return true;
  }

  if (message.type === "queryTime") {
    chrome.storage.session.get({ sessionTime: 0 }, (data) => {
      sendResponse({ time: data.sessionTime });
    });
    return true;
  }

  if (message.type === "isDismissed") {
    chrome.storage.local.get({ dismissedArticles: [] }, (data) => {
      sendResponse({ dismissed: data.dismissedArticles.includes(message.url) });
    });
    return true;
  }

  if (message.type === "dismiss") {
    chrome.storage.local.get({ dismissedArticles: [] }, (data) => {
      const list = data.dismissedArticles.filter((u) => u !== message.url);
      list.push(message.url);
      while (list.length > 100) list.shift();
      chrome.storage.local.set({ dismissedArticles: list }, () =>
        sendResponse({ ok: true })
      );
    });
    return true;
  }

  if (message.type === "toastDismissed") {
    chrome.storage.session.set({ toastDismissed: true });
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "resetSession") {
    (async () => {
      await chrome.storage.session.set({ sessionTime: 0, toastDismissed: false });
      const tabs = await getSubstackTabs();
      for (const tabId of tabs) {
        chrome.tabs.sendMessage(tabId, { type: "resetToast" }).catch(() => {});
      }
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message.type === "resetArticle") {
    (async () => {
      await chrome.storage.session.set({ sessionTime: 0, toastDismissed: false });
      if (message.url) {
        const { dismissedArticles = [] } = await chrome.storage.local.get({ dismissedArticles: [] });
        const list = dismissedArticles.filter((u) => u !== message.url);
        await chrome.storage.local.set({ dismissedArticles: list });
      }
      const tabs = await getSubstackTabs();
      for (const tabId of tabs) {
        chrome.tabs.sendMessage(tabId, { type: "resetToast" }).catch(() => {});
      }
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message.type === "thresholdChanged") {
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "enabledChanged") {
    (async () => {
      const tabs = await getSubstackTabs();
      for (const tabId of tabs) {
        chrome.tabs.sendMessage(tabId, {
          type: "updateEnabled",
          enabled: message.enabled,
        }).catch(() => {});
      }
      sendResponse({ ok: true });
    })();
    return true;
  }
});
