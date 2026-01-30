// Content script — injected into Substack article pages
// Reports activity to background; background owns the session timer.

(() => {
  const ACTIVITY_TIMEOUT = 60_000;
  let enabled = true;
  let lastActivity = Date.now();
  let toastEl = null;
  let toastShowing = false;

  init();

  async function init() {
    const settings = await msg({ type: "getSettings" });
    enabled = settings.enabled;

    attachActivityListeners();
    startActivityReporter();
  }

  // --- Activity detection ---
  function attachActivityListeners() {
    const bump = debounce(() => {
      lastActivity = Date.now();
    }, 200);
    document.addEventListener("scroll", bump, { passive: true });
    document.addEventListener("mousemove", bump, { passive: true });
    document.addEventListener("keydown", bump, { passive: true });
  }

  function isActive() {
    return (
      enabled &&
      document.visibilityState === "visible" &&
      Date.now() - lastActivity < ACTIVITY_TIMEOUT
    );
  }

  // Report activity to background every second
  function startActivityReporter() {
    setInterval(() => {
      if (isActive()) {
        chrome.runtime.sendMessage({ type: "activity" }).catch(() => {});
      }
    }, 1000);
  }

  // --- Toast (shown on command from background) ---
  function showToast(totalSeconds) {
    if (toastShowing) return;
    toastShowing = true;

    const minutes = Math.floor(totalSeconds / 60);
    const timeLabel =
      minutes < 1
        ? `${totalSeconds} seconds`
        : minutes === 1
          ? "1 minute"
          : `${minutes} minutes`;

    toastEl = document.createElement("div");
    toastEl.id = "mic-toast";
    toastEl.innerHTML = `
      <div class="mic-toast-inner">
        <p class="mic-toast-msg">You've spent <strong>${timeLabel}</strong> on Substack. <span class="mic-tooltip-wrap">Make it count?<span class="mic-tooltip">Active engagement—commenting, sharing, questioning—builds understanding. Passive scrolling doesn't.</span></span></p>
        <div class="mic-toast-actions">
          <button class="mic-btn mic-btn-primary" id="mic-reply">Write a reply</button>
          <button class="mic-btn mic-btn-secondary" id="mic-share">Share</button>
          <button class="mic-btn mic-btn-ghost" id="mic-dismiss">Dismiss</button>
        </div>
      </div>
    `;
    document.body.appendChild(toastEl);

    requestAnimationFrame(() => toastEl.classList.add("mic-visible"));

    document.getElementById("mic-reply").addEventListener("click", scrollToComments);
    document.getElementById("mic-share").addEventListener("click", shareArticle);
    document.getElementById("mic-dismiss").addEventListener("click", dismissToast);
  }

  function removeToast() {
    if (!toastEl) return;
    toastEl.classList.remove("mic-visible");
    toastEl.addEventListener("transitionend", () => toastEl.remove(), { once: true });
    setTimeout(() => { try { toastEl.remove(); } catch(e) {} }, 500);
    toastEl = null;
  }

  function scrollToComments() {
    removeToast();
    const commentSection =
      document.querySelector(".comments-page") ||
      document.querySelector('[data-testid="comment-list"]') ||
      document.querySelector(".comments") ||
      document.querySelector("#entry-comments") ||
      document.querySelector(".post-footer");

    if (commentSection) {
      commentSection.scrollIntoView({ behavior: "smooth", block: "start" });
      setTimeout(() => {
        const input =
          commentSection.querySelector("textarea") ||
          commentSection.querySelector('[contenteditable="true"]') ||
          commentSection.querySelector(".tiptap");
        if (input) input.focus();
      }, 600);
    } else {
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    }
  }

  async function shareArticle() {
    const shareBtn = document.getElementById("mic-share");
    try {
      await navigator.clipboard.writeText(articleUrl());
      shareBtn.textContent = "Copied!";
      setTimeout(() => removeToast(), 1200);
    } catch {
      shareBtn.textContent = "Failed";
      setTimeout(() => removeToast(), 1200);
    }
  }

  async function dismissToast() {
    removeToast();
    toastShowing = false;
    await msg({ type: "toastDismissed" });
  }

  // --- Message handling from background ---
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "showToast") {
      showToast(message.time);
      return;
    }
    if (message.type === "resetToast") {
      toastShowing = false;
      removeToast();
      return;
    }
    if (message.type === "queryTime") {
      // Popup queries — forward to background for session time
      chrome.storage.session.get({ sessionTime: 0 }, (data) => {
        sendResponse({ time: data.sessionTime, url: articleUrl() });
      });
      return true;
    }
    if (message.type === "updateEnabled") {
      enabled = message.enabled;
      if (!enabled) removeToast();
      return;
    }
  });

  // --- Helpers ---
  function articleUrl() {
    return location.origin + location.pathname;
  }

  function msg(data) {
    return new Promise((resolve) =>
      chrome.runtime.sendMessage(data, (resp) => resolve(resp || {}))
    );
  }

  function debounce(fn, ms) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }
})();
