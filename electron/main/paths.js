// Where the app's tools live: ~/.bijou-footage/{whisper, llm, ffmpeg}.
// Not in %APPDATA% / Application Support — on Windows that gets redirected
// for apps launched from some sandboxed hosts, and the models are
// gigabytes we only want once. BIJOU_FOOTAGE_TOOLS points it somewhere
// else (tests install into a throwaway folder).
import os from 'os'
import path from 'path'

export const isWin = process.platform === 'win32'
export const isMac = process.platform === 'darwin'
export const TOOLS_HOME = process.env.BIJOU_FOOTAGE_TOOLS || path.join(os.homedir(), '.bijou-footage')
export const WHISPER_HOME = path.join(TOOLS_HOME, 'whisper')
export const LLM_HOME = path.join(TOOLS_HOME, 'llm')
export const FFMPEG_HOME = path.join(TOOLS_HOME, 'ffmpeg')
export const EXE = isWin ? '.exe' : ''
export const VENV_PYTHON = path.join(WHISPER_HOME, 'venv', isWin ? 'Scripts' : 'bin', isWin ? 'python.exe' : 'python3')
