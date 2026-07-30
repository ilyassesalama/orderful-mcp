// Bundles each MCP App view (src/ui/*-view.ts) and inlines it into its HTML
// shell (src/ui/*.html), producing self-contained files in dist/ui/.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const VIEWS = ['transactions', 'connect'];

mkdirSync('dist/ui', { recursive: true });
const theme = readFileSync('src/ui/theme.css', 'utf8');

for (const view of VIEWS) {
  const result = await build({
    entryPoints: [`src/ui/${view}-view.ts`],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    minify: true,
    write: false,
  });
  // Escape any '</script' inside the bundle so it can live in an inline tag.
  const js = result.outputFiles[0].text.replaceAll('</script', '<\\/script');
  const html = readFileSync(`src/ui/${view}.html`, 'utf8')
    .replace('/*__THEME__*/', () => theme)
    .replace('/*__BUNDLE__*/', () => js);
  writeFileSync(`dist/ui/${view}.html`, html);
  console.log(`built dist/ui/${view}.html (${(html.length / 1024).toFixed(0)} kB)`);
}
