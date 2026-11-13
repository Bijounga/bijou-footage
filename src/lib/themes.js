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
  },
  // ---- BijouDocs' illustrated themes (looks in themes-fx.css) ----
  {
    id: 'inkWash',
    name: 'Ink Wash',
    note: 'BijouDocs',
    dark: false,
    colors: { '--bg': '#ece5d3', '--panel': '#f3eddd', '--panel-2': '#f8f3e6', '--panel-3': '#e6dec9', '--ink': '#1d1b18', '--ink-dim': '#4f4a41', '--ink-faint': '#6b6457', '--line': '#cfc5ad', '--line-soft': '#e0d8c3', '--cyan': '#b3261e', '--amber': '#8a5a12', '--pink': '#a03a5e', '--danger': '#8f1d16', '--green': '#3f6b3a', '--playhead': '#b3261e' }
  },
  {
    id: 'cyanotype',
    name: 'Cyanotype',
    note: 'BijouDocs',
    dark: true,
    colors: { '--bg': '#0f2236', '--panel': '#14304b', '--panel-2': '#1a3a59', '--panel-3': '#224667', '--ink': '#e6eef5', '--ink-dim': '#b9cbdb', '--ink-faint': '#8fa8bf', '--line': '#2f5478', '--line-soft': '#234463', '--cyan': '#a8d8f0', '--amber': '#ecc67e', '--pink': '#f2a8bc', '--danger': '#ff9486', '--green': '#9fd9ac' }
  },
  {
    id: 'cardCatalog',
    name: 'Card Catalog',
    note: 'BijouDocs',
    dark: false,
    font: "'Courier Prime', 'Courier New', monospace",
    colors: { '--bg': '#d9c7a0', '--panel': '#e9d7ab', '--panel-2': '#f1e3be', '--panel-3': '#dcc88f', '--ink': '#231f1a', '--ink-dim': '#4a4032', '--ink-faint': '#5e523c', '--line': '#bfa973', '--line-soft': '#d4c08c', '--cyan': '#34338a', '--amber': '#8a4b08', '--pink': '#a8325a', '--danger': '#b3271f', '--green': '#2f6b3a', '--playhead': '#34338a' }
  },
  {
    id: 'risoZine',
    name: 'Riso Zine',
    note: 'BijouDocs',
    dark: false,
    font: "'Bricolage Grotesque', 'Segoe UI', system-ui, sans-serif",
    colors: { '--bg': '#ebe4d6', '--panel': '#f4efe4', '--panel-2': '#fbf7ee', '--panel-3': '#e7dfcf', '--ink': '#1c1930', '--ink-dim': '#46425c', '--ink-faint': '#645f79', '--line': '#cfc6b4', '--line-soft': '#e0d8c8', '--cyan': '#0b6e86', '--amber': '#b3420b', '--pink': '#c81e58', '--danger': '#c22a2a', '--green': '#1f7a4a', '--playhead': '#f15060' }
  },
  {
    id: 'spellbound',
    name: 'Spellbound',
    note: 'BijouDocs',
    dark: true,
    colors: { '--bg': '#120e16', '--panel': '#1a1520', '--panel-2': '#221b2a', '--panel-3': '#2c2336', '--ink': '#f1e6cf', '--ink-dim': '#cbbd9f', '--ink-faint': '#a39474', '--line': '#4a3b2a', '--line-soft': '#33283a', '--cyan': '#e9c46a', '--amber': '#f0a04b', '--pink': '#e58aa0', '--danger': '#ff8a78', '--green': '#8fd3a6', '--playhead': '#e9c46a' }
  },
  {
    id: 'ronin',
    name: 'Ronin',
    note: 'BijouDocs',
    dark: true,
    font: "'Yusei Magic', 'Segoe UI', system-ui, sans-serif",
    colors: { '--bg': '#0e0e10', '--panel': '#151517', '--panel-2': '#1c1c1f', '--panel-3': '#26262a', '--ink': '#f2ede3', '--ink-dim': '#c9c3b6', '--ink-faint': '#9a948a', '--line': '#3a3a3f', '--line-soft': '#2a2a2e', '--cyan': '#ff5a52', '--amber': '#f0b35a', '--pink': '#f28ab0', '--danger': '#ff7a6e', '--green': '#8fd3a6', '--playhead': '#ff5a52' }
  },
  {
    id: 'minecraft',
    name: 'Minecraft',
    note: 'BijouDocs',
    dark: false,
    font: "'Minecraft', 'Pixelify Sans', 'Segoe UI', system-ui, sans-serif",
    colors: { '--bg': '#2a2018', '--panel': '#c6c6c6', '--panel-2': '#b3b3b3', '--panel-3': '#8b8b8b', '--ink': '#1e1e1e', '--ink-dim': '#363636', '--ink-faint': '#4a4a4a', '--line': '#373737', '--line-soft': '#8b8b8b', '--cyan': '#1d5a12', '--amber': '#7a5200', '--pink': '#8a1f55', '--danger': '#b01818', '--green': '#14561f', '--playhead': '#1d5a12' }
  },
  {
    id: 'terraria',
    name: 'Terraria',
    note: 'BijouDocs',
    dark: true,
    font: "'Andy', 'Fredoka', 'Trebuchet MS', system-ui, sans-serif",
    colors: { '--bg': '#20245e', '--panel': '#353a85', '--panel-2': '#3f4597', '--panel-3': '#4c53ad', '--ink': '#ffffff', '--ink-dim': '#dfe2ff', '--ink-faint': '#b3b9f0', '--line': '#12154a', '--line-soft': '#2a2f74', '--cyan': '#ffd84a', '--amber': '#ffb03a', '--pink': '#ff6b86', '--danger': '#ff5c5c', '--green': '#67e07a', '--playhead': '#ffd84a' }
  },
  {
    id: 'xp',
    name: 'Windows XP',
    note: 'BijouDocs',
    dark: false,
    font: "'Tahoma', 'Segoe UI', Verdana, sans-serif",
    colors: { '--bg': '#3a6ea5', '--panel': '#ece9d8', '--panel-2': '#f4f3ee', '--panel-3': '#d6d2c2', '--ink': '#000000', '--ink-dim': '#2b2b2b', '--ink-faint': '#555555', '--line': '#aca899', '--line-soft': '#d6d2c2', '--cyan': '#1c4fb8', '--amber': '#b87800', '--pink': '#b0306b', '--danger': '#c1121f', '--green': '#2e7d32', '--playhead': '#1c4fb8' }
  },
  // ---- the other half of each illustrated theme: same world, opposite light.
  // base + variant: they wear the base theme's look (and backgrounds) with
  // their own materials, [data-theme=base][data-variant=dark|light] in themes-fx.css.
  {
    id: 'inkWashDark',
    base: 'inkWash',
    variant: 'dark',
    name: 'Ink Wash Night',
    note: 'Paper by lamplight',
    dark: true,
    colors: { '--bg': '#14130f', '--panel': '#1c1a16', '--panel-2': '#24211c', '--panel-3': '#2e2a24', '--ink': '#ece5d3', '--ink-dim': '#c2b9a4', '--ink-faint': '#968d79', '--line': '#3d382f', '--line-soft': '#2b2721', '--cyan': '#e2574c', '--amber': '#d9a441', '--pink': '#d98aa6', '--danger': '#f07a6c', '--green': '#8fbf86', '--playhead': '#e2574c' }
  },
  {
    id: 'cyanotypeLight',
    base: 'cyanotype',
    variant: 'light',
    name: 'Cyanotype Paper',
    note: 'Blue ink on cream',
    dark: false,
    colors: { '--bg': '#e9e3d2', '--panel': '#f6f1e3', '--panel-2': '#efe9d8', '--panel-3': '#dfd6bd', '--ink': '#14263d', '--ink-dim': '#3d5470', '--ink-faint': '#586e88', '--line': '#c6bca2', '--line-soft': '#dcd4bd', '--cyan': '#17507f', '--amber': '#8a5a12', '--pink': '#a8325a', '--danger': '#a8281e', '--green': '#2f6b3a', '--playhead': '#17507f' }
  },
  {
    id: 'cardCatalogDark',
    base: 'cardCatalog',
    variant: 'dark',
    name: 'Card Catalog Walnut',
    note: 'Walnut and brass',
    dark: true,
    font: "'Courier Prime', 'Courier New', monospace",
    colors: { '--bg': '#1f150b', '--panel': '#2e2114', '--panel-2': '#3a2a1a', '--panel-3': '#4a3722', '--ink': '#f3e6c4', '--ink-dim': '#d1c09a', '--ink-faint': '#a8966f', '--line': '#5c4628', '--line-soft': '#3f2f1c', '--cyan': '#e8c35a', '--amber': '#f0a04b', '--pink': '#e58aa0', '--danger': '#ff8a78', '--green': '#9fd08a', '--playhead': '#e8c35a' }
  },
  {
    id: 'risoZineDark',
    base: 'risoZine',
    variant: 'dark',
    name: 'Riso Zine Black',
    note: 'Black paper, same inks',
    dark: true,
    font: "'Bricolage Grotesque', 'Segoe UI', system-ui, sans-serif",
    colors: { '--bg': '#14121f', '--panel': '#1c1930', '--panel-2': '#25213d', '--panel-3': '#302b4d', '--ink': '#f4efe4', '--ink-dim': '#cfc8dc', '--ink-faint': '#9f98b5', '--line': '#3d3760', '--line-soft': '#2b2646', '--cyan': '#3fd0d6', '--amber': '#ffb35c', '--pink': '#ff8fa0', '--danger': '#ff7a7a', '--green': '#7fe0a4', '--playhead': '#f15060' }
  },
  {
    id: 'spellboundLight',
    base: 'spellbound',
    variant: 'light',
    name: 'Spellbound Parchment',
    note: 'The library by day',
    dark: false,
    colors: { '--bg': '#e6d9b8', '--panel': '#f7efd9', '--panel-2': '#efe4c8', '--panel-3': '#dccfa9', '--ink': '#2a1d10', '--ink-dim': '#55402a', '--ink-faint': '#6e5638', '--line': '#c4b089', '--line-soft': '#dccfab', '--cyan': '#7a1626', '--amber': '#8a5210', '--pink': '#9c2f55', '--danger': '#a3241a', '--green': '#2c6a3c', '--playhead': '#7a1626' }
  },
  {
    id: 'roninLight',
    base: 'ronin',
    variant: 'light',
    name: 'Ronin Paper',
    note: 'Black ink on white',
    dark: false,
    font: "'Yusei Magic', 'Segoe UI', system-ui, sans-serif",
    colors: { '--bg': '#e9e4d8', '--panel': '#faf7f0', '--panel-2': '#f0ece2', '--panel-3': '#ddd7c8', '--ink': '#141414', '--ink-dim': '#45423c', '--ink-faint': '#666159', '--line': '#c9c3b4', '--line-soft': '#dedacd', '--cyan': '#b80f2a', '--amber': '#8a5210', '--pink': '#a8325a', '--danger': '#a3241a', '--green': '#2c6a3c', '--playhead': '#c8102e' }
  },
  {
    id: 'xpDark',
    base: 'xp',
    variant: 'dark',
    name: 'Windows XP Noir',
    note: 'Charcoal and orange',
    dark: true,
    font: "'Tahoma', 'Segoe UI', Verdana, sans-serif",
    colors: { '--bg': '#1a1a1a', '--panel': '#2b2b2b', '--panel-2': '#353535', '--panel-3': '#444444', '--ink': '#f0f0f0', '--ink-dim': '#c8c8c8', '--ink-faint': '#9a9a9a', '--line': '#555555', '--line-soft': '#3a3a3a', '--cyan': '#ff8a2a', '--amber': '#f0b35a', '--pink': '#f28ab0', '--danger': '#ff6b5a', '--green': '#7fd66a', '--playhead': '#ff8a2a' }
  },
  {
    id: 'minecraftDark',
    base: 'minecraft',
    variant: 'dark',
    name: 'Minecraft Deepslate',
    note: 'Dark stone menus',
    dark: true,
    font: "'Minecraft', 'Pixelify Sans', 'Segoe UI', system-ui, sans-serif",
    colors: { '--bg': '#101012', '--panel': '#2c2c30', '--panel-2': '#36363b', '--panel-3': '#45454b', '--ink': '#ececec', '--ink-dim': '#c4c4c8', '--ink-faint': '#9a9aa0', '--line': '#55555c', '--line-soft': '#3a3a40', '--cyan': '#6fd24a', '--amber': '#f0b340', '--pink': '#f08ac0', '--danger': '#ff5c5c', '--green': '#6fd24a', '--playhead': '#6fd24a' }
  },
  {
    id: 'terrariaLight',
    base: 'terraria',
    variant: 'light',
    name: 'Terraria Day',
    note: 'Sky-blue menus',
    dark: false,
    font: "'Andy', 'Fredoka', 'Trebuchet MS', system-ui, sans-serif",
    colors: { '--bg': '#9cc4f5', '--panel': '#dfe6ff', '--panel-2': '#eef1ff', '--panel-3': '#c8d2fa', '--ink': '#171a52', '--ink-dim': '#343a86', '--ink-faint': '#5158a0', '--line': '#6a74c8', '--line-soft': '#b8c2f2', '--cyan': '#2a35b0', '--amber': '#a85a00', '--pink': '#c2305a', '--danger': '#c62828', '--green': '#1f7a3a', '--playhead': '#2a35b0' }
  },
  {
    id: 'terrariaDark',
    base: 'terraria',
    variant: 'dark',
    name: 'Terraria Underground',
    note: 'The cavern layer',
    dark: true,
    font: "'Andy', 'Fredoka', 'Trebuchet MS', system-ui, sans-serif",
    colors: { '--bg': '#07081c', '--panel': '#11132e', '--panel-2': '#181b3d', '--panel-3': '#22264f', '--ink': '#eef0ff', '--ink-dim': '#c3c8f0', '--ink-faint': '#9298cc', '--line': '#05061a', '--line-soft': '#1a1d42', '--cyan': '#ffd84a', '--amber': '#ffb03a', '--pink': '#ff6b86', '--danger': '#ff5c5c', '--green': '#67e07a', '--playhead': '#ffd84a' }
  },
  {
    id: 'aeroBlack',
    base: 'aeroDark',
    variant: 'black',
    name: 'Frutiger Aero Black',
    note: 'Vista black glass',
    dark: true,
    font: "'Segoe UI', 'Corbel', system-ui, sans-serif",
    colors: { '--bg': '#020305', '--panel': '#07090d', '--panel-2': '#0d1117', '--panel-3': '#161c25', '--ink': '#f2f6fa', '--ink-dim': '#b4bfcc', '--ink-faint': '#808b99', '--line': '#232b36', '--line-soft': '#141a22', '--cyan': '#3fd0e8', '--amber': '#e0b84f', '--pink': '#ff7ab8', '--danger': '#ff6b6b', '--green': '#6bcf7f', '--playhead': '#3fd0e8' }
  }
]

// Themes that are one look in several lights are shown as one card with a
// variation picker: theme id → [family id, the variation's label].
const FAMILY_OF = {
  light: ['classic', 'Light'], dark: ['classic', 'Dark'], midnight: ['classic', 'Midnight'], black: ['classic', 'Black'],
  fable: ['fable', 'Parchment'], fantasy: ['fable', 'Tavern'],
  aero: ['aero', 'Light'], aeroDark: ['aero', 'Dark'],
  y2kChrome: ['y2k', 'Chrome'], y2kLcd: ['y2k', 'Chrome LCD'], y2kDark: ['y2k', 'Gunmetal'], y2kDarkLcd: ['y2k', 'Gunmetal LCD'],
  premiereLight: ['premiere', 'Light'], premiere: ['premiere', 'Dark'], premiereDarker: ['premiere', 'Darker'], premiereBlack: ['premiere', 'Black'],
  inkWash: ['inkWash', 'Light'], inkWashDark: ['inkWash', 'Night'],
  cyanotypeLight: ['cyanotype', 'Paper'], cyanotype: ['cyanotype', 'Blue'],
  cardCatalog: ['cardCatalog', 'Manila'], cardCatalogDark: ['cardCatalog', 'Walnut'],
  risoZine: ['risoZine', 'Paper'], risoZineDark: ['risoZine', 'Black'],
  spellboundLight: ['spellbound', 'Parchment'], spellbound: ['spellbound', 'Night'],
  roninLight: ['ronin', 'Paper'], ronin: ['ronin', 'Ink'],
  xp: ['xp', 'Luna'], xpDark: ['xp', 'Noir'],
  minecraft: ['minecraft', 'Stone'], minecraftDark: ['minecraft', 'Deepslate'],
  terrariaLight: ['terraria', 'Day'], terraria: ['terraria', 'Night'], terrariaDark: ['terraria', 'Underground'],
  aeroBlack: ['aero', 'Black']
}
const FAMILY_NAME = { classic: 'Bijou', fable: 'Fable', aero: 'Frutiger Aero', y2k: 'Y2K', premiere: 'Premiere', inkWash: 'Ink Wash', cyanotype: 'Cyanotype', cardCatalog: 'Card Catalog', risoZine: 'Riso Zine', spellbound: 'Spellbound', ronin: 'Ronin', xp: 'Windows XP', minecraft: 'Minecraft', terraria: 'Terraria' }

// [{id, name, note, members: [{theme, label}], light, dark}] in list order;
// a theme outside FAMILY_OF is a family of one. light / dark: the first
// member of each kind, for the card's split swatch.
export function themeFamilies(themes) {
  const out = []
  const byId = new Map()
  for (const t of themes) {
    const f = FAMILY_OF[t.id]
    const fid = f ? f[0] : 'solo:' + t.id
    let fam = byId.get(fid)
    if (!fam) {
      fam = { id: fid, name: f ? FAMILY_NAME[f[0]] : t.name, note: t.note, members: [], light: null, dark: null }
      byId.set(fid, fam)
      out.push(fam)
    }
    fam.members.push({ theme: t, label: f ? f[1] : t.name })
    if (t.dark === false) fam.light = fam.light || t
    else fam.dark = fam.dark || t
  }
  // light first, then darker and darker
  for (const fam of out) fam.members.sort((a, b) => (a.theme.dark === false ? 0 : 1) - (b.theme.dark === false ? 0 : 1))
  return out
}
export const familyOf = (themeId) => (FAMILY_OF[themeId] ? FAMILY_OF[themeId][0] : 'solo:' + themeId)

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

// bg: the chosen background for this theme (lib/themeBackgrounds.js), if it has any.
// clipStyle: 'blocks' / 'waves' overrides the theme's own way of drawing clips.
export function applyTheme(theme, bg, clipStyle) {
  const root = document.documentElement
  // An absolute URL: a relative url() inside a custom property can resolve against the wrong folder.
  const wall = ['--theme-wallpaper', '--theme-wallpaper-pos', '--theme-wallpaper-size', '--theme-wallpaper-repeat', '--theme-wallpaper-overlay', '--theme-overlay-display']
  for (const k of wall) root.style.removeProperty(k)
  if (bg) {
    root.style.setProperty('--theme-wallpaper', bg.css || 'url("' + new URL(bg.url, document.baseURI).href + '")')
    root.style.setProperty('--theme-wallpaper-pos', bg.position || (bg.tile ? '0 0' : 'center'))
    if (bg.tile) {
      root.style.setProperty('--theme-wallpaper-size', bg.tile + 'px ' + bg.tile + 'px')
      root.style.setProperty('--theme-wallpaper-repeat', 'repeat')
    }
    if (bg.overlay === false) {
      root.style.setProperty('--theme-wallpaper-overlay', 'linear-gradient(transparent, transparent)')
      root.style.setProperty('--theme-overlay-display', 'none')
    }
  }
  const colors = (theme && theme.colors) || BUILT_IN_THEMES[0].colors
  // A token this theme doesn't set goes back to the stylesheet's default —
  // otherwise the last theme's (e.g. Premiere's blue playhead) would stay.
  for (const k of TOKENS) {
    if (colors[k]) root.style.setProperty(k, colors[k])
    else root.style.removeProperty(k)
  }
  playhead = colors['--playhead'] || '#ffffff'
  blocks = clipStyle === 'blocks' ? true : clipStyle === 'waves' ? false : !!(theme && theme.clips === 'blocks')
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
