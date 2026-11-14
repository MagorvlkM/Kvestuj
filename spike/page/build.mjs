import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

await build({
  entryPoints: [here('./main.js')],
  outfile: here('../site/spike.js'),
  bundle: true,
  format: 'esm',
  minify: true,
  target: ['es2020', 'safari15'],
  sourcemap: false,
  legalComments: 'none',
});
console.log('built ../site/spike.js');
