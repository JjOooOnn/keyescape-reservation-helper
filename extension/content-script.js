void import(chrome.runtime.getURL('extension/runner.js')).catch(async () => {
  try { await chrome.runtime.sendMessage({ type: 'BOOTSTRAP_FAILED' }); }
  catch {}
});
