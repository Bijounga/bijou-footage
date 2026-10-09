// Makes the voiceover lane play along with the cut. The cut's own player
// (seqPlayer: two video decks) stays the master; voMix — which plays the
// lane's clips — follows its play / pause / seek / speed, and every second
// checks they haven't drifted apart (the two run on different clocks), and
// snaps the voiceover back to the picture if they have.
import { seqPlayer } from './seqPlayer.js'
import { voMix } from './voPlayer.js'

let started = false

function follow() {
  const sp = seqPlayer
  const want = sp.playing && !sp.skim
  if (!want) {
    if (voMix.playing) voMix.pause()
    voMix.pos = sp.getTime()
    return
  }
  voMix.stopSources()
  voMix.shuttle = null
  voMix.base = sp.rate || 1
  voMix.startAt(sp.getTime())
}

export function startVoSlave() {
  if (started) return
  started = true
  voMix.clockSource = () => (seqPlayer.playing && !seqPlayer.skim ? seqPlayer.getTime() : null)
  let lastRate = 1
  let lastPlaying = false
  const onState = () => {
    const playing = seqPlayer.playing && !seqPlayer.skim
    const rate = seqPlayer.rate || 1
    if (playing !== lastPlaying || (playing && rate !== lastRate)) follow()
    lastPlaying = playing
    lastRate = rate
  }
  seqPlayer.on('state', onState)
  // A seek reports "done" a moment before the picture is playing again, so
  // look again just after (and once more a little later, to be sure).
  seqPlayer.on('seek', () => {
    if (voMix.playing) voMix.stopSources()
    voMix.pos = seqPlayer.getTime()
    follow()
    setTimeout(follow, 120)
  })
  seqPlayer.on('ended', () => voMix.playing && voMix.pause())
  // The clocks run apart slowly (the audio device vs the video); put the
  // voiceover back with the picture when it's more than a tenth of a second off.
  setInterval(() => {
    if (!seqPlayer.playing || seqPlayer.skim || !voMix.playing) return
    if (voMix.total <= 0) return
    if (Math.abs(voMix.getTime() - seqPlayer.getTime()) > 0.1) follow()
  }, 1000)
}
