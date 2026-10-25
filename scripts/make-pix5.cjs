// One-off generator for apps/web/public/fonts/Pix5-*.otf (not part of the build). opentype.js is
// not a project dependency: `npm i --no-save opentype.js@1.3.4`, then `node scripts/make-pix5.cjs apps/web/public/fonts`.
// Builds Pix5: a single "5" on Pixelify Sans's pixel grid (flat top, straight left stem, round
// bowl), so it no longer reads as an S. Rectangles overlap by ~10 units, as Pixelify's own do.
const ot = require('opentype.js');
const out = process.argv[2];
const designs = {
  400: { adv: 586, rects: [[60, 540, 525, 631], [60, 440, 161, 550], [60, 350, 433, 440], [423, 78, 525, 359], [151, -12, 433, 88], [60, 78, 161, 179]] },
  500: { adv: 592, rects: [[60, 544, 531, 633], [60, 432, 170, 554], [60, 344, 440, 432], [420, 77, 531, 354], [150, -12, 440, 100], [60, 77, 170, 190]] },
};
for (const [w, d] of Object.entries(designs)) {
  const p = new ot.Path();
  for (const [x1, y1, x2, y2] of d.rects) { p.moveTo(x1, y1); p.lineTo(x1, y2); p.lineTo(x2, y2); p.lineTo(x2, y1); p.close(); }
  const glyphs = [
    new ot.Glyph({ name: '.notdef', unicode: 0, advanceWidth: d.adv, path: new ot.Path() }),
    new ot.Glyph({ name: 'five', unicode: 0x35, advanceWidth: d.adv, path: p }),
  ];
  const font = new ot.Font({ familyName: 'Pix5', styleName: w === '400' ? 'Regular' : 'Medium', unitsPerEm: 1000, ascender: 920, descender: -280, glyphs });
  font.download = undefined;
  require('fs').writeFileSync(`${out}/Pix5-${w}.otf`, Buffer.from(font.toArrayBuffer()));
  console.log('wrote', `Pix5-${w}.otf`);
}
