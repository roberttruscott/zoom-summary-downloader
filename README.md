# Zoom Summary Downloader

A Chrome extension that downloads Zoom meeting summaries directly to your local Downloads folder with proper naming and tracking.

## Features

- **Download from Detail Page**: Use the extension popup to scan and download the current meeting summary
- **Download from List Page**: Right-click any meeting row and select "Download Summary" without losing your filters
- **Smart Filenames**: Files are named `<meetingid>-<date>.md` using the meeting date, not the download date
- **Source URL Preservation**: Each downloaded file includes a `[View on Zoom](url)` link back to the original
- **Download Tracking**: Visual checkmarks on the Zoom list page show which meetings you've already downloaded

## Installation

1. Open Chrome and navigate to `chrome://extensions`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked" and select this folder
4. Pin the extension for easy access

## Usage

### Method 1: Popup (Detail Page)

1. Navigate to a specific meeting summary on Zoom
2. Click the extension icon
3. Click "1. Scan Page & Frames"
4. Optionally select an extraction strategy
5. Click "2. Download Preview Text"

### Method 2: Context Menu (List Page)

1. Go to your Zoom meeting summaries list
2. Right-click (Control+click on Mac) on any meeting row
3. Select "Download Summary"
4. The extension will:
   - Navigate to the detail page
   - Extract the content
   - Download the file
   - Return to the list page

### Download Tracking

Downloaded meetings are marked with a green checkmark (✓) and green left border on the Zoom list page. This helps you track which summaries you've already downloaded.

### Import Existing Downloads

If you have existing downloaded summaries, you can import them to show as "downloaded" in the UI:

1. Open the extension popup
2. Click "Import Existing Downloads"
3. Navigate to your meetings folder (e.g., `~/meetings/<meetingid>/`)
4. Select the `.md` files you want to mark as downloaded (Cmd+click or Shift+click for multiple)

The extension extracts the meeting ID and date from filenames matching the pattern `<meetingid>-<date>.md`.

Alternatively, you can import from a text file listing:
```bash
ls ~/meetings/*/[0-9]*-[0-9]*.md | grep -v summary | xargs -I{} basename {} > ~/Downloads/downloaded-summaries.txt
```
Then select that `.txt` file in the import dialog.

## File Format

Downloaded files follow this format:

```markdown
# Meeting Title
*Jul 23, 2026 08:03 AM*
[View on Zoom](https://your-company.zoom.us/user/meeting/summary#/detail?meetingId=xxx&summaryId=yyy)

## Quick recap
...

## Next steps
...

## Summary
...
```

## Filename Pattern

Files are saved as: `<meetingid>-<date>.md`

- **Meeting ID**: 9-11 digit Zoom meeting ID
- **Date**: Meeting date in `YYYY-MM-DD` format

Examples:
- `91631620982-2026-06-30.md`
- `6375620618-2026-07-23.md`

## Permissions

The extension requires:
- `downloads`: To save files locally
- `activeTab`: To access the current Zoom page
- `scripting`: To extract content from the page
- `storage`: To track downloaded summaries
- `contextMenus`: For right-click download option

## Files

| File | Description |
|------|-------------|
| `manifest.json` | Extension configuration |
| `background.js` | Service worker for downloads and context menu |
| `content.js` | Content script for page interaction and visual indicators |
| `popup.html` | Extension popup UI |
| `popup.js` | Popup logic and extraction |

## Related

This extension works well with the [Meeting Summary Processor](../meetings/) script, which:
- Moves downloaded files to organized folders by meeting ID
- Runs an AI summarizer to create concise business summaries
- Can be automated via cron

## Troubleshooting

**Context menu not appearing?**
- Refresh the Zoom page after reloading the extension
- Make sure you're on a `*.zoom.us` page

**Download tracking not showing?**
- The page may need to fully load; wait a moment and scroll
- Try refreshing the Zoom list page

**Extension errors?**
- Check the service worker console: `chrome://extensions` → extension details → "Service worker"
