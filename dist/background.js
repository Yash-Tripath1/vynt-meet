// Service worker: storage defaults and the toolbar badge.
// Deliberately thin -- no state lives here that the popup cannot rebuild.

import { DEFAULT_SETTINGS, STORAGE_KEY, getFilterShortLabel } from './core/settings.js'

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(STORAGE_KEY, (stored) => {
    if (!stored || !stored[STORAGE_KEY]) {
      chrome.storage.sync.set({ [STORAGE_KEY]: DEFAULT_SETTINGS })
    }
  })
})

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message || message.type !== 'vynt-telemetry') return
  const tabId = sender && sender.tab ? sender.tab.id : undefined
  if (typeof tabId !== 'number') return

  const telemetry = message.telemetry || {}
  const filtering = telemetry.active && telemetry.filter && telemetry.filter !== 'off'

  try {
    chrome.action.setBadgeText({ tabId, text: filtering ? getFilterShortLabel(telemetry.filter) : '' })
    chrome.action.setBadgeBackgroundColor({ tabId, color: filtering ? '#7a4fd0' : '#5a5a5a' })
  } catch (error) {
    // Badge cosmetics are never worth surfacing.
  }
})

chrome.tabs.onRemoved.addListener((tabId) => {
  try {
    chrome.action.setBadgeText({ tabId, text: '' })
  } catch (error) {
    // The tab is gone.
  }
})
