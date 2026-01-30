// Service worker for state management
// Timer is cumulative across all Substack tabs in a session.
// Resets when user leaves Substack entirely, closes all Substack tabs, or closes browser.

const injectedTabs = new Set();   // tabs with content script injected
const substackTabs = new Set();   // tabs currently on a Substack page
const activeTabs = new Map();     // tabId -> last activity timestamp from content script

let tickInterval = null;

// --- Substack detection & content script injection ---

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // When a tab navigates to a new URL, check if it left Substack
  if (changeInfo.url) {
    injectedTabs.delete(tabId);
    // We'll re-evaluate below if status is complete; otherwise mark as gone for now
    substackTabs.delete(tabId);
    activeTabs.delete(tabId);
    checkSessionEnd();
  }

  if (changeInfo.status !== "complete") return;
  if (!tab.url) return;

  try {
    const url = new URL(tab.url);
    if (!url.pathname.includes("/p/")) return;
  } catch {
    return;
  }

  if (injectedTabs.has(tabId)) return;

  chrome.scripting.executeScript({
    target: { tabId },
    func: detectSubstack,
  }).then((results) => {
    if (results?.[0]?.result) {
      injectedTabs.add(tabId);
      substackTabs.add(tabId);
      chrome.scripting.insertCSS({ target: { tabId }, files: ["styles.css"] });
      chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
      ensureTickerRunning();
    }
  }).catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  injectedTabs.delete(tabId);
  substackTabs.delete(tabId);
  activeTabs.delete(tabId);
  checkSessionEnd();
});

// When all Substack tabs are gone, reset the session timer
function checkSessionEnd() {
  if (substackTabs.size === 0) {
    chrome.storage.session.set({ sessionTime: 0, toastDismissed: false });
    stopTicker();
  }
}

// --- Central ticker (runs in background, increments shared timer) ---

function ensureTickerRunning() {
  if (tickInterval) return;
  tickInterval = setInterval(async () => {
    // Check if any tab has recent activity
    const now = Date.now();
    let anyActive = false;
    for (const [, lastActive] of activeTabs) {
      if (now - lastActive < 62_000) { // 60s timeout + 2s buffer
        anyActive = true;
        break;
      }
    }
    if (!anyActive) return;

    const { enabled = true } = await chrome.storage.local.get({ enabled: true });
    if (!enabled) return;

    const { sessionTime = 0 } = await chrome.storage.session.get({ sessionTime: 0 });
    const newTime = sessionTime + 1;
    await chrome.storage.session.set({ sessionTime: newTime });

    // Check threshold
    const { threshold = 900 } = await chrome.storage.local.get({ threshold: 900 });
    const { toastDismissed = false } = await chrome.storage.session.get({ toastDismissed: false });

    if (newTime >= threshold && !toastDismissed) {
      // Tell the active Substack tab to show the toast
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        if (tab && substackTabs.has(tab.id)) {
          chrome.tabs.sendMessage(tab.id, { type: "showToast", time: newTime }).catch(() => {});
        }
      });
    }
  }, 1000);
}

function stopTicker() {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}

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
  if (message.type === "activity") {
    // Content script reports user activity
    if (sender.tab?.id) {
      activeTabs.set(sender.tab.id, Date.now());
    }
    return;
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
    // For popup: return session time
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
    // Mark toast as dismissed for this session
    chrome.storage.session.set({ toastDismissed: true });
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "resetSession") {
    chrome.storage.session.set({ sessionTime: 0, toastDismissed: false });
    // Tell all injected tabs to hide toast
    for (const tabId of injectedTabs) {
      chrome.tabs.sendMessage(tabId, { type: "resetToast" }).catch(() => {});
    }
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "resetArticle") {
    // Reset session timer + clear dismissed state for current article URL
    chrome.storage.session.set({ sessionTime: 0, toastDismissed: false });
    if (message.url) {
      chrome.storage.local.get({ dismissedArticles: [] }, (data) => {
        const list = data.dismissedArticles.filter((u) => u !== message.url);
        chrome.storage.local.set({ dismissedArticles: list });
      });
    }
    for (const tabId of injectedTabs) {
      chrome.tabs.sendMessage(tabId, { type: "resetToast" }).catch(() => {});
    }
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "thresholdChanged") {
    // Threshold change may trigger toast immediately — handled by the ticker
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "enabledChanged") {
    for (const tabId of injectedTabs) {
      chrome.tabs.sendMessage(tabId, {
        type: "updateEnabled",
        enabled: message.enabled,
      }).catch(() => {});
    }
    sendResponse({ ok: true });
    return true;
  }
});
