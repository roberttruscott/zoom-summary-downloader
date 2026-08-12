let frameResults = [];
let detectedMeetingTitle = "";
let detectedMeetingDateTime = "";
let detectedSourceUrl = "";

// Converts raw scraped text into clean, structured Markdown with an H1 Topic Header and Subtitle
function convertToMarkdown(text, title, dateTime, sourceUrl) {
  if (!text) return "";

  // 1. Remove AI disclaimers, rating footers, and editor UI placeholders
  let cleaned = text
    .replace(/AI can make mistakes\.?\s*Review for accuracy\.?/gi, "")
    .replace(/Please rate the accuracy of this summary\.?/gi, "")
    .replace(/Was this summary helpful\?/gi, "")
    .replace(/Click to edit\.?/gi, "")
    .trim();

  // 2. Convert unicode bullet points to Markdown list items
  cleaned = cleaned.replace(/^[•·\u25CF\u2022]\s*/gm, "- ");

  // 3. Format primary section headings
  const mainHeaders = ["Quick recap", "Next steps", "Summary"];
  mainHeaders.forEach(header => {
    const regex = new RegExp(`^${header}$`, "gim");
    cleaned = cleaned.replace(regex, `## ${header}`);
  });

  // 4. Format subsections, topic titles, and attendee names as H3
  const lines = cleaned.split("\n");
  const formattedLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return "";

    // Ignore leftover UI prompt text
    if (/^#*\s*Click to edit/i.test(trimmed)) {
      return "";
    }

    // Skip lines already formatted as headers or list items
    if (trimmed.startsWith("#") || trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      return line;
    }

    // Convert short, non-punctuated topic/assignee titles into subheadings
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

  // Build top header block (H1 Title + Subtitle Date/Time)
  let headerBlock = "";
  if (title) {
    headerBlock += `# ${title}\n`;
  }
  if (dateTime) {
    headerBlock += `*${dateTime}*\n`;
  }
  if (sourceUrl) {
    headerBlock += `[View on Zoom](${sourceUrl})\n`;
  }

  // Prepend title and subtitle block if available
  if (headerBlock && !markdownBody.startsWith("# ")) {
    markdownBody = `${headerBlock}\n${markdownBody}`;
  }

  return markdownBody;
}

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

// Scrapes Zoom Meeting ID and formats file as <meeting-id>-<date>.md
async function getSanitizedFilename(tabId) {
  // Use the detected meeting date, or fall back to current date
  const dateStr = parseMeetingDate(detectedMeetingDateTime) || new Date().toISOString().slice(0, 10);
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId, allFrames: true },
      func: () => {
        const bodyText = document.body ? document.body.innerText : "";

        const idMatch = bodyText.match(/(?:Meeting\s*ID|ID):\s*([\d\s-]{9,15})/i);
        if (idMatch && idMatch[1]) {
          const cleaned = idMatch[1].replace(/\s+/g, "").trim();
          if (cleaned.length >= 9 && cleaned.length <= 11) {
            return cleaned;
          }
        }

        const formattedMatch = bodyText.match(/\b\d{3}[-\s]?\d{3,4}[-\s]?\d{4}\b/);
        if (formattedMatch) {
          return formattedMatch[0].replace(/[\s-]/g, "");
        }

        const urlMatch = window.location.href.match(/\b\d{9,11}\b/);
        if (urlMatch) {
          return urlMatch[0];
        }

        return "";
      }
    });

    let meetingId = "";
    if (results && results.length > 0) {
      const found = results.find(r => r.result && r.result.length >= 9);
      if (found) meetingId = found.result;
    }

    return meetingId ? `${meetingId}-${dateStr}.md` : `Zoom_Summary_${dateStr}.md`;
  } catch (_err) {
    return `Zoom_Summary_${dateStr}.md`;
  }
}

document.getElementById("scanBtn").addEventListener("click", async () => {
  const statusDiv = document.getElementById("status");
  statusDiv.innerText = "Scanning page & frames...";

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab || !tab.url.includes("zoom.us")) {
    statusDiv.innerText = "Please open a Zoom web page.";
    return;
  }

  try {
    const stored = await chrome.storage.local.get("lastSelectedText");
    const storedSelection = stored.lastSelectedText || "";

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: () => {
        const url = window.location.href;
        const isDocFrame = url.includes("docs.zoom.us");

        let rawTitle = "";
        let rawDateTime = "";

        // Strategy 1: Targeted topic selectors
        const topicEl = document.querySelector('[class*="topic"], .meeting-topic, .summary-topic, [data-testimonial-id*="topic"]');
        if (topicEl && topicEl.innerText.trim().length > 0) {
          rawTitle = topicEl.innerText.trim();
        }

        // Strategy 2: Scrape date/time elements and text patterns
        const dateEl = document.querySelector('[class*="date"], [class*="time"], .meeting-date, .summary-date');
        if (dateEl && dateEl.innerText.trim().length > 0) {
          rawDateTime = dateEl.innerText.trim();
        }

        const bodyText = document.body ? document.body.innerText : "";

        if (!rawTitle) {
          const topicMatch = bodyText.match(/(?:Topic|Meeting Summary for):\s*([^\n]+)/i) ||
                             bodyText.match(/Meeting Summary for\s+([^\n]+)/i);
          if (topicMatch && topicMatch[1]) {
            rawTitle = topicMatch[1].trim();
          }
        }

        if (!rawDateTime) {
          const dateMatch = bodyText.match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}\s+\d{1,2}:\d{2}\s+(?:AM|PM)(?:\s+[A-Za-z\s()]+)?/i) ||
                            bodyText.match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}/i);
          if (dateMatch) {
            rawDateTime = dateMatch[0].trim();
          }
        }

        // Strategy 3: Standard title/heading fallback
        if (!rawTitle) {
          const titleEl = document.querySelector('h1, .meeting-title, [class*="title"]');
          if (titleEl && titleEl.innerText.trim().length > 0) {
            rawTitle = titleEl.innerText.trim();
          } else if (document.title) {
            rawTitle = document.title;
          }
        }

        // Clean up title text
        if (rawTitle) {
          rawTitle = rawTitle
            .replace(/^Topic:\s*/i, "")
            .replace(/^Meeting Summary for\s*/i, "")
            .replace(/\s*-\s*Zoom$/i, "")
            .replace(/New look and feel for Zoom Web!/i, "")
            .trim();
        }

        // Clean up date/time string
        if (rawDateTime) {
          rawDateTime = rawDateTime
            .replace(/\(US and Canada\)/gi, "")
            .replace(/ID\*?/gi, "")
            .replace(/\s+/g, " ")
            .trim();
        }

        const getDocText = () => {
          const selectors = [
            ".doc-content",
            ".ProseMirror",
            '[contenteditable="true"]',
            ".ql-editor",
            ".summary-web-detail-wrapper"
          ];
          for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el && el.innerText.trim().length > 30) {
              return el.innerText.trim();
            }
          }
          return "";
        };

        const paragraphs = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, p, li, [role="paragraph"]'))
          .map(e => e.innerText.trim())
          .filter(t => t.length > 0);

        return {
          frameUrl: url,
          isDocFrame: isDocFrame,
          title: rawTitle,
          dateTime: rawDateTime,
          targeted: getDocText(),
          structured: paragraphs.join("\n\n"),
          rawBody: document.body ? document.body.innerText.trim() : ""
        };
      }
    });

    frameResults = results.map(r => r.result).filter(Boolean);

    // Extract topic and date/time across frames
    detectedMeetingTitle = "";
    detectedMeetingDateTime = "";
    detectedSourceUrl = "";

    for (const fr of frameResults) {
      if (!detectedMeetingTitle && fr.title && fr.title.length > 2 && !fr.title.toLowerCase().includes("zoom") && !fr.title.toLowerCase().includes("my summaries")) {
        detectedMeetingTitle = fr.title;
      }
      if (!detectedMeetingDateTime && fr.dateTime && fr.dateTime.length > 3) {
        detectedMeetingDateTime = fr.dateTime;
      }
      // Capture the detail page URL (main frame with #/detail in URL)
      if (!detectedSourceUrl && fr.frameUrl && fr.frameUrl.includes("#/detail")) {
        detectedSourceUrl = fr.frameUrl;
      }
    }

    // Fallback: use any zoom.us URL from the main frame
    if (!detectedSourceUrl) {
      const mainFrame = frameResults.find(fr => fr.frameUrl && fr.frameUrl.includes("zoom.us") && !fr.isDocFrame);
      if (mainFrame) detectedSourceUrl = mainFrame.frameUrl;
    }

    if (!detectedMeetingTitle) {
      const fallbackTitle = frameResults.find(fr => fr.title && fr.title.length > 2);
      if (fallbackTitle) detectedMeetingTitle = fallbackTitle.title;
    }

    if (frameResults.length > 0) {
      frameResults[0].selected = storedSelection;
    }

    statusDiv.innerText = `Captured ${frameResults.length} frame(s). Summary isolated.`;

    if (storedSelection.length > 0) {
      document.getElementById("modeSelect").value = "selected";
    } else {
      document.getElementById("modeSelect").value = "rawBody";
    }

    renderPreview();

  } catch (err) {
    statusDiv.innerText = "Error: " + err.message;
  }
});

function renderPreview() {
  const mode = document.getElementById("modeSelect").value;
  const previewArea = document.getElementById("previewArea");

  if (mode === "selected") {
    const selectedText = frameResults[0]?.selected || "";
    previewArea.value = convertToMarkdown(selectedText, detectedMeetingTitle, detectedMeetingDateTime, detectedSourceUrl) || "No highlighted text found. Highlight text on page and scan again.";
    return;
  }

  const docFrame = frameResults.find(f => f.isDocFrame);
  if (docFrame && docFrame[mode] && docFrame[mode].length > 20) {
    previewArea.value = convertToMarkdown(docFrame[mode], detectedMeetingTitle, detectedMeetingDateTime, detectedSourceUrl);
    return;
  }

  const frameOutputs = [];
  frameResults.forEach((frame) => {
    const textToUse = frame[mode];
    if (textToUse && textToUse.length > 0) {
      frameOutputs.push(textToUse);
    }
  });

  if (frameOutputs.length === 0) {
    previewArea.value = "No text captured for this strategy.";
    return;
  }

  const targetText = frameOutputs.length > 1 ? frameOutputs[frameOutputs.length - 1] : frameOutputs[0];
  previewArea.value = convertToMarkdown(targetText, detectedMeetingTitle, detectedMeetingDateTime, detectedSourceUrl);
}

document.getElementById("modeSelect").addEventListener("change", renderPreview);

document.getElementById("downloadBtn").addEventListener("click", async () => {
  const text = document.getElementById("previewArea").value;
  const statusDiv = document.getElementById("status");

  if (!text || text.startsWith("No text captured") || text.startsWith("Click 'Scan") || text.startsWith("No highlighted text")) {
    statusDiv.innerText = "Nothing to download.";
    return;
  }

  statusDiv.innerText = "Preparing download...";
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const fallbackDateStr = parseMeetingDate(detectedMeetingDateTime) || new Date().toISOString().slice(0, 10);
  const filename = tab ? await getSanitizedFilename(tab.id) : `Zoom_Summary_${fallbackDateStr}.md`;

  chrome.runtime.sendMessage({ action: "download_summary", data: text, filename: filename }, async (res) => {
    if (res && res.status === "success") {
      statusDiv.innerText = `Saved as ${filename}!`;
      chrome.storage.local.remove("lastSelectedText");
      
      // Track downloaded file
      const match = filename.match(/^(\d{9,11})-(\d{4}-\d{2}-\d{2})\.md$/);
      if (match) {
        const key = `${match[1]}-${match[2]}`;
        const stored = await chrome.storage.local.get("downloadedSummaries");
        const downloaded = stored.downloadedSummaries || {};
        downloaded[key] = { meetingId: match[1], date: match[2], downloadedAt: new Date().toISOString() };
        await chrome.storage.local.set({ downloadedSummaries: downloaded });
      }
    } else {
      statusDiv.innerText = "Download error: " + (res?.error || "Unknown");
    }
  });
});

// Import existing downloads from files
document.getElementById("importFile").addEventListener("change", async (e) => {
  const statusDiv = document.getElementById("importStatus");
  const files = e.target.files;
  
  if (!files || files.length === 0) {
    statusDiv.innerText = "No files selected.";
    return;
  }
  
  statusDiv.innerText = `Processing ${files.length} file(s)...`;
  
  try {
    const stored = await chrome.storage.local.get("downloadedSummaries");
    const downloaded = stored.downloadedSummaries || {};
    let importCount = 0;
    let totalFound = 0;
    
    const pattern = /(\d{9,11})-(\d{4}-\d{2}-\d{2})/;
    
    for (const file of files) {
      // Check filename itself for the pattern
      const filenameMatch = file.name.match(pattern);
      if (filenameMatch) {
        totalFound++;
        const key = `${filenameMatch[1]}-${filenameMatch[2]}`;
        if (!downloaded[key]) {
          downloaded[key] = { 
            meetingId: filenameMatch[1], 
            date: filenameMatch[2], 
            downloadedAt: new Date().toISOString(),
            imported: true
          };
          importCount++;
        }
      } else {
        // Fall back to reading file contents
        const text = await file.text();
        const matches = [...text.matchAll(new RegExp(pattern, "g"))];
        totalFound += matches.length;
        
        for (const match of matches) {
          const key = `${match[1]}-${match[2]}`;
          if (!downloaded[key]) {
            downloaded[key] = { 
              meetingId: match[1], 
              date: match[2], 
              downloadedAt: new Date().toISOString(),
              imported: true
            };
            importCount++;
          }
        }
      }
    }
    
    // Reset file input for future imports
    e.target.value = "";
    
    if (totalFound === 0) {
      statusDiv.innerText = "No matching filenames found.";
      return;
    }
    
    await chrome.storage.local.set({ downloadedSummaries: downloaded });
    statusDiv.innerText = `Imported ${importCount} new (${totalFound} total).`;
    
    // Tell content script to refresh the visual indicators
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && tab.url.includes("zoom.us")) {
      chrome.tabs.sendMessage(tab.id, { action: "refreshDownloadedIndicators" });
    }
  } catch (err) {
    statusDiv.innerText = `Error: ${err.message}`;
  }
});