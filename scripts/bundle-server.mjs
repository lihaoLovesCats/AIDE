import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const requireFromServer = createRequire(join(ROOT, 'server', 'package.json'))
const esbuild = requireFromServer('esbuild')

/**
 * 把 server/dist/index.js 打成单文件 ESM。
 * CJS 依赖里的动态 require 通过 createRequire 兜底（Node 内置模块可正常解析）。
 */
export async function bundleServer(outfile) {
  await esbuild.build({
    entryPoints: [join(ROOT, 'server', 'dist', 'index.js')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    logLevel: 'warning',
    legalComments: 'none',
    banner: {
      js: [
        "import { createRequire as __createRequire } from 'node:module';",
        'const require = __createRequire(import.meta.url);',
      ].join('\n'),
    },
  })
  return outfile
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const out = process.argv[2] ?? join(ROOT, '.tools', 'bundle-try', 'index.js')
  await bundleServer(out)
  console.log(`[bundle] ${out}`)
}
