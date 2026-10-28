// Loaded by Premiere when the panel opens. Kept tiny on purpose: the real code is
// in lib.jsx, which the panel loads again for every job (so errors in it show up
// with a line number instead of taking the whole panel down).
function bijouHostAlive() { return 'host ok' }
