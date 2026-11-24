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

async function openSidePanelWithText(text: string, windowId?: number): Promise<void> {
  if (chrome.storage?.session) {
    await chrome.storage.session.set({
      [PENDING_SELECTION_KEY]: {
        text,
        receivedAt: Date.now(),
      },
    });
  }

  if (windowId !== undefined && chrome.sidePanel?.open) {
    await chrome.sidePanel.open({ windowId });
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID) return;
  const selectedText = info.selectionText?.trim();
  if (!selectedText) return;

  try {
    await openSidePanelWithText(selectedText, tab?.windowId);
  } catch (err) {
    console.error('[GhostLayer] Failed to open side panel from context menu:', err);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'GHOSTLAYER_OPEN_SIDEPANEL' && typeof message.text === 'string') {
    openSidePanelWithText(message.text, sender.tab?.windowId)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        console.error('[GhostLayer] Failed to open side panel from content script:', err);
        sendResponse({ ok: false });
      });
    return true;
  }
  return false;
});
