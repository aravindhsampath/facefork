// Composes the published gallery: shell + the real renderer bundle + the demo painting, one file.
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const at = (p) => new URL(p, root).pathname;

const mona = readFileSync(at('demo/mona-780.jpg')).toString('base64');
const bundle = readFileSync(at('demo/dist/demo.js'), 'utf8').replaceAll('</script>', '<\\/script>');

const out = readFileSync(at('demo/shell.html'), 'utf8')
  .replace('%%MONA%%', `data:image/jpeg;base64,${mona}`)
  .replace('%%BUNDLE%%', () => bundle);

writeFileSync(at('demo/dist/gallery.html'), out);
process.stderr.write(`gallery.html  ${(out.length / 1024 / 1024).toFixed(2)} MB\n`);
