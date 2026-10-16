// Color themes. Same token names as BijouDocs (see its styles.css /
// themeTokens.js), so its built-in themes are copied here verbatim and its
// custom themes (settings.json → customThemes) can be applied as-is.
// A theme is applied by setting these CSS variables on <html>.

export const TOKENS = ['--bg', '--panel', '--panel-2', '--panel-3', '--ink', '--ink-dim', '--ink-faint', '--line', '--line-soft', '--cyan', '--amber', '--pink', '--danger', '--green', '--playhead']

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
    id: 'y2kLcd',
    base: 'y2kChrome',
    variant: 'lcd',
    name: 'Y2K Chrome LCD',
    note: 'Amber LCD timeline',
    dark: false,
    font: "'Bahnschrift', 'Segoe UI', system-ui, sans-serif",
    colors: { '--bg': '#c6cbd1', '--panel': '#eef0f2', '--panel-2': '#fafbfc', '--panel-3': '#d3d8de', '--ink': '#14171b', '--ink-dim': '#3d444c', '--ink-faint': '#5d646d', '--line': '#9ea5ae', '--line-soft': '#c3c8ce', '--cyan': '#a85206', '--amber': '#8f6a0a', '--pink': '#a8326a', '--danger': '#b8312f', '--green': '#2a7a3f' }
  },
  {
    id: 'y2kDark',
    name: 'Y2K Gunmetal',
    note: 'Y2K Chrome, dark',
    dark: true,
    font: "'Bahnschrift', 'Segoe UI', system-ui, sans-serif",
    colors: { '--bg': '#1c1f23', '--panel': '#26292e', '--panel-2': '#2f3338', '--panel-3': '#3a3e45', '--ink': '#e6e8eb', '--ink-dim': '#a9afb7', '--ink-faint': '#8a9099', '--line': '#3f444b', '--line-soft': '#30343a', '--cyan': '#ffa526', '--amber': '#e0b24a', '--pink': '#e46aa3', '--danger': '#ff6b5a', '--green': '#4fcf7a' }
  },
  {
    id: 'y2kDarkLcd',
    base: 'y2kDark',
    variant: 'lcd',
    name: 'Y2K Gunmetal LCD',
    note: 'Amber LCD timeline',
    dark: true,
    font: "'Bahnschrift', 'Segoe UI', system-ui, sans-serif",
    colors: { '--bg': '#1c1f23', '--panel': '#26292e', '--panel-2': '#2f3338', '--panel-3': '#3a3e45', '--ink': '#e6e8eb', '--ink-dim': '#a9afb7', '--ink-faint': '#8a9099', '--line': '#3f444b', '--line-soft': '#30343a', '--cyan': '#ffa526', '--amber': '#e0b24a', '--pink': '#e46aa3', '--danger': '#ff6b5a', '--green': '#4fcf7a' }
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
  },
  // ---- Bijou's own: a modern editing suite (id kept from its first version) ----
  {
    id: 'cuttingRoom',
    name: 'Studio',
    note: 'Editing suite',
    dark: true,
    font: "'Inter', 'Segoe UI Variable Display', 'Segoe UI', sans-serif",
    colors: { '--bg': '#0a0c16', '--panel': '#121527', '--panel-2': '#181c33', '--panel-3': '#20253f', '--ink': '#e9ebf5', '--ink-dim': '#9aa0bd', '--ink-faint': '#7d83a3', '--line': '#262b45', '--line-soft': '#1b1f35', '--cyan': '#8b7bff', '--amber': '#ffad5c', '--pink': '#e66bd0', '--danger': '#ff5d6c', '--green': '#3ddc97' }
  },
  // ---- Premiere: a professional editing suite, after Adobe Premiere Pro ----
  {
    id: 'premiere',
    name: 'Premiere',
    note: 'Editing suite',
    dark: true,
    font: "'Adobe Clean', 'Segoe UI', system-ui, sans-serif",
    clips: 'blocks', // timelines draw solid clips with dark waveforms, like Premiere
    colors: { '--bg': '#0c0c0c', '--panel': '#1e1e1e', '--panel-2': '#232323', '--panel-3': '#2e2e2e', '--ink': '#d7d7d7', '--ink-dim': '#a2a2a2', '--ink-faint': '#717171', '--line': '#2f2f2f', '--line-soft': '#262626', '--cyan': '#2d8ceb', '--amber': '#e6a23c', '--pink': '#c972d9', '--danger': '#e34850', '--green': '#2d9d78', '--playhead': '#2d8ceb' }
  },
  {
    id: 'premiereDarker',
    name: 'Premiere Darker',
    note: 'Editing suite',
    base: 'premiere',
    variant: 'darker',
    dark: true,
    font: "'Adobe Clean', 'Segoe UI', system-ui, sans-serif",
    clips: 'blocks',
    colors: { '--bg': '#060606', '--panel': '#161616', '--panel-2': '#1a1a1a', '--panel-3': '#252525', '--ink': '#d4d4d4', '--ink-dim': '#9c9c9c', '--ink-faint': '#6a6a6a', '--line': '#272727', '--line-soft': '#1e1e1e', '--cyan': '#2d8ceb', '--amber': '#e6a23c', '--pink': '#c972d9', '--danger': '#e34850', '--green': '#2d9d78', '--playhead': '#2d8ceb' }
  },
  {
    id: 'premiereBlack',
    name: 'Premiere Black',
    note: 'Editing suite',
    base: 'premiere',
    variant: 'black',
    dark: true,
    font: "'Adobe Clean', 'Segoe UI', system-ui, sans-serif",
    clips: 'blocks',
    colors: { '--bg': '#000000', '--panel': '#0c0c0c', '--panel-2': '#111111', '--panel-3': '#1b1b1b', '--ink': '#d0d0d0', '--ink-dim': '#969696', '--ink-faint': '#646464', '--line': '#1f1f1f', '--line-soft': '#161616', '--cyan': '#2d8ceb', '--amber': '#e6a23c', '--pink': '#c972d9', '--danger': '#e34850', '--green': '#2d9d78', '--playhead': '#2d8ceb' }
  },
  {
    id: 'premiereLight',
    name: 'Premiere Light',
    note: 'Editing suite',
    base: 'premiere',
    variant: 'light',
    dark: false,
    font: "'Adobe Clean', 'Segoe UI', system-ui, sans-serif",
    clips: 'blocks',
    colors: { '--bg': '#a6a6a6', '--panel': '#d6d6d6', '--panel-2': '#cdcdcd', '--panel-3': '#c0c0c0', '--ink': '#1b1b1b', '--ink-dim': '#474747', '--ink-faint': '#6b6b6b', '--line': '#b3b3b3', '--line-soft': '#c6c6c6', '--cyan': '#1473e6', '--amber': '#a3620a', '--pink': '#9b3fb0', '--danger': '#c9252d', '--green': '#12805c', '--playhead': '#1473e6' }
  },
  // ---- Bijou Doodle's own theme ----
  {
    id: 'doodleClub',
    name: 'Doodle Club',
    note: 'Bijou Doodle',
    dark: false,
    font: "'Trebuchet MS', 'Segoe UI', sans-serif",
    colors: { '--bg': '#fffbe9', '--panel': '#fffbe9', '--panel-2': '#ffffff', '--panel-3': '#f5ecc4', '--ink': '#202031', '--ink-dim': '#4a4960', '--ink-faint': '#6a6879', '--line': '#d6cca6', '--line-soft': '#ece3c2', '--cyan': '#1f5fbf', '--amber': '#aa5100', '--pink': '#b92a65', '--danger': '#c8302b', '--green': '#23782a' }
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

// The playhead's colour, for the timelines drawn on canvas (white, or the
// theme's own: Premiere's is blue).
let playhead = '#ffffff'
export const playheadColor = () => playhead

// "Clip blocks" (Premiere): the timelines draw each clip as a solid, light
// block in its track's colour with a dark waveform inside, instead of a
// bright waveform on the dark lane.
let blocks = false
export const clipBlocks = () => blocks
export const BLOCK_WAVE = 'rgba(12, 20, 36, 0.66)'
// A muted / an empty track's clip: grey, darker or lighter than the panel.
let lightUi = false
export const blockMuted = () => (lightUi ? '#a9a9a9' : '#4a4a4a')
export const blockEmpty = () => (lightUi ? '#c2c2c2' : '#2c2c2c')
// The block's fill: the track colour lifted toward white, like Premiere's
// pastel clip labels.
export function blockFill(hex, lift = 0.25) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim())
  if (!m) return '#8aa4dc'
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  // a third of the way to grey first: Premiere's labels are muted, not neon
  const y = 0.3 * r + 0.59 * g + 0.11 * b
  const ch = (v) => Math.round((v + (y - v) * 0.35) * (1 - lift) + 255 * lift)
  return `rgb(${ch(r)}, ${ch(g)}, ${ch(b)})`
}

export function applyTheme(theme) {
  const root = document.documentElement
  const colors = (theme && theme.colors) || BUILT_IN_THEMES[0].colors
  // A token this theme doesn't set goes back to the stylesheet's default —
  // otherwise the last theme's (e.g. Premiere's blue playhead) would stay.
  for (const k of TOKENS) {
    if (colors[k]) root.style.setProperty(k, colors[k])
    else root.style.removeProperty(k)
  }
  playhead = colors['--playhead'] || '#ffffff'
  blocks = !!(theme && theme.clips === 'blocks')
  lightUi = !!(theme && theme.dark === false)
  root.dataset.clips = blocks ? 'blocks' : ''
  // Some themes bring their own UI font (BijouDocs' MS-DOS → Tahoma…).
  if (theme && theme.font) root.style.setProperty('--sans', theme.font)
  else root.style.removeProperty('--sans')
  root.style.colorScheme = theme && theme.dark === false ? 'light' : 'dark'
  root.dataset.themeKind = theme && theme.dark === false ? 'light' : 'dark'
  // A variant (e.g. Y2K Chrome LCD) wears its base theme's look plus its own tweaks.
  root.dataset.theme = (theme && (theme.base || theme.id)) || 'dark' // lets themes-fx.css style per theme
  root.dataset.variant = (theme && theme.variant) || ''
}
