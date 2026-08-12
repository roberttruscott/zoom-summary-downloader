// Create context menu on install/update
chrome.runtime.onInstalled.addListener(() => {
  // Remove any existing menu items first
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "downloadZoomSummary",
      title: "Download Summary",
      contexts: ["link", "selection", "page"],
      documentUrlPatterns: ["https://*.zoom.us/*"]
    });
  });
});

// Parses a date string like "Jul 02, 2026 07:58 AM Pacific Time" into "2026-07-02"
function parseMeetingDate(dateTimeStr) {
  if (!dateTimeStr) return null;
  
  const monthMap = {
    "jan": "01", "feb": "02", "mar": "03", "apr": "04",
    "may": "05", "jun": "06", "jul": "07", "aug": "08",
    "sep": "09", "oct": "10", "nov": "11", "dec": "12"
  };
  
  // Try multiple date patterns
  // Pattern 1: "Jul 02, 2026" or "Jul 2, 2026"
  let match = dateTimeStr.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),?\s+(\d{4})/i);
  if (match) {
    const month = monthMap[match[1].toLowerCase()];
    const day = match[2].padStart(2, "0");
    const year = match[3];
    return `${year}-${month}-${day}`;
  }
  
  // Pattern 2: "2026-07-02" (already ISO format)
  match = dateTimeStr.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return match[0];
  }
  
  // Pattern 3: "07/02/2026" or "7/2/2026"
  match = dateTimeStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (match) {
    const month = match[1].padStart(2, "0");
    const day = match[2].padStart(2, "0");
    const year = match[3];
    return `${year}-${month}-${day}`;
  }
  
  return null;
}

// Converts raw text to clean Markdown (simplified version for background)
function convertToMarkdown(text, title, dateTime, sourceUrl) {
  if (!text) return "";

  let cleaned = text
    .replace(/AI can make mistakes\.?\s*Review for accuracy\.?/gi, "")
    .replace(/Please rate the accuracy of this summary\.?/gi, "")
    .replace(/Was this summary helpful\?/gi, "")
    .replace(/Click to edit\.?/gi, "")
    .trim();

  cleaned = cleaned.replace(/^[•·\u25CF\u2022]\s*/gm, "- ");

  const mainHeaders = ["Quick recap", "Next steps", "Summary"];
  mainHeaders.forEach(header => {
    const regex = new RegExp(`^${header}$`, "gim");
    cleaned = cleaned.replace(regex, `## ${header}`);
  });

  const lines = cleaned.split("\n");
  const formattedLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return "";
    if (/^#*\s*Click to edit/i.test(trimmed)) return "";
    if (trimmed.startsWith("#") || trimmed.startsWith("- ") || trimmed.startsWith("* ")) return line;
    if (trimmed.length > 0 && trimmed.length < 60 && !/[.?!]$/.test(trimmed)) {
      return `### ${trimmed}`;
    }
    return line;
  });

  let markdownBody = formattedLines
    .join("\n")
    .replace(/^(###?\s+[^\n]+)\n+\1$/gm, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  let headerBlock = "";
  if (title) headerBlock += `# ${title}\n`;
  if (dateTime) headerBlock += `*${dateTime}*\n`;
  if (sourceUrl) headerBlock += `[View on Zoom](${sourceUrl})\n`;

  if (headerBlock && !markdownBody.startsWith("# ")) {
    markdownBody = `${headerBlock}\n${markdownBody}`;
  }

  return markdownBody;
}

// Handle context menu click
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "downloadZoomSummary") {
    try {
      // First, get basic info about the clicked row (date, meeting ID, title from the list)
      const meetingInfo = await chrome.tabs.sendMessage(tab.id, { action: "getClickedMeetingInfo" });
      
      if (meetingInfo.error) {
        console.error("Error getting meeting info:", meetingInfo.error);
        return;
      }
      
      const rowText = meetingInfo.rowText || "";
      
      // Extract meeting date from the row text (this is the date we want for the filename)
      let rowDateTime = "";
      const dateMatch = rowText.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}\s+\d{1,2}:\d{2}\s+(?:AM|PM))/i) ||
                        rowText.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4})/i);
      if (dateMatch) {
        rowDateTime = dateMatch[1].trim();
      }
      
      // Extract meeting ID from row text
      let meetingId = "";
      const idMatch = rowText.match(/\b(\d{3}[-\s]?\d{3,4}[-\s]?\d{4})\b/);
      if (idMatch) {
        meetingId = idMatch[1].replace(/[\s-]/g, "");
      }
      
      // Extract title from row text
      let title = "";
      const lines = rowText.split("\n").map(l => l.trim()).filter(l => l.length > 0);
      for (const line of lines) {
        if (!line.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+/i) &&
            !line.match(/^\d{3}[-\s]?\d{3,4}[-\s]?\d{4}$/) &&
            !line.match(/@/) &&  // Skip email addresses
            line.length > 3 && line.length < 100) {
          title = line;
          break;
        }
      }
      
      // Click the row to navigate to the detail page
      const clickResult = await chrome.tabs.sendMessage(tab.id, { action: "clickMeetingRow" });
      
      if (clickResult.error) {
        console.error("Error clicking row:", clickResult.error);
        return;
      }
      
      // Wait for navigation and page load
      await new Promise(r => setTimeout(r, 3000));
      
      // Extract the summary content from all frames
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: () => {
          const bodyText = document.body ? document.body.innerText : "";
          const url = window.location.href;
          const isDocFrame = url.includes("docs.zoom.us");
          
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
          
          // Also try to get date from detail page
          let dateTime = "";
          const dateMatch = bodyText.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}\s+\d{1,2}:\d{2}\s+(?:AM|PM)(?:\s+[A-Za-z\s()]+)?)/i);
          if (dateMatch) {
            dateTime = dateMatch[1].trim()
              .replace(/\(US and Canada\)/gi, "")
              .replace(/\s+/g, " ")
              .trim();
          }
          
          return {
            isDocFrame: isDocFrame,
            url: url,
            dateTime: dateTime,
            summaryText: summaryText
          };
        }
      });
      
      // Prioritize doc frame content
      let summaryText = "";
      let detailDateTime = "";
      let detailUrl = "";
      const docFrame = results.find(r => r.result && r.result.isDocFrame);
      if (docFrame && docFrame.result) {
        summaryText = docFrame.result.summaryText || "";
        detailDateTime = docFrame.result.dateTime || "";
      }
      
      // Get the detail page URL (from the main frame, not the doc iframe)
      const mainFrame = results.find(r => r.result && !r.result.isDocFrame && r.result.url && r.result.url.includes("#/detail"));
      if (mainFrame && mainFrame.result) {
        detailUrl = mainFrame.result.url;
      }
      
      // Fall back to other frames
      if (!summaryText) {
        for (const r of results) {
          if (r.result && r.result.summaryText && r.result.summaryText.length > 50) {
            summaryText = r.result.summaryText;
            if (!detailDateTime && r.result.dateTime) {
              detailDateTime = r.result.dateTime;
            }
            break;
          }
        }
      }
      
      // Use the date from the ROW (list page) for the filename
      const dateTimeForFilename = rowDateTime || detailDateTime;
      
      // Convert to markdown (include source URL)
      const markdown = convertToMarkdown(summaryText, title, detailDateTime || rowDateTime, detailUrl);
      
      // Generate filename using the row date
      const dateStr = parseMeetingDate(dateTimeForFilename) || new Date().toISOString().slice(0, 10);
      const filename = meetingId ? `${meetingId}-${dateStr}.md` : `Zoom_Summary_${dateStr}.md`;
      
      // Download the file
      const blobUrl = "data:text/markdown;charset=utf-8," + encodeURIComponent(markdown);
      chrome.downloads.download({
        url: blobUrl,
        filename: filename,
        saveAs: false
      }, async (_downloadId) => {
        if (!chrome.runtime.lastError && meetingId && dateStr) {
          // Store downloaded file info for visual tracking
          const key = `${meetingId}-${dateStr}`;
          const stored = await chrome.storage.local.get("downloadedSummaries");
          const downloaded = stored.downloadedSummaries || {};
          downloaded[key] = { meetingId, date: dateStr, downloadedAt: new Date().toISOString() };
          await chrome.storage.local.set({ downloadedSummaries: downloaded });
          
          // Notify content script to update UI
          chrome.tabs.sendMessage(tab.id, { action: "markDownloaded", key: key });
        }
      });
      
      // Navigate back to the list page
      await chrome.tabs.goBack(tab.id);
      
    } catch (err) {
      console.error("Error fetching summary:", err);
    }
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "download_summary") {
    const textContent = request.data || "";
    const blobUrl = "data:text/markdown;charset=utf-8," + encodeURIComponent(textContent);
    const defaultFilename = `Zoom_Summary_${new Date().toISOString().slice(0, 10)}.md`;
    const filename = request.filename || defaultFilename;

    chrome.downloads.download({
      url: blobUrl,
      filename: filename,
      saveAs: false
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        sendResponse({ status: "error", error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ status: "success", downloadId: downloadId });
      }
    });

    return true;
  }
});