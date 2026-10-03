/**
 * Dual-entry build for dsh-chat-assistant.
 *
 * 1. Node half (`lib/index.js`, ESM): the host plugin the Loader imports.
 * 2. Browser half (`lib/client.js`, CJS): the closure-factory artifact the
 *    shell module loader expects — `window.__ModuleLoader__.load({ id,
 *    factory })` with externals resolved through the injected `require`.
 *
 * Both entries import only types from @deepseek-ai packages (erased at
 * build), so the browser bundle needs no external module-table rows and the
 * Node half has no runtime package imports to resolve against the profile.
 */
import { defineConfig } from 'tsdown'

const id = 'dsh-chat-assistant'

export default defineConfig([
  {
    name: id,
    entry: ['src/index.ts'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'node22',
    dts: true,
    fixedExtension: false,
    sourcemap: true,
    clean: true,
  },
  {
    name: `${id}/client`,
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: ['cjs'],
    platform: 'browser',
    target: 'es2024',
    // React is a module-table baseline (implicit for every dynamic bundle);
    // it stays an external require and must not be resolved at build time.
    external: ['react'],
    // Declaration for this face is emitted by `tsc -p tsconfig.client.dts.json`
    // (see the build script); tsdown's dts here only writes a stray map.
    dts: false,
    fixedExtension: false,
    sourcemap: true,
    clean: false,
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      footer: 'return module.exports; } });',
    },
  },
])
