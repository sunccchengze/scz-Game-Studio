# scz-Game-Studio

SCZ 游戏工作室的创意工坊：游戏、角色卡与互动小实验的主场。

## 🃏 全息闪卡 · Holo Cards

| 编号 | 卡片 | 玩法 |
| ---- | ---- | ---- |
| No.001 | [八重神子 · 鸣神大社](cards/yae-miko/) | 拖动旋转 / 翻面 / 镭射滑杆 / 一键保存 |

每张卡由四层图（主体 / 背景 / 文字 / 线稿）实时合成：
视差景深、镭射光谱、Voronoi 星野、线稿呼吸光全部随视角流动，
卡片几何程序化生成，零依赖、打开即玩。

```bash
cd cards/yae-miko/web
node server.mjs        # http://127.0.0.1:4173
```

复刻一张新卡只需要四步：画主体 → 画背景 → 跑 `tools/make_layers.py` →
把四层 PNG 丢进 `web/assets/`。分层 prompt 规范见各卡目录下的 `prompts.md`。

> 全息合成思路致敬 [EverettFish/holo-card-studio](https://github.com/EverettFish/holo-card-studio)（MIT）。
> 本仓库卡面均为粉丝同人创作，与官方无关。
