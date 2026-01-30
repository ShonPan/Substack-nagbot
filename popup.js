const slider = document.getElementById("threshold-slider");
const label = document.getElementById("threshold-label");
const enabledToggle = document.getElementById("enabled-toggle");
const resetBtn = document.getElementById("reset-btn");
const currentTimeEl = document.getElementById("current-time");
const statusNote = document.getElementById("status-note");
const presetBtns = document.querySelectorAll(".preset-btn");

let currentArticleUrl = null;
let activeTabId = null;

// --- Init ---
chrome.storage.local.get({ threshold: 900, enabled: true }, (settings) => {
  slider.value = settings.threshold;
  enabledToggle.checked = settings.enabled;
  updateLabel(settings.threshold);
  updatePresetHighlight(settings.threshold);
});

// Check if on a Substack tab, then show session time
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tab = tabs[0];
  if (!tab?.id) {
    showInactive("No active tab");
    return;
  }

  activeTabId = tab.id;

  // Try to reach the content script to confirm we're on Substack
  chrome.tabs.sendMessage(tab.id, { type: "queryTime" }, (resp) => {
    if (chrome.runtime.lastError || !resp) {
      // Not on a Substack page — still show session time if there is one
      chrome.storage.session.get({ sessionTime: 0 }, (data) => {
        if (data.sessionTime > 0) {
          updateTimeDisplay(data.sessionTime);
          statusNote.textContent = "Substack session time";
          resetBtn.disabled = false;
        } else {
          showInactive("Not on a Substack article");
        }
      });
      return;
    }

    currentArticleUrl = resp.url;
    resetBtn.disabled = false;
    currentTimeEl.classList.remove("inactive");
    statusNote.textContent = "Substack session time";
    updateTimeDisplay(resp.time);

    // Poll for updates while popup is open
    setInterval(() => {
      chrome.storage.session.get({ sessionTime: 0 }, (data) => {
        updateTimeDisplay(data.sessionTime);
      });
    }, 1000);
  });
});

function showInactive(msg) {
  currentTimeEl.textContent = "--";
  currentTimeEl.classList.add("inactive");
  statusNote.textContent = msg;
  resetBtn.disabled = true;
}

// --- Threshold slider ---
slider.addEventListener("input", () => {
  const val = parseInt(slider.value, 10);
  updateLabel(val);
  updatePresetHighlight(val);
});

slider.addEventListener("change", () => {
  const val = parseInt(slider.value, 10);
  saveThreshold(val);
});

// --- Preset buttons ---
presetBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const val = parseInt(btn.dataset.value, 10);
    slider.value = val;
    updateLabel(val);
    updatePresetHighlight(val);
    saveThreshold(val);
  });
});

// --- Enable/disable ---
enabledToggle.addEventListener("change", () => {
  const enabled = enabledToggle.checked;
  chrome.storage.local.set({ enabled });
  chrome.runtime.sendMessage({ type: "enabledChanged", enabled });
});

// --- Reset ---
resetBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "resetSession" }, () => {
    currentTimeEl.textContent = "0:00";
    statusNote.textContent = "Session reset";
  });
});

// --- Helpers ---
function saveThreshold(val) {
  chrome.storage.local.set({ threshold: val });
  chrome.runtime.sendMessage({ type: "thresholdChanged", threshold: val });
}

function updateLabel(seconds) {
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  if (min === 0) {
    label.textContent = `${sec} sec`;
  } else if (sec === 0) {
    label.textContent = `${min} min`;
  } else {
    label.textContent = `${min} min ${sec} sec`;
  }
}

function updatePresetHighlight(val) {
  presetBtns.forEach((btn) => {
    btn.classList.toggle("active", parseInt(btn.dataset.value, 10) === val);
  });
}

function updateTimeDisplay(totalSeconds) {
  const min = Math.floor(totalSeconds / 60);
  const sec = totalSeconds % 60;
  currentTimeEl.textContent = `${min}:${sec.toString().padStart(2, "0")}`;
}
