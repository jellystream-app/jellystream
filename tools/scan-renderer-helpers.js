/**
 * Sucht Helfer, die in einem executeJavaScript-Block benutzt, aber nur
 * im Testskript definiert sind.
 *
 * Der Anlass: test-fixes.js rief `settle` innerhalb eines solchen
 * Blocks auf. Definiert war es in Node, ausgefuehrt wurde der Block im
 * Renderer — dort gibt es das nicht. Der Block brach ab, das `await`
 * loeste nie auf, der Test hing vier Minuten und meldete nichts.
 * Genau diese Bauart faellt sonst niemandem auf, weil sie nicht
 * fehlschlaegt, sondern schweigt.
 *
 * Aufruf:  node tools/scan-renderer-helpers.js
 */
const fs = require('fs');
const path = require('path');

const TOOLS = __dirname;
const HELPERS = ['settle', 'SLOW', 'sleep', 'wait'];
const findings = [];

for (const file of fs.readdirSync(TOOLS).filter((f) => f.endsWith('.js'))) {
  const src = fs.readFileSync(path.join(TOOLS, file), 'utf8');
  const blocks = /executeJavaScript\(\s*`([\s\S]*?)`\s*[,)]/g;

  let match;
  let index = 0;

  while ((match = blocks.exec(src))) {
    const body = match[1];
    const line = src.slice(0, match.index).split('\n').length;

    for (const helper of HELPERS) {
      const used = new RegExp(`\\b${helper}\\s*\\(`).test(body);
      const declared =
        new RegExp(`(const|let|var|function)\\s+${helper}\\b`).test(body);

      if (used && !declared) {
        findings.push(`${file}:${line} — Block nutzt ${helper}(), ` +
                      'definiert ist es nur im Testskript');
      }
    }
    index += 1;
  }
}

findings.forEach((f) => console.log('FAIL  ' + f));

if (findings.length === 0) {
  console.log('OK    Kein Renderer-Block greift auf Node-Helfer zu');
}

process.exit(findings.length ? 1 : 0);
