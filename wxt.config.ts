import { defineConfig } from 'wxt'
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { join } from 'node:path'

// Chrome's content-script loader rejects files containing Unicode
// "noncharacters" (U+FFFE, U+FFFF, U+FDD0…U+FDEF, U+xFFFE/U+xFFFF for x=1..16)
// with a misleading "isn't UTF-8 encoded" error. markdown-it / linkify bake
// some of these into their compiled regex character classes. We walk the
// build output and escape them — safe inside JS string and regex literals.
const NONCHAR = /[﷐-﷯￾￿]/g
function escapeNonchars(s: string): string {
  return s.replace(NONCHAR, (c) => {
    const cp = c.codePointAt(0)!
    return '\\u' + cp.toString(16).padStart(4, '0').toUpperCase()
  })
}
function walkJs(dir: string, cb: (file: string) => void) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) walkJs(full, cb)
    else if (entry.endsWith('.js') || entry.endsWith('.mjs')) cb(full)
  }
}

// Chrome expects raster extension icons. This small PNG encoder keeps the
// source icon as the single editable asset without adding a graphics package.
function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii')
  const body = Buffer.concat([typeBytes, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  return Buffer.concat([length, body, crc])
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function makeIconPng(size: number): Buffer {
  const pixels = Buffer.alloc(size * size * 4)
  const radius = size * 0.19
  const barHeight = Math.max(1, Math.round(size * 0.11))
  const left = Math.round(size * 0.23)
  const right = Math.round(size * 0.77)
  const bars = [0.23, 0.445, 0.66]
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.max(radius - x, 0, x - (size - 1 - radius))
      const dy = Math.max(radius - y, 0, y - (size - 1 - radius))
      const inside = dx * dx + dy * dy <= radius * radius
      const offset = (y * size + x) * 4
      pixels[offset] = 9
      pixels[offset + 1] = 105
      pixels[offset + 2] = 218
      pixels[offset + 3] = inside ? 255 : 0
      if (inside && bars.some((position) => {
        const top = Math.round(size * position)
        return x >= left && x < right && y >= top && y < top + barHeight
      })) {
        pixels[offset] = 255
        pixels[offset + 1] = 255
        pixels[offset + 2] = 255
      }
    }
  }
  const scanlines = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    scanlines[y * (size * 4 + 1)] = 0
    pixels.copy(scanlines, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

export default defineConfig({
  srcDir: 'src',
  outDir: 'dist',
  modules: ['@wxt-dev/module-svelte'],
  manifest: {
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    version: '1.0.4',
    default_locale: 'en',
    icons: {
      '16': 'icon-16.png',
      '32': 'icon-32.png',
      '48': 'icon-48.png',
      '128': 'icon-128.png',
    },
    permissions: ['storage', 'activeTab'],
    host_permissions: ['*://*/*'],
    action: {
      default_title: '__MSG_extName__',
      default_icon: {
        '16': 'icon-16.png',
        '32': 'icon-32.png',
      },
    },
    commands: {
      'toggle-panel': {
        suggested_key: { default: 'Alt+Shift+B' },
        description: 'Toggle the side panel',
      },
      'toggle-centered': {
        suggested_key: { default: 'Alt+Shift+C' },
        description: 'Toggle centered layout',
      },
      'toggle-refresh': {
        suggested_key: { default: 'Alt+Shift+R' },
        description: 'Toggle hot reload',
      },
      'toggle-theme': {
        suggested_key: { default: 'Alt+Shift+T' },
        description: 'Toggle light / dark theme',
      },
      'toggle-raw': {
        description: 'Toggle raw / preview',
      },
    },
  },
  vite: () => ({
    build: {
      // mermaid is large; raise the chunk-size warning threshold
      chunkSizeWarningLimit: 5000,
    },
  }),
  hooks: {
    'build:done': (wxt) => {
      const outDir = wxt.config.outDir
      for (const size of [16, 32, 48, 128]) {
        writeFileSync(join(outDir, `icon-${size}.png`), makeIconPng(size))
      }
      let touched = 0
      let fixed = 0
      walkJs(outDir, (file) => {
        const src = readFileSync(file, 'utf8')
        if (!NONCHAR.test(src)) return
        NONCHAR.lastIndex = 0
        const next = escapeNonchars(src)
        const before = (src.match(NONCHAR) ?? []).length
        writeFileSync(file, next, 'utf8')
        touched++
        fixed += before
      })
      if (touched > 0) {
        wxt.logger.info(
          `Escaped ${fixed} Unicode noncharacter(s) in ${touched} file(s) for Chrome content-script compatibility.`,
        )
      }
    },
  },
})
