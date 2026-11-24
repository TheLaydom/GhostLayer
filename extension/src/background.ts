const CONTEXT_MENU_ID = 'ghostlayer-sanitize-selection';
export const PENDING_SELECTION_KEY = 'ghostlayer.pendingSelection';

chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => {
      console.error('[GhostLayer] Failed to configure side panel:', err);
    });
  }

  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: 'Inspect & Sanitize with GhostLayer',
      contexts: ['selection'],
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID) return;
  const selectedText = info.selectionText?.trim();
  if (!selectedText) return;

  // Store strictly in chrome.storage.session (RAM-only, cleared when browser closes).
  if (chrome.storage?.session) {
    await chrome.storage.session.set({
      [PENDING_SELECTION_KEY]: {
        text: selectedText,
        receivedAt: Date.now(),
      },
    });
  }

  if (tab?.windowId !== undefined && chrome.sidePanel?.open) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch((err) => {
      console.error('[GhostLayer] Failed to open side panel from context menu:', err);
    });
  }
});
