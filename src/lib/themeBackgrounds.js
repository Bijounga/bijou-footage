// Backgrounds to pick from for the themes that have a wallpaper (the same
// sets as BijouDocs). css: a gradient instead of an image; tile: repeat at N px;
// overlay: false drops the theme's own tint (Aero's sky wash, Vaporwave's grid).
// The choice is kept per theme in settings.themeBg; applyTheme() hands it to
// themes-fx.css as --theme-wallpaper(-pos, -size, -repeat, -overlay).
import inkPinesLeft from '../assets/ink-pines-left.webp'
import inkPinesRight from '../assets/bg/ink-pines-right.webp'
import inkMuromachiLandscape from '../assets/bg/ink-muromachi-landscape.webp'
import inkLiteratusAutumn from '../assets/bg/ink-literatus-autumn.webp'
import cyanFerns from '../assets/cyan-ferns.webp'
import cyanSeaFan from '../assets/bg/cyan-sea-fan.webp'
import cyanDictyota from '../assets/bg/cyan-dictyota.webp'
import cyanSeaweed from '../assets/bg/cyan-seaweed.webp'
import cyanFernWreath from '../assets/bg/cyan-fern-wreath.webp'
import cardDrawerWall from '../assets/card-drawer-wall.webp'
import cardOakDrawers from '../assets/bg/card-oak-drawers.webp'
import cardRylands from '../assets/bg/card-rylands.webp'
import cardBrassPulls from '../assets/bg/card-brass-pulls.webp'
import cardMarbledBlue from '../assets/bg/card-marbled-blue.webp'
import cardMarbledPeacock from '../assets/bg/card-marbled-peacock.webp'
import risoCoralTeal from '../assets/riso-coral-teal.webp'
import risoYellowBlue from '../assets/bg/riso-yellow-blue.webp'
import risoPinkGreen from '../assets/bg/riso-pink-green.webp'
import risoOrangeViolet from '../assets/bg/riso-orange-violet.webp'
import wizLongRoom from '../assets/wiz-long-room.webp'
import wizGreatHall from '../assets/bg/wiz-great-hall.webp'
import wizCloisters from '../assets/bg/wiz-cloisters.webp'
import wizSteamTrain from '../assets/bg/wiz-steam-train.webp'
import wizForestLane from '../assets/bg/wiz-forest-lane.webp'
import wizAutumnWood from '../assets/bg/wiz-autumn-wood.webp'
import wizPinePath from '../assets/bg/wiz-pine-path.webp'
import roninGreatWave from '../assets/ronin-great-wave.webp'
import roninRedFuji from '../assets/bg/ronin-red-fuji.webp'
import roninSuddenShower from '../assets/bg/ronin-sudden-shower.webp'
import roninDragonKing from '../assets/bg/ronin-dragon-king.webp'
import roninTwoDragons from '../assets/bg/ronin-two-dragons.webp'
import roninSplashedInk from '../assets/bg/ronin-splashed-ink.webp'
import roninPines from '../assets/bg/ronin-pines.webp'
import mcMeadow from '../assets/mc-meadow.webp'
import mcCherryGrove from '../assets/bg/mc-cherry-grove.webp'
import mcJungleMeadow from '../assets/bg/mc-jungle-meadow.webp'
import mcJungleCoast from '../assets/bg/mc-jungle-coast.webp'
import mcMountainValley from '../assets/bg/mc-mountain-valley.webp'
import mcVillageValley from '../assets/bg/mc-village-valley.webp'
import mcFlowerGarden from '../assets/bg/mc-flower-garden.webp'
import mcVillageLibrary from '../assets/bg/mc-village-library.webp'
import mcTaigaPeaks from '../assets/bg/mc-taiga-peaks.webp'
import mcSwampSpires from '../assets/bg/mc-swamp-spires.webp'
import mcWaterfalls from '../assets/bg/mc-waterfalls.webp'
import mcTaigaRiver from '../assets/bg/mc-taiga-river.webp'
import mcMountainSunset from '../assets/bg/mc-mountain-sunset.webp'
import mcJungleSunset from '../assets/bg/mc-jungle-sunset.webp'
import mcLushGrotto from '../assets/bg/mc-lush-grotto.webp'
import mcLushMountain from '../assets/bg/mc-lush-mountain.webp'
import mcDripstoneCave from '../assets/bg/mc-dripstone-cave.webp'
import mcDirt from '../assets/bg/mc-dirt.webp'
import mcDirtVignette from '../assets/bg/mc-dirt-vignette.webp'
import trPineForest from '../assets/tr-pine-forest.webp'
import trMountainLake from '../assets/bg/tr-mountain-lake.webp'
import trSkyCliffs from '../assets/bg/tr-sky-cliffs.webp'
import trHallow from '../assets/bg/tr-hallow.webp'
import trJungle from '../assets/bg/tr-jungle.webp'
import trOcean from '../assets/bg/tr-ocean.webp'
import trSnow from '../assets/bg/tr-snow.webp'
import trMushroomNight from '../assets/bg/tr-mushroom-night.webp'
import trGlowingMushrooms from '../assets/bg/tr-glowing-mushrooms.webp'
import trCavern from '../assets/bg/tr-cavern.webp'
import trJungleCavern from '../assets/bg/tr-jungle-cavern.webp'
import xpBliss from '../assets/xp-bliss.webp'
import xpCraterLake from '../assets/bg/xp-crater-lake.webp'
import xpCreek from '../assets/bg/xp-creek.webp'
import xpAlpineMeadow from '../assets/bg/xp-alpine-meadow.webp'
import xpCoastalGrass from '../assets/bg/xp-coastal-grass.webp'
import xpMountainLake from '../assets/bg/xp-mountain-lake.webp'
import xpOpenRoad from '../assets/bg/xp-open-road.webp'

import dosClouds from '../assets/dos-bg.jpg'
import dosTeal from '../assets/bg/dos-teal.png'
import aeroSky from '../assets/aero-sky.jpg'
import aeroWindows7 from '../assets/bg/aero-windows-7.webp'
import aeroVista from '../assets/bg/aero-vista.webp'
import aeroWaterfall from '../assets/bg/aero-waterfall.webp'
import aeroLavender from '../assets/bg/aero-lavender.webp'
import aeroGlacier from '../assets/bg/aero-glacier.webp'
import aeroPalm from '../assets/bg/aero-palm.webp'
import aeroHills from '../assets/bg/aero-hills.webp'
import aeroNight from '../assets/aero-night.jpg'
import aerodarkVistaAurora from '../assets/bg/aerodark-vista-aurora.webp'
import aerodarkVistaRibbons from '../assets/bg/aerodark-vista-ribbons.webp'
import aerodarkAurora from '../assets/bg/aerodark-aurora.webp'
import aerodarkDusk from '../assets/bg/aerodark-dusk.webp'
import aerodarkLeaves from '../assets/bg/aerodark-leaves.webp'
import vaporClouds from '../assets/vapor-clouds.png'
import vaporSunsetGrid from '../assets/bg/vapor-sunset-grid.webp'
import vaporPalmSunset from '../assets/bg/vapor-palm-sunset.webp'
import vaporNeonCity from '../assets/bg/vapor-neon-city.webp'
import vaporPastelDream from '../assets/bg/vapor-pastel-dream.webp'
import vaporPinkPalms from '../assets/bg/vapor-pink-palms.webp'
import vaporPalmSilhouettes from '../assets/bg/vapor-palm-silhouettes.webp'
import y2kHolo from '../assets/bg/y2k-holo.webp'
import y2kDiamondPlate from '../assets/bg/y2k-diamond-plate.png'
import y2kCarbon from '../assets/bg/y2k-carbon.webp'
import gunmetalDiamondPlate from '../assets/bg/gunmetal-diamond-plate.png'
import doodleBlue from '../assets/bg/doodle-blue.png'
import doodlePurple from '../assets/bg/doodle-purple.png'
import doodlePink from '../assets/bg/doodle-pink.png'
import doodleRed from '../assets/bg/doodle-red.png'
import doodleOrange from '../assets/bg/doodle-orange.png'
import doodleGreen from '../assets/bg/doodle-green.png'
import doodleTeal from '../assets/bg/doodle-teal.png'
import doodleNight from '../assets/bg/doodle-night.png'
import doodleNotebook from '../assets/bg/doodle-notebook.png'
import doodleChalkboard from '../assets/bg/doodle-chalkboard.png'
import doodleKraft from '../assets/bg/doodle-kraft.png'
import paperLined from '../assets/bg/paper-lined.png'
import paperGraph from '../assets/bg/paper-graph.png'
import paperDots from '../assets/bg/paper-dots.png'
import paperLegal from '../assets/bg/paper-legal.png'

// Pure-CSS backgrounds (no image), as in BijouDocs.
const BRUSHED_CHROME = 'repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.12) 0 1px, rgba(0, 0, 0, 0.04) 1px 2px), linear-gradient(180deg, #c9ced4 0%, #b3b9c0 100%)'
const BRUSHED_GUNMETAL = 'repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.04) 0 1px, rgba(0, 0, 0, 0.08) 1px 2px), linear-gradient(180deg, #2a2e34 0%, #16191d 100%)'
const AMBER_LCD = 'radial-gradient(ellipse 40% 120% at 0% 50%, rgba(255, 150, 0, 0.12), rgba(255, 150, 0, 0) 70%), radial-gradient(ellipse 40% 120% at 100% 50%, rgba(255, 150, 0, 0.12), rgba(255, 150, 0, 0) 70%), radial-gradient(ellipse 100% 90% at 50% 45%, #2e1a02 0%, #170c00 70%, #0b0600 100%)'

export const THEME_BACKGROUNDS = {
  dos: [
    { id: 'clouds', label: 'Clouds', url: dosClouds },
    { id: 'bliss', label: 'Bliss (Windows XP)', url: xpBliss },
    { id: 'teal', label: 'Windows 95 teal', url: dosTeal }
  ],
  aero: [
    { id: 'sky', label: 'Aero sky', url: aeroSky },
    { id: 'windows-7', label: 'Windows 7', url: aeroWindows7, overlay: false },
    { id: 'vista', label: 'Windows Vista', url: aeroVista, overlay: false },
    { id: 'waterfall', label: 'Waterfall', url: aeroWaterfall, overlay: false },
    { id: 'lavender', label: 'Lavender', url: aeroLavender, overlay: false },
    { id: 'glacier', label: 'Glacier', url: aeroGlacier, overlay: false },
    { id: 'palm', label: 'Palm', url: aeroPalm, overlay: false },
    { id: 'hills', label: 'Sea hills', url: aeroHills, overlay: false }
  ],
  aeroDark: [
    { id: 'night', label: 'Night sky', url: aeroNight },
    { id: 'vista-aurora', label: 'Vista aurora (dark)', url: aerodarkVistaAurora },
    { id: 'vista-ribbons', label: 'Vista ribbons (dark)', url: aerodarkVistaRibbons },
    { id: 'aurora', label: 'Aurora', url: aerodarkAurora },
    { id: 'dusk', label: 'Dusk city', url: aerodarkDusk },
    { id: 'leaves', label: 'Leaves', url: aerodarkLeaves }
  ],
  vaporwave: [
    { id: 'clouds', label: 'Pixel clouds', url: vaporClouds },
    { id: 'sunset-grid', label: 'Sunset grid', url: vaporSunsetGrid, overlay: false },
    { id: 'palm-sunset', label: 'Palm sunset', url: vaporPalmSunset, overlay: false },
    { id: 'neon-city', label: 'Neon city', url: vaporNeonCity, overlay: false },
    { id: 'pastel-dream', label: 'Pastel dream', url: vaporPastelDream, overlay: false },
    { id: 'pink-palms', label: 'Pink palms', url: vaporPinkPalms, overlay: false },
    { id: 'palm-silhouettes', label: 'Palm silhouettes', url: vaporPalmSilhouettes, overlay: false }
  ],
  y2kChrome: [
    { id: 'lcd', label: 'Amber LCD', css: AMBER_LCD },
    { id: 'brushed', label: 'Brushed aluminium', css: BRUSHED_CHROME },
    { id: 'holo', label: 'Holographic', url: y2kHolo },
    { id: 'diamond-plate', label: 'Diamond plate', url: y2kDiamondPlate, tile: 120 },
    { id: 'carbon', label: 'Carbon fibre', url: y2kCarbon }
  ],
  y2kDark: [
    { id: 'lcd', label: 'Amber LCD', css: AMBER_LCD },
    { id: 'gunmetal', label: 'Gunmetal', css: BRUSHED_GUNMETAL },
    { id: 'carbon', label: 'Carbon fibre', url: y2kCarbon },
    { id: 'diamond-plate', label: 'Dark diamond plate', url: gunmetalDiamondPlate, tile: 120 }
  ],
  doodleClub: [
    { id: 'blue', label: 'Blue', url: doodleBlue, tile: 400 },
    { id: 'purple', label: 'Purple', url: doodlePurple, tile: 400 },
    { id: 'pink', label: 'Pink', url: doodlePink, tile: 400 },
    { id: 'red', label: 'Red', url: doodleRed, tile: 400 },
    { id: 'orange', label: 'Orange', url: doodleOrange, tile: 400 },
    { id: 'green', label: 'Green', url: doodleGreen, tile: 400 },
    { id: 'teal', label: 'Teal', url: doodleTeal, tile: 400 },
    { id: 'night', label: 'Night', url: doodleNight, tile: 400 },
    { id: 'notebook', label: 'Notebook doodles', url: doodleNotebook, tile: 400 },
    { id: 'chalkboard', label: 'Chalkboard', url: doodleChalkboard, tile: 400 },
    { id: 'kraft', label: 'Kraft paper', url: doodleKraft, tile: 400 },
    { id: 'lined', label: 'Lined paper', url: paperLined, tile: 384 },
    { id: 'graph', label: 'Graph paper', url: paperGraph, tile: 400 },
    { id: 'dots', label: 'Dot grid', url: paperDots, tile: 400 },
    { id: 'legal', label: 'Legal pad', url: paperLegal, tile: 384 }
  ],
  inkWash: [
    { id: 'pines-left', label: 'Pine trees (left screen)', url: inkPinesLeft },
    { id: 'pines-right', label: 'Pine trees (right screen)', url: inkPinesRight },
    { id: 'muromachi', label: 'Mountain landscape', url: inkMuromachiLandscape },
    { id: 'literatus', label: 'Scholar in autumn', url: inkLiteratusAutumn }
  ],
  cyanotype: [
    { id: 'ferns', label: 'Ferns', url: cyanFerns },
    { id: 'sea-fan', label: 'Seaweed (dark)', url: cyanSeaFan },
    { id: 'dictyota', label: 'Dictyota', url: cyanDictyota },
    { id: 'seaweed', label: 'Seaweed (pale)', url: cyanSeaweed },
    { id: 'fern-wreath', label: 'Foreign ferns', url: cyanFernWreath }
  ],
  cardCatalog: [
    { id: 'drawer-wall', label: 'Wall of drawers', url: cardDrawerWall },
    { id: 'oak-drawers', label: 'Oak drawers', url: cardOakDrawers },
    { id: 'rylands', label: 'John Rylands Library', url: cardRylands },
    { id: 'brass-pulls', label: 'Brass pulls', url: cardBrassPulls },
    { id: 'marbled-blue', label: 'Marbled endpaper (1830)', url: cardMarbledBlue },
    { id: 'marbled-peacock', label: 'Peacock endpaper (1875)', url: cardMarbledPeacock }
  ],
  risoZine: [
    { id: 'coral-teal', label: 'Coral and teal', url: risoCoralTeal },
    { id: 'yellow-blue', label: 'Yellow and blue', url: risoYellowBlue },
    { id: 'pink-green', label: 'Pink and green', url: risoPinkGreen },
    { id: 'orange-violet', label: 'Orange and violet', url: risoOrangeViolet }
  ],
  spellbound: [
    { id: 'long-room', label: 'The old library', url: wizLongRoom },
    { id: 'great-hall', label: 'The great hall', url: wizGreatHall },
    { id: 'cloisters', label: 'Cloisters', url: wizCloisters },
    { id: 'steam-train', label: 'Steam train', url: wizSteamTrain },
    { id: 'forest-lane', label: 'Forest lane at dawn', url: wizForestLane },
    { id: 'autumn-wood', label: 'Autumn wood', url: wizAutumnWood },
    { id: 'pine-path', label: 'Pine path (cold)', url: wizPinePath }
  ],
  ronin: [
    { id: 'great-wave', label: 'The Great Wave', url: roninGreatWave },
    { id: 'red-fuji', label: 'Red Fuji', url: roninRedFuji },
    { id: 'sudden-shower', label: 'Sudden shower', url: roninSuddenShower },
    { id: 'dragon-king', label: 'Dragon king', url: roninDragonKing },
    { id: 'two-dragons', label: 'Ink dragons (black and white)', url: roninTwoDragons },
    { id: 'splashed-ink', label: 'Splashed ink (black and white)', url: roninSplashedInk },
    { id: 'pines', label: 'Pines in mist (black and white)', url: roninPines }
  ],
  minecraft: [
    { id: 'meadow', label: 'Meadow', url: mcMeadow },
    { id: 'cherry-grove', label: 'Cherry grove', url: mcCherryGrove },
    { id: 'jungle-meadow', label: 'Jungle meadow', url: mcJungleMeadow },
    { id: 'jungle-coast', label: 'Jungle coast', url: mcJungleCoast },
    { id: 'mountain-valley', label: 'Mountain valley', url: mcMountainValley },
    { id: 'village-valley', label: 'Village valley', url: mcVillageValley },
    { id: 'flower-garden', label: 'Flower garden', url: mcFlowerGarden },
    { id: 'village-library', label: 'Village library', url: mcVillageLibrary },
    { id: 'taiga-peaks', label: 'Taiga peaks', url: mcTaigaPeaks },
    { id: 'swamp-spires', label: 'Swamp spires', url: mcSwampSpires },
    { id: 'waterfalls', label: 'Waterfalls', url: mcWaterfalls },
    { id: 'taiga-river', label: 'Taiga river', url: mcTaigaRiver },
    { id: 'mountain-sunset', label: 'Mountain sunset', url: mcMountainSunset },
    { id: 'jungle-sunset', label: 'Jungle sunset', url: mcJungleSunset },
    { id: 'lush-grotto', label: 'Lush grotto', url: mcLushGrotto },
    { id: 'lush-mountain', label: 'Lush cave mountain', url: mcLushMountain },
    { id: 'dripstone-cave', label: 'Dripstone cave', url: mcDripstoneCave },
    { id: 'dirt', label: 'Dirt', url: mcDirt },
    { id: 'dirt-vignette', label: 'Dirt (dark edges)', url: mcDirtVignette }
  ],
  terraria: [
    { id: 'pine-forest', label: 'Pine forest', url: trPineForest, position: 'center bottom' },
    { id: 'mountain-lake', label: 'Mountain lake', url: trMountainLake },
    { id: 'sky-cliffs', label: 'Sky cliffs', url: trSkyCliffs },
    { id: 'hallow', label: 'The Hallow', url: trHallow },
    { id: 'jungle', label: 'Jungle', url: trJungle },
    { id: 'ocean', label: 'Ocean', url: trOcean },
    { id: 'snow', label: 'Snow', url: trSnow },
    { id: 'mushroom-night', label: 'Mushroom night', url: trMushroomNight },
    { id: 'glowing-mushrooms', label: 'Glowing mushrooms', url: trGlowingMushrooms },
    { id: 'cavern', label: 'Cavern', url: trCavern },
    { id: 'jungle-cavern', label: 'Jungle cavern', url: trJungleCavern }
  ],
  xp: [
    { id: 'bliss', label: 'Bliss', url: xpBliss },
    { id: 'crater-lake', label: 'Crater lake', url: xpCraterLake },
    { id: 'creek', label: 'Forest stream', url: xpCreek },
    { id: 'alpine-meadow', label: 'Alpine meadow', url: xpAlpineMeadow },
    { id: 'coastal-grass', label: 'Lighthouse coast', url: xpCoastalGrass },
    { id: 'mountain-lake', label: 'Mountain lake', url: xpMountainLake },
    { id: 'open-road', label: 'Mountain road', url: xpOpenRoad }
  ]
}

// The background to show for a theme: the saved choice, else the first.
export function activeBackground(themeId, chosen) {
  const list = THEME_BACKGROUNDS[themeId]
  if (!list) return null
  return list.find((v) => v.id === (chosen && chosen[themeId])) || list[0]
}
