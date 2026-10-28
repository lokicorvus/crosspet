// 换角色窗口（characters.html）：左上是当前这套衣服的大立绘，下面一排是当前角色的衣服（用带背景的展示图），再下面一排是所有角色（用探头头像 avatar）。
// 这里只决定有哪些卡、用哪张图、哪张高亮；画和发消息在 characters.html。设计见 docs/superpowers/specs/2026-10-20-character-picker-design.md
// 展示图两种尺寸：portrait（大立绘用）、portrait-card（卡片用，按卡片大小缩好，Windows 上缩得太狠会糊）；自定义角色只放 portrait 也行
// 输入是外壳交给设置页的 characters：[{ id, name, accent?, images: { portrait?, avatar?, idle? }, skins?: [{ id, name, images }], skin? }]，
// skins[0] 是原版（id 为空），它的 images 是角色自己文件夹里的图——穿着皮肤时也不会变成皮肤的图
;(function (root) {
  const DEFAULT_ACCENT = '#e0b48a'

  // 卡片图：专门画的展示立绘优先（卡片尺寸的小图优先），没有就用待机图；都没有（自己加的角色只有 default 图）返回 null，由页面画色块
  const imageOf = images => images?.['portrait-card'] || images?.portrait || images?.idle || null
  // 大立绘：展示图的大图，没有就用待机图
  const previewOf = images => images?.portrait || images?.idle || null

  // 衣服卡：展示图 portrait 是带场景背景的整张皮肤图（art: true，页面铺满整张卡）；没有就退回透明底的待机图，缩进卡里
  function outfitCards(chars, currentId) {
    const c = chars.find(x => x.id === currentId)
    if (!c) return []
    const card = (id, name, images, on) => ({ id, name, image: imageOf(images), preview: previewOf(images), art: !!images?.portrait, on })
    if (!c.skins?.length) return [card('', '原版', c.images, true)]
    const worn = c.skin || ''
    return c.skins.map(k => card(k.id, k.name, k.images, k.id === worn))
  }

  // 角色卡优先用专门画的探头头像 avatar（从卡片左下角探出脑袋，铺满整张卡），没有再用展示图 / 待机图（整身缩进卡里）
  function characterCards(chars, currentId) {
    // preview / art：鼠标停在角色卡上时，大立绘预览她的原版
    return chars.map(c => ({ id: c.id, name: c.name, image: c.images?.avatar || imageOf(c.images), avatar: !!c.images?.avatar,
      preview: previewOf(c.images), art: !!c.images?.portrait,
      accent: c.accent || DEFAULT_ACCENT, count: c.skins?.length || 1, on: c.id === currentId }))
  }

  // 大立绘：当前角色穿着的那套（原版不写衣服名）
  function stage(chars, currentId) {
    const c = chars.find(x => x.id === currentId)
    if (!c) return null
    const worn = c.skins?.find(k => k.id === (c.skin || '')) || null
    const images = worn ? worn.images : c.images
    return { name: c.name, outfit: worn && worn.id ? worn.name : '', image: previewOf(images), art: !!images?.portrait }
  }

  const api = { imageOf, previewOf, outfitCards, characterCards, stage }
  root.CharacterCards = api
  if (typeof module !== 'undefined') module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)
