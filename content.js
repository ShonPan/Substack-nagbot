// Content script — injected into Substack article pages
// Reports activity to background; background owns the session timer.
// Content script drives the tick loop (survives service worker suspension).

(() => {
  // Prevent double-initialization if script is injected again
  if (window.__micInjected) return;
  window.__micInjected = true;

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
    startTickLoop();
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

  // --- Tick loop: sends one message per active second to background ---
  function startTickLoop() {
    setInterval(async () => {
      if (!isActive()) return;

      try {
        const resp = await msg({ type: "tick" });
        if (resp.showToast && !toastShowing) {
          showToast(resp.time);
        }
      } catch {}
    }, 1000);
  }

  // --- Toast (shown when background says threshold is reached) ---
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
        <p class="mic-toast-msg">You've spent <strong>${timeLabel}</strong> on Substack. <span class="mic-tooltip-wrap">Make it count?<span class="mic-tooltip">Active engagement\u2014commenting, sharing, questioning\u2014builds understanding.</span></span></p>
        <div class="mic-toast-actions">
          <button class="mic-btn mic-btn-primary" id="mic-notes">Take notes</button>
          <button class="mic-btn mic-btn-secondary" id="mic-share">Share</button>
          <button class="mic-btn mic-btn-ghost" id="mic-dismiss">Dismiss</button>
        </div>
      </div>
    `;
    document.body.appendChild(toastEl);

    requestAnimationFrame(() => toastEl.classList.add("mic-visible"));

    document.getElementById("mic-notes").addEventListener("click", openNotesPanel);
    document.getElementById("mic-share").addEventListener("click", shareArticle);
    document.getElementById("mic-dismiss").addEventListener("click", dismissToast);
  }

  function removeToast() {
    if (!toastEl) return;
    const el = toastEl;
    toastEl = null;
    el.classList.remove("mic-visible");
    el.addEventListener("transitionend", () => el.remove(), { once: true });
    setTimeout(() => { try { el.remove(); } catch(e) {} }, 500);
  }

  let notesPanelEl = null;

  function openNotesPanel() {
    removeToast();
    if (notesPanelEl) return;

    const title = document.querySelector("h1.post-title, h1")?.textContent?.trim() || document.title;

    notesPanelEl = document.createElement("div");
    notesPanelEl.id = "mic-notes-panel";
    notesPanelEl.innerHTML = `
      <div class="mic-notes-inner">
        <div class="mic-notes-header">
          <span class="mic-notes-title">Notes</span>
          <button class="mic-notes-close" id="mic-notes-close">\u00d7</button>
        </div>
        <textarea class="mic-notes-textarea" id="mic-notes-textarea" placeholder="What stood out? What do you disagree with? What would you ask the author?"></textarea>
        <div class="mic-notes-footer">
          <button class="mic-btn mic-btn-secondary" id="mic-send-obsidian">Send to Obsidian</button>
          <button class="mic-btn mic-btn-primary" id="mic-write-reply">Write a reply</button>
        </div>
      </div>
    `;
    document.body.appendChild(notesPanelEl);
    requestAnimationFrame(() => notesPanelEl.classList.add("mic-visible"));

    document.getElementById("mic-notes-textarea").focus();

    document.getElementById("mic-notes-close").addEventListener("click", closeNotesPanel);
    document.getElementById("mic-send-obsidian").addEventListener("click", () => {
      const notes = document.getElementById("mic-notes-textarea").value;
      sendToObsidian(title, notes);
    });
    document.getElementById("mic-write-reply").addEventListener("click", () => {
      scrollToComments();
    });
  }

  function closeNotesPanel() {
    if (!notesPanelEl) return;
    const el = notesPanelEl;
    notesPanelEl = null;
    el.classList.remove("mic-visible");
    el.addEventListener("transitionend", () => el.remove(), { once: true });
    setTimeout(() => { try { el.remove(); } catch(e) {} }, 500);
  }

  function sendToObsidian(title, notes) {
    const content = `# ${title}\n\nSource: ${articleUrl()}\n\n## Notes\n\n${notes}`;
    const uri = `obsidian://new?name=${encodeURIComponent(title)}&content=${encodeURIComponent(content)}`;
    window.open(uri, "_self");
    closeNotesPanel();
  }

  function scrollToComments() {
    const notes = document.getElementById("mic-notes-textarea")?.value || "";
    closeNotesPanel();

    const commentSection =
      document.querySelector(".comments-page") ||
      document.querySelector('[data-testid="comment-list"]') ||
      document.querySelector(".comments") ||
      document.querySelector("#entry-comments") ||
      document.querySelector(".post-footer");

    if (commentSection) {
      commentSection.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    }

    if (!notes) return;

    // Substack lazy-loads the comment editor. Click the comment button to open it,
    // then poll for the editor to appear.
    setTimeout(() => {
      // Try clicking a "write a comment" or reply button to open the editor
      const commentBtn =
        document.querySelector('button[data-testid="comment-button"]') ||
        document.querySelector('button.reader-comments-header-button') ||
        document.querySelector('.comment-input-wrap') ||
        Array.from(document.querySelectorAll("button")).find(
          (b) => /write a comment|leave a comment|add a comment/i.test(b.textContent)
        );
      if (commentBtn) commentBtn.click();

      // Poll for the editor to appear (up to 5 seconds)
      let attempts = 0;
      const poll = setInterval(() => {
        attempts++;
        const editor = findCommentEditor();
        if (editor) {
          clearInterval(poll);
          fillEditor(editor, notes);
        } else if (attempts > 25) {
          clearInterval(poll);
          // Fallback: copy to clipboard so user can paste manually
          navigator.clipboard.writeText(notes).catch(() => {});
        }
      }, 200);
    }, 800);
  }

  function findCommentEditor() {
    // Substack uses ProseMirror/Tiptap with contenteditable
    return (
      document.querySelector('.comment-input-wrap [contenteditable="true"]') ||
      document.querySelector('.tiptap[contenteditable="true"]') ||
      document.querySelector('.ProseMirror[contenteditable="true"]') ||
      document.querySelector('[data-testid="comment-input"] [contenteditable="true"]') ||
      document.querySelector('.comments [contenteditable="true"]') ||
      document.querySelector('.comments-page [contenteditable="true"]') ||
      document.querySelector('.post-footer [contenteditable="true"]') ||
      // Broad fallback: any contenteditable near the bottom of the page
      Array.from(document.querySelectorAll('[contenteditable="true"]')).pop() ||
      document.querySelector(".comments textarea")
    );
  }

  function fillEditor(el, text) {
    el.focus();
    if (el.tagName === "TEXTAREA") {
      el.value = text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      // ProseMirror/Tiptap: insert via execCommand so the editor registers the change
      document.execCommand("insertText", false, text);
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
    if (message.type === "openNotes") {
      openNotesPanel();
      sendResponse({ ok: true });
      return true;
    }
    if (message.type === "resetToast") {
      toastShowing = false;
      removeToast();
      return;
    }
    if (message.type === "queryTime") {
      // Popup queries — ask background for session time
      chrome.runtime.sendMessage({ type: "getSessionTime" }, (data) => {
        sendResponse({ time: data?.time || 0, url: articleUrl() });
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
