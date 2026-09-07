# No.001 八重神子 · 鸣神大社

![卡面预览](preview.png)

鸣神大社宫司大人亲临的第一张全息闪卡：雷樱夜宴为背景，
杀生樱雷光为引，翻到背面还有一枚「樱」纹藏品印。

## 玩法

```bash
cd web
node server.mjs        # http://127.0.0.1:4173
```

拖动旋转 · 滚轮缩放 · `F` 翻面 · `R` 复位 · 自动赏卡 ·
镭射/缩放/深度滑杆 · 一键保存此刻。

## 结构

| 路径 | 说明 |
| ---- | ---- |
| `assets/` | 四层图：主体 / 背景 / 文字 / 线稿（1024×1536，严格对位） |
| `web/` | 零依赖可运行站（three.js 已内置于 `vendor/`，几何程序化生成） |
| `tools/make_layers.py` | 分层流水线：rembg 抠图 → 线稿提取 → 思源宋体排版 → 体检 |
| `work/` | 原始生成图与质检图 |
| `card-config.json` / `prompts.md` | 卡片元数据与分层 prompt 存档 |

## 复刻下一张

1. 按 `prompts.md` 画好主体（纯黑底全身）与背景（竖构图，中央留空）；
2. `python3 tools/make_layers.py .` 生成四层图；
3. 把 `assets/*.png` 同步到 `web/assets/`，改 `web/card-config.json` 文案；
4. `node web/server.mjs` 开赏。

> 全息合成思路致敬 [EverettFish/holo-card-studio](https://github.com/EverettFish/holo-card-studio)（MIT）。
> 本卡为粉丝同人创作，与官方无关。
