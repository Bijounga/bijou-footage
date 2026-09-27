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
  },
  {
    id: 'aeroDark',
    name: 'Frutiger Aero Dark',
    note: 'BijouDocs',
    dark: true,
    font: "'Corbel', 'Segoe UI', system-ui, sans-serif",
    colors: { '--bg': '#0a1120', '--panel': '#101a2c', '--panel-2': '#16223a', '--panel-3': '#22324f', '--ink': '#eef4fb', '--ink-dim': '#a9bdd6', '--ink-faint': '#8193ad', '--line': '#2f4568', '--line-soft': '#22324f', '--cyan': '#4cc2ff', '--amber': '#e0b84f', '--pink': '#ff7ab8', '--danger': '#ff6b6b', '--green': '#6bcf7f' }
  },
  {
    id: 'aero',
    name: 'Frutiger Aero',
    note: 'BijouDocs',
    dark: false,
    font: "'Segoe UI', 'Segoe UI Light', Tahoma, Verdana, sans-serif",
    colors: { '--bg': '#cfe6f7', '--panel': '#eaf6ff', '--panel-2': '#ffffff', '--panel-3': '#d3ecfb', '--ink': '#0b2545', '--ink-dim': '#35516b', '--ink-faint': '#5c7791', '--line': '#bcdcf0', '--line-soft': '#d8edfa', '--cyan': '#0f9fdb', '--amber': '#b87606', '--pink': '#e75ba0', '--danger': '#e2432f', '--green': '#2fb866' }
  },
  {
    id: 'vaporwave',
    name: 'Vaporwave',
    note: 'BijouDocs',
    dark: false,
    font: "'Trebuchet MS', 'Segoe UI', Verdana, sans-serif",
    colors: { '--bg': '#d9c6f5', '--panel': '#e8d9ff', '--panel-2': '#f6edff', '--panel-3': '#d7c2f5', '--ink': '#2a1a4a', '--ink-dim': '#4f3d78', '--ink-faint': '#6a5794', '--line': '#b99be6', '--line-soft': '#d9c8f3', '--cyan': '#e0359b', '--amber': '#c96f00', '--pink': '#8a3ad9', '--danger': '#d6204e', '--green': '#0f9d74' }
  },
  {
    id: 'y2kChrome',
    name: 'Y2K Chrome',
    note: 'BijouDocs',
    dark: false,
    font: "'Bahnschrift', 'Segoe UI', system-ui, sans-serif",
    colors: { '--bg': '#c6cbd1', '--panel': '#eef0f2', '--panel-2': '#fafbfc', '--panel-3': '#d3d8de', '--ink': '#14171b', '--ink-dim': '#3d444c', '--ink-faint': '#5d646d', '--line': '#9ea5ae', '--line-soft': '#c3c8ce', '--cyan': '#a85206', '--amber': '#8f6a0a', '--pink': '#a8326a', '--danger': '#b8312f', '--green': '#2a7a3f' }
  },
  {
    id: 'dos',
    name: 'MS-DOS',
    note: 'BijouDocs',
    dark: false,
    font: "'Tahoma', 'MS Sans Serif', Verdana, Arial, sans-serif",
    colors: { '--bg': '#a0a0a0', '--panel': '#c0c0c0', '--panel-2': '#d4d0c8', '--panel-3': '#a0a0a0', '--ink': '#000000', '--ink-dim': '#303030', '--ink-faint': '#4d4d4d', '--line': '#808080', '--line-soft': '#a0a0a0', '--cyan': '#000080', '--amber': '#808000', '--pink': '#800080', '--danger': '#ff0000', '--green': '#008000' }
  },
  {
    id: 'aqua',
    name: 'Frutiger Aqua',
    note: 'BijouMusic',
    dark: false,
    font: "'Candara', 'Corbel', 'Segoe UI', system-ui, sans-serif",
    colors: { '--bg': '#e2f5f6', '--panel': '#eefafa', '--panel-2': '#ffffff', '--panel-3': '#cdeef0', '--ink': '#06303a', '--ink-dim': '#235a63', '--ink-faint': '#5e8f96', '--line': '#8cc9cf', '--line-soft': '#cdeef0', '--cyan': '#0a8a99', '--amber': '#946312', '--pink': '#6e44b0', '--danger': '#b8312f', '--green': '#1f7a45' }
  },
  {
    id: 'luna',
    name: 'Frutiger Luna',
    note: 'BijouMusic',
    dark: false,
    font: "'Corbel', 'Segoe UI', system-ui, sans-serif",
    colors: { '--bg': '#e4eef9', '--panel': '#f1f7fd', '--panel-2': '#ffffff', '--panel-3': '#d3e5f7', '--ink': '#0b1d33', '--ink-dim': '#2b4665', '--ink-faint': '#62799a', '--line': '#9cbbdc', '--line-soft': '#d3e5f7', '--cyan': '#1a5fc0', '--amber': '#9a6a12', '--pink': '#6e44b0', '--danger': '#b8312f', '--green': '#237a45' }
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
  // Some themes bring their own UI font (BijouDocs' MS-DOS → Tahoma…).
  if (theme && theme.font) root.style.setProperty('--sans', theme.font)
  else root.style.removeProperty('--sans')
  root.style.colorScheme = theme && theme.dark === false ? 'light' : 'dark'
  root.dataset.themeKind = theme && theme.dark === false ? 'light' : 'dark'
}
