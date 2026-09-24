import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { createKeyescapeSite, TARGETS } from '../src/keyescape-site.js';

// HTML is parsed as data: scripts, subresources, forms and network are never executed.
const paths = process.argv.slice(2);
if (!paths.length) {
  console.error('사용법: npm run check:snapshots -- <예약1.html> <예약2.html> <예약3.html>');
  process.exitCode = 1;
} else {
  for (const path of paths) {
    const html = await readFile(resolve(path), 'utf8');
    const savedUrl = html.match(/<!-- saved from url=\(\d+\)(https:\/\/www\.keyescape\.com\/reservation[123]\.php[^ ]*) -->/)?.[1];
    if (!savedUrl) throw new Error('예약 원본 URL을 확인할 수 없습니다: ' + path);
    const dom = new JSDOM(html, { url: savedUrl });
    // Saved CSS is not loaded. Reproduce only the documented desktop/mobile visibility.
    const style = dom.window.document.createElement('style');
    style.textContent = '.none,.hide,.mb{display:none!important}';
    dom.window.document.head.append(style);
    const reports = Object.fromEntries(Object.entries(TARGETS).map(([key, target]) =>
      [key, createKeyescapeSite(dom.window.document, { target }).inspect()]));
    console.log(JSON.stringify({ file: resolve(path), reports }, null, 2));
    dom.window.close();
  }
}
