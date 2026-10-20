import { build } from 'esbuild';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'build/gas');
const [html, css, result] = await Promise.all([
  readFile(path.join(root, 'index.html'), 'utf8'),
  readFile(path.join(root, 'src/client/styles.css'), 'utf8'),
  build({
    absWorkingDir: root,
    entryPoints: ['src/client/game.mjs'],
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2020',
    charset: 'utf8',
    legalComments: 'none',
  }),
]);
const styleTag = '<link rel="stylesheet" href="./src/client/styles.css">';
const scriptTag = '<script type="module" src="./src/client/game.mjs"></script>';
for (const marker of [styleTag, scriptTag]) {
  if (html.split(marker).length !== 2) throw new Error(`Expected exactly one build marker: ${marker}`);
}
// Keep generated content inside its tag even if a future source includes a closing tag string.
const script = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const embeddedCss = css.replace(/<\/style/gi, '<\\/style');
const bundledHtml = html.replace(styleTag, () => `<style>${embeddedCss}</style>`)
  .replace(scriptTag, () => `<script>${script}</script>`);
await mkdir(output, { recursive: true });
await writeFile(path.join(output, 'Index.html'), bundledHtml);
await Promise.all(['Code.gs', 'appsscript.json'].map(name => copyFile(path.join(root, 'src/gas', name), path.join(output, name))));
console.log('Built build/gas/{Index.html,Code.gs,appsscript.json} (no deployment performed)');
