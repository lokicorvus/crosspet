// 生成每个特效的静态快照（会移动的元素展开成起点/中途/终点），供 check.py 检查和人物的重叠
// 用法见 tools/fxcheck/run.sh
const fs = require('fs'); global.window = {}
require(process.argv[2]); const F = window.CrossFx
const poses = ['idle','listening','thinking','reading','writing','running','searching','delegating','drawing','happy','proud','oops','surprised','pat','sleeping','tired','hum','stretch','yawn','asking','update']
// 把「往上飘」「往下落」的元素在起点、中途、终点各画一份，静态检查也能覆盖移动路径
function envelope(svg) {
  const groupRise = /<g transform="translate\(([-\d.]+) ([-\d.]+)\)((?: scale\([^)]*\))?)" opacity="0">(.*?)<animateTransform attributeName="transform" type="translate" values="0 0;([-\d.]+) ([-\d.]+)"[^>]*additive="sum"\/><\/g>/g
  svg = svg.replace(groupRise, (m, x, y, sc, body, dx, dy) =>
    [0, 0.5, 1].map(k => `<g transform="translate(${+x + k * dx} ${+y + k * dy})${sc}">${body}</g>`).join(''))
  const rectFall = /<rect x="([-\d.]+)" y="([-\d.]+)"([^>/]*)>(.*?)<animateTransform attributeName="transform" type="translate" values="0 0;([-\d.]+) ([-\d.]+)"[^>]*\/><\/rect>/g
  svg = svg.replace(rectFall, (m, x, y, attrs, inner, dx, dy) =>
    [0, 0.5, 1].map(k => `<rect x="${+x + k * dx}" y="${+y + k * dy}"${attrs}/>`).join(''))
  return svg
}
const all = [...poses.map(p => [p, F.surroundings(p) || '']), ...Object.entries(F.named || {}).map(([k, v]) => ['fx-' + k, v])]
for (const [p, raw] of all) {
  let inner = envelope(raw)
  inner = inner.replace(/<animate[^>]*\/>/g, '').replace(/<animateTransform[^>]*\/>/g, '').replace(/<animateMotion[^>]*\/>/g, '')
               .replace(/opacity="0(\.\d+)?"/g, 'opacity="1"').replace(/stroke-dashoffset="\d+"/g, 'stroke-dashoffset="0"')
               .replace(/var\(--glyph, ([^)]+)\)/g, '$1').replace(/var\(--glyph-stroke, none\)/g, 'none')
  fs.writeFileSync(`${process.argv[3]}/${p}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${F.CW} ${F.CH}" width="${F.CW}" height="${F.CH}">${inner}</svg>`)
}
