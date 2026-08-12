// Track the last right-clicked element for context menu
let lastRightClickedElement = null;

document.addEventListener("contextmenu", (e) => {
  lastRightClickedElement = e.target;
});

// CSS for downloaded indicator
const styleSheet = document.createElement("style");
styleSheet.textContent = `
  .zoom-summary-downloaded {
    position: relative;
  }
  .zoom-summary-downloaded::after {
    content: "✓";
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    color: #22c55e;
    font-weight: bold;
    font-size: 16px;
  }
  .zoom-summary-downloaded td:first-child {
    border-left: 3px solid #22c55e !important;
  }
`;
document.head.appendChild(styleSheet);

// Parse date from row text to YYYY-MM-DD format
function parseDateFromRow(text) {
  const monthMap = {
    "jan": "01", "feb": "02", "mar": "03", "apr": "04",
    "may": "05", "jun": "06", "jul": "07", "aug": "08",
    "sep": "09", "oct": "10", "nov": "11", "dec": "12"
  };
  
  const match = text.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),?\s+(\d{4})/i);
  if (match) {
    const month = monthMap[match[1].toLowerCase()];
    const day = match[2].padStart(2, "0");
    const year = match[3];
    return `${year}-${month}-${day}`;
  }
  return null;
}

// Extract meeting ID from row text
function parseMeetingIdFromRow(text) {
  const match = text.match(/\b(\d{3}[-\s]?\d{3,4}[-\s]?\d{4})\b/);
  if (match) {
    return match[1].replace(/[\s-]/g, "");
  }
  return null;
}

// Mark a single row as downloaded
function markRowAsDownloaded(row) {
  if (!row.classList.contains("zoom-summary-downloaded")) {
    row.classList.add("zoom-summary-downloaded");
  }
}

// Check all visible rows and mark downloaded ones
async function markDownloadedRows() {
  try {
    const stored = await chrome.storage.local.get("downloadedSummaries");
    const downloaded = stored.downloadedSummaries || {};
    
    if (Object.keys(downloaded).length === 0) return;
    
    const rows = document.querySelectorAll('tr[role="row"], [role="row"]');
    
    for (const row of rows) {
      const rowText = row.innerText || "";
      const meetingId = parseMeetingIdFromRow(rowText);
      const dateStr = parseDateFromRow(rowText);
      
      if (meetingId && dateStr) {
        const key = `${meetingId}-${dateStr}`;
        if (downloaded[key]) {
          markRowAsDownloaded(row);
        }
      }
    }
  } catch (_err) {
    // Ignore errors silently
  }
}

// Run on page load and watch for dynamic content
if (window.location.href.includes("zoom.us") && window.location.href.includes("summary")) {
  // Initial check after page loads
  setTimeout(markDownloadedRows, 1500);
  
  // Watch for dynamic content changes (Zoom uses SPA navigation)
  const observer = new MutationObserver((_mutations) => {
    // Debounce the check
    clearTimeout(window._markDownloadedTimeout);
    window._markDownloadedTimeout = setTimeout(markDownloadedRows, 500);
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "markDownloaded") {
    // Mark specific row as downloaded after download completes
    setTimeout(markDownloadedRows, 500);
    sendResponse({ success: true });
    return true;
  }
  
  if (request.action === "refreshDownloadedIndicators") {
    // Re-check all rows after import
    markDownloadedRows();
    sendResponse({ success: true });
    return true;
  }
  
  if (request.action === "getClickedMeetingInfo") {
    try {
      if (!lastRightClickedElement) {
        sendResponse({ error: "No element clicked" });
        return;
      }
      
      // Find the parent row/container for this meeting item
      const row = lastRightClickedElement.closest('tr, [class*="list-item"], [class*="meeting-item"], [class*="summary-item"], [role="row"], div[class*="row"]');
      
      if (!row) {
        // Try getting data from the clicked element's parent container
        const container = lastRightClickedElement.closest("div, td");
        if (container) {
          const text = container.innerText || "";
          sendResponse({ rowText: text, fullPage: false });
          return;
        }
        sendResponse({ error: "Could not find meeting row" });
        return;
      }
      
      const rowText = row.innerText || "";
      
      // Look for the encoded meeting ID in data-key attribute
      const meetingIdEncoded = row.getAttribute("data-key") || "";
      const numericMeetingId = "";
      
      sendResponse({ 
        rowText: rowText,
        meetingIdEncoded: meetingIdEncoded,
        numericMeetingId: numericMeetingId,
        fullPage: false
      });
    } catch (err) {
      sendResponse({ error: err.message });
    }
    return true;
  }
  
  if (request.action === "clickMeetingRow") {
    try {
      if (!lastRightClickedElement) {
        sendResponse({ error: "No element to click" });
        return;
      }
      
      // Find the parent row
      const row = lastRightClickedElement.closest('tr, [role="row"]');
      if (!row) {
        sendResponse({ error: "Could not find meeting row" });
        return;
      }
      
      // Find the clickable topic button/link within the row
      const topicButton = row.querySelector('button.topic-link, [class*="topic"], a');
      
      if (topicButton) {
        topicButton.click();
        sendResponse({ success: true, clicked: "topic button" });
      } else {
        // Try clicking the row itself
        row.click();
        sendResponse({ success: true, clicked: "row" });
      }
    } catch (err) {
      sendResponse({ error: err.message });
    }
    return true;
  }
  
  if (request.action === "extractSummaryContent") {
    try {
      const bodyText = document.body ? document.body.innerText : "";
      const url = window.location.href;
      const isDocFrame = url.includes("docs.zoom.us");
      
      // Extract date/time
      let dateTime = "";
      const dateMatch = bodyText.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}\s+\d{1,2}:\d{2}\s+(?:AM|PM)(?:\s+[A-Za-z\s()]+)?)/i);
      if (dateMatch) {
        dateTime = dateMatch[1].trim()
          .replace(/\(US and Canada\)/gi, "")
          .replace(/\s+/g, " ")
          .trim();
      }
      
      // Extract title
      let title = "";
      const topicEl = document.querySelector('[class*="topic"], .meeting-topic, .summary-topic');
      if (topicEl) {
        title = topicEl.innerText.trim();
      }
      if (!title) {
        const topicMatch = bodyText.match(/(?:Topic|Meeting Summary for):\s*([^\n]+)/i);
        if (topicMatch) {
          title = topicMatch[1].trim();
        }
      }
      if (title) {
        title = title
          .replace(/^Topic:\s*/i, "")
          .replace(/^Meeting Summary for\s*/i, "")
          .replace(/\s*-\s*Zoom$/i, "")
          .trim();
      }
      
      // Extract summary content
      let summaryText = "";
      const selectors = [".doc-content", ".ProseMirror", '[contenteditable="true"]', ".ql-editor", ".summary-web-detail-wrapper"];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.innerText && el.innerText.trim().length > 30) {
          summaryText = el.innerText.trim();
          break;
        }
      }
      
      if (!summaryText || summaryText.length < 50) {
        const paragraphs = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, p, li"))
          .map(e => e.innerText ? e.innerText.trim() : "")
          .filter(t => t.length > 0);
        summaryText = paragraphs.join("\n\n");
      }
      
      sendResponse({
        isDocFrame: isDocFrame,
        url: url,
        title: title,
        dateTime: dateTime,
        summaryText: summaryText
      });
    } catch (err) {
      sendResponse({ error: err.message });
    }
    return true;
  }
});

document.addEventListener("selectionchange", () => {
  try {
    const selectedText = window.getSelection().toString().trim();
    if (selectedText.length > 0 && chrome?.storage?.local) {
      chrome.storage.local.set({ lastSelectedText: selectedText });
    }
  } catch (_err) {
    // Extension context may be invalidated, ignore silently
  }
});