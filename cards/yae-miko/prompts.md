# 八重神子 · 闪卡分层 prompt 存档

画布：1024 × 1536 竖构图，上下各预留约 15% 文字区。

## background（背景层，不透明）

> Vertical portrait anime background illustration, no people, no characters, no text:
> a grand night festival scene at a Japanese shrine on a mountaintop, giant glowing
> violet thunder-sakura tree with luminous petals drifting, vermillion torii gates,
> stone lanterns with warm light, distant purple lightning clouds and a huge pale moon,
> floating spirit wisps, deep indigo and violet palette with pink accents, painterly
> anime matte painting, detailed edges, calm empty center area for a character to stand,
> 2:3 portrait composition

## subject（主体层，纯黑底 → rembg 抠图）

以 3 张官图为形象参考（粉发狐耳、白衣绯袴、金饰雷纹）：

> Full-body anime key-visual illustration of the same character from the reference
> images: a beautiful shrine maiden with very long sakura-pink hair, golden fox ears,
> purple eyes, white and crimson shrine dress with wide flowing detached sleeves,
> purple obi sash, gold earrings and small bell ornaments. She stands gracefully in
> three-quarter view, one hand elegantly raised conjuring a small glowing violet
> electro sakura blossom with tiny lightning sparks, long sleeves and hair flowing.
> Head-to-toe fully visible and centered with clear margins, isolated on a solid pure
> black background, nothing else in the frame, no text, no border. Vertical 2:3
> portrait composition, clean bold contours, vibrant colors, highly detailed anime style.

## lineart（线稿层，零漂移）

不重新生成，由 `subject.png` 经形态学梯度（Max−Min）直接提取，保证与主体严格对位。

## text（文字层，程序排版）

`tools/make_layers.py` + 思源宋体（Noto Serif SC）精确排版：
八重神子 / 鸣神大社·宫司大人 / 大密法·天狐显真 / 杀生樱落，雷光乍现 / No.001·樱
