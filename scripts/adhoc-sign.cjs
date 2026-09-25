// electron-builder afterSign hook. There's no Apple Developer certificate, so
// electron-builder's own signing is off (package.json: mac.identity null) —
// but a Mac app whose signature doesn't match its files is refused as
// "damaged" on Apple Silicon. Ad-hoc signing ("-") gives it a valid
// signature; macOS then just asks once whether to open an app from an
// unidentified developer.
const { execFileSync } = require('child_process')
const path = require('path')

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return
  const app = path.join(context.appOutDir, context.packager.appInfo.productFilename + '.app')
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
  console.log('  • ad-hoc signed ' + path.basename(app))
}
