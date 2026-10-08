# 示例音频

引导里“用示例练一下”使用的两段约 30 秒的录音，打包进应用。录音和文字都属于公有领域。

| 文件 | 原作 | 录音 | 截取 |
| --- | --- | --- | --- |
| `ja/ごんぎつね.mp3` | 新美南吉《ごん狐》（1932，作者 1943 年去世），文字取自青空文库 https://www.aozora.gr.jp/cards/000121/card628.html | LibriVox，ekzemplaro 朗读，CC0 1.0：https://archive.org/details/gongitsune_um_librivox （`gongitsune_01_niimi_64kb.mp3`） | 22.9 s 起 32.7 s，“これは、私が小さいときに”到“住んでいました。” |
| `en/The Tale of Peter Rabbit.mp3` | Beatrix Potter, *The Tale of Peter Rabbit*（1902，作者 1943 年去世），文字取自 Project Gutenberg #14838 | LibriVox *The Tale of Peter Rabbit and Others*，Public Domain Mark 1.0：https://archive.org/details/thetaleofpeterrabbitandothers_2008_librivox （`peterrabbitandothertales_01_potter_64kb.mp3`） | 18.9 s 起 27.4 s，“Once upon a time”到“I am going out.” |

处理：ffmpeg 截取，开头 0.05 s、结尾 0.3 s 淡入淡出，单声道 22.05 kHz 64 kbps MP3，去掉元数据。
字幕：先用本机 large-v3-turbo 转写得到时间，再按静音位置调整边界，文字换成原文。
