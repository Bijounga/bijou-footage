// Color themes. Same token names as BijouDocs (see its styles.css /
// themeTokens.js), so its built-in themes are copied here verbatim and its
// custom themes (settings.json → customThemes) can be applied as-is.
// A theme is applied by setting these CSS variables on <html>.

export const TOKENS = ['--bg', '--panel', '--panel-2', '--panel-3', '--ink', '--ink-dim', '--ink-faint', '--line', '--line-soft', '--cyan', '--amber', '--pink', '--danger', '--green']

export const BUILT_IN_THEMES = [
  {
    id: 'dark',
    name: 'Dark',
    note: 'Default',
    dark: true,
    colors: { '--bg': '#0f1014', '--panel': '#17181e', '--panel-2': '#1d1f26', '--panel-3': '#262833', '--ink': '#ece9e2', '--ink-dim': '#9a9da6', '--ink-faint': '#63656f', '--line': '#2c2f38', '--line-soft': '#23252e', '--cyan': '#4fd1c5', '--amber': '#f2a65a', '--pink': '#d46fb0', '--danger': '#e2665b', '--green': '#4ade80' }
  },
  {
    id: 'midnight',
    name: 'Midnight',
    note: 'Darker',
    dark: true,
    colors: { '--bg': '#08090c', '--panel': '#0e0f13', '--panel-2': '#13141a', '--panel-3': '#1a1c23', '--ink': '#e6e3dc', '--ink-dim': '#8d909a', '--ink-faint': '#565862', '--line': '#1f2129', '--line-soft': '#17181e', '--cyan': '#4fd1c5', '--amber': '#f2a65a', '--pink': '#d46fb0', '--danger': '#e2665b', '--green': '#4ade80' }
  },
  {
    id: 'black',
    name: 'Black',
    note: 'Darkest',
    dark: true,
    colors: { '--bg': '#000000', '--panel': '#050506', '--panel-2': '#0a0a0c', '--panel-3': '#121216', '--ink': '#e2e0da', '--ink-dim': '#85878f', '--ink-faint': '#4e5058', '--line': '#18191e', '--line-soft': '#101114', '--cyan': '#4fd1c5', '--amber': '#f2a65a', '--pink': '#d46fb0', '--danger': '#e2665b', '--green': '#4ade80' }
  },
  // ---- from BijouDocs ----
  {
    id: 'monochrome',
    name: 'Monochrome',
    note: 'BijouDocs',
    dark: true,
    colors: { '--bg': '#16171a', '--panel': '#1c1d21', '--panel-2': '#212226', '--panel-3': '#292a2f', '--ink': '#eaeaea', '--ink-dim': '#a3a3a3', '--ink-faint': '#6b6b6b', '--line': '#303136', '--line-soft': '#26272b', '--cyan': '#e8e8e8', '--amber': '#b8b8b8', '--pink': '#999999', '--danger': '#d0d0d0', '--green': '#909090' }
  },
  {
    id: 'highContrast',
    name: 'High contrast',
    note: 'BijouDocs',
    dark: true,
    colors: { '--bg': '#000000', '--panel': '#0d0d0d', '--panel-2': '#161616', '--panel-3': '#1f1f1f', '--ink': '#ffffff', '--ink-dim': '#e0e0e0', '--ink-faint': '#b0b0b0', '--line': '#999999', '--line-soft': '#4d4d4d', '--cyan': '#00e5ff', '--amber': '#ffb300', '--pink': '#ff4da6', '--danger': '#ff1a1a', '--green': '#00e676' }
  },
  {
    id: 'fantasy',
    name: 'Fantasy',
    note: 'BijouDocs',
    dark: true,
    colors: { '--bg': '#1a120b', '--panel': '#241a10', '--panel-2': '#2c2013', '--panel-3': '#362818', '--ink': '#f0e0c0', '--ink-dim': '#c3a878', '--ink-faint': '#8a7154', '--line': '#4a3823', '--line-soft': '#362a1a', '--cyan': '#d4af37', '--amber': '#e08a2e', '--pink': '#d15a78', '--danger': '#e0663f', '--green': '#6b8f4e' }
  },
  {
    id: 'light',
    name: 'Light',
    note: 'BijouDocs',
    dark: false,
    colors: { '--bg': '#e5e5e7', '--panel': '#f7f7f8', '--panel-2': '#ececee', '--panel-3': '#e0e0e3', '--ink': '#1d1d1f', '--ink-dim': '#6e6e73', '--ink-faint': '#8e8e93', '--line': '#d0d0d3', '--line-soft': '#dedee1', '--cyan': '#005bb8', '--amber': '#8f4f00', '--pink': '#d6174a', '--danger': '#c41e1e', '--green': '#1e7a35' }
  },
  {
    id: 'fable',
    name: 'Fable',
    note: 'BijouDocs',
    dark: false,
    colors: { '--bg': '#b9a26c', '--panel': '#e8d9ab', '--panel-2': '#ddc998', '--panel-3': '#d0ba85', '--ink': '#3b2a17', '--ink-dim': '#6b4f30', '--ink-faint': '#8a6d47', '--line': '#8f7248', '--line-soft': '#c0a877', '--cyan': '#9c2b2b', '--amber': '#6e4d10', '--pink': '#7a3b52', '--danger': '#7a1f1f', '--green': '#4a6329' }
  }
]

// Relative luminance, to tell whether an imported custom theme is dark.
function isDarkHex(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
  if (!m) return true
  const n = parseInt(m[1], 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128
}

// BijouDocs custom themes: [{id, name, colors}] → our shape.
export function fromBijouCustom(list) {
  return (list || [])
    .filter((t) => t && t.id && t.colors)
    .map((t) => ({ id: 'bijou:' + t.id, name: t.name || 'Custom', note: 'BijouDocs custom', dark: isDarkHex(t.colors['--bg']), colors: t.colors }))
}

export function applyTheme(theme) {
  const root = document.documentElement
  const colors = (theme && theme.colors) || BUILT_IN_THEMES[0].colors
  for (const k of TOKENS) if (colors[k]) root.style.setProperty(k, colors[k])
  root.style.colorScheme = theme && theme.dark === false ? 'light' : 'dark'
  root.dataset.themeKind = theme && theme.dark === false ? 'light' : 'dark'
}
