function forge(pattern, srcFlags, flagsByte) {
  var cb = serialize(new RegExp(pattern, srcFlags), undefined, { scope: "DifferentProcess" });
  var u8 = new Uint8Array(cb.arraybuffer);
  for (var i = 0; i + 8 <= u8.length; i += 4) {
    var tag = u8[i+4] | (u8[i+5] << 8) | (u8[i+6] << 16) | (u8[i+7] << 24);
    if ((tag >>> 0) === 0xFFFF0006) { u8[i] = flagsByte; break; }
  }
  cb.clonebuffer = u8.buffer;
  return deserialize(cb, { scope: "DifferentProcess" });
}
try {
  var forged = forge("[\\q{abc|de}]", "v", 0x90);
  var bad = new RegExp(forged, "u");
  try { bad.exec("abc"); } catch {}
  var good = new RegExp("[\\q{abc|de}]", "u");
} catch {}
