# 官网的 Tally 表单

官网上有两个 Tally 表单：**新手模式等候名单**和**下一个功能投票**，入口在首页的「接下来做什么」一节（`#next`）和页脚。
点了在新标签页打开 Tally，页面里不加载 Tally 的脚本。做法照 Katachi 的反馈表单（`mxggle/katachi` 的 `docs/feedback-forms.md`）。

Tally 的表单只能是一种语言，所以每个表单有中文、英文、日文三份：

| 页面 | 用哪份表单 |
| --- | --- |
| `index.html`（简体中文）、`zh-tw.html`（繁体中文） | 中文 |
| `en.html` | 英文 |
| `ja.html` | 日文 |

| 表单 | 中文 | English | 日本語 |
| --- | --- | --- | --- |
| 新手模式等候名单 | （待填） | （待填） | （待填） |
| 下一个功能投票 | （待填） | （待填） | （待填） |

链接后面带两个参数，填进表单的隐藏字段：`lang`（`zh-Hans` / `zh-Hant` / `en` / `ja`，哪个页面来的）和 `ref`（`next` 是「接下来做什么」一节，`footer` 是页脚）。
例：`https://tally.so/r/xxxxxx?lang=zh-Hant&ref=next`。

所有表单共同的设置：不用登录；Tally 的界面语言（Settings → Language）和表单的语言一致；提交后发邮件通知到 Tally 账号的邮箱；
回复只在 Tally 后台，不对外公开；隐藏字段 `lang`、`ref`。改了表单要三种语言一起改，再各提交一次试试，确认收到邮件。

文案的规矩：新手模式还没做，表单里只说“在做 / 做好以后”，不说已经有了；投票的选项都是 [PRODUCT.md](../PRODUCT.md) 路线图里**还没做**的功能，
做完一个就从三份投票里拿掉，换成路线图里新的。

## 新手模式等候名单

### 中文

- 标题：Shadowing 新手模式 · 等候名单
- 说明：新手模式还在做。做好以后，不用自己下载模型、申请 API Key：打开就有现成的跟读素材，转写和解释直接能用。留下邮箱，上线时发一封邮件告诉你。邮箱只用来通知这件事。
- 1（必填，邮箱）：邮箱；占位：you@example.com
- 2（选填，单选）：你在学什么语言？——日语 / 英语 / 其他（可填写）
- 3（选填，单选）：你用什么电脑？——Mac（Apple 芯片，M1 及以后）/ Mac（Intel 芯片）/ Windows / 其他
- 4（选填，多选）：哪些事让你还没开始用，或者用得费劲？——选转写模型、下载模型 / 申请和填写 API Key / 找不到合适的跟读素材 / 不知道从哪开始练 / 其他（可填写）
- 5（选填，长文本）：还想说点什么？
- 按钮：加入等候名单
- 提交后：已加入！新手模式上线时会发邮件告诉你。现在也可以先下载 Shadowing，用自己手里的音频练起来。

### English

- Title: Shadowing beginner mode waitlist
- Intro: Beginner mode is still being built. When it's ready, you won't need to download a model or get an API key: it comes with ready-made shadowing material, and transcription and explanations just work. Leave your email and we'll write once when it launches. Your email is used for nothing else.
- 1 (required, email): Email; placeholder: you@example.com
- 2 (optional, single choice): What language are you learning? — Japanese / English / Other (with text)
- 3 (optional, single choice): Which computer do you use? — Mac (Apple silicon, M1 or later) / Mac (Intel) / Windows / Other
- 4 (optional, multiple choice): What's keeping you from starting, or making it hard? — Choosing and downloading a transcription model / Getting and entering an API key / Finding good material to shadow / Not sure where to start / Other (with text)
- 5 (optional, long text): Anything else?
- Button: Join the waitlist
- Thank-you page: You're on the list! We'll email you when beginner mode launches. Meanwhile, you can download Shadowing and practice with audio you already have.

### 日本語

- タイトル：Shadowing 初心者モード ウェイトリスト
- 説明：初心者モードは開発中です。完成すると、モデルのダウンロードも API キーの取得も不要に。すぐ使えるシャドーイング教材が付いていて、文字起こしも AI 解説もそのまま使えます。メールアドレスを登録いただければ、公開時に一度だけお知らせします。アドレスはこのお知らせ以外には使いません。
- 1（必須、メール）：メールアドレス；プレースホルダー：you@example.com
- 2（任意、単一選択）：学んでいる言語は？——英語 / 日本語 / その他（記入可）
- 3（任意、単一選択）：お使いのパソコンは？——Mac（Apple シリコン、M1 以降）/ Mac（Intel）/ Windows / その他
- 4（任意、複数選択）：始めにくい・使いにくいと感じる点は？——文字起こしモデルの選択やダウンロード / API キーの取得や入力 / シャドーイングに合う教材が見つからない / 何から練習すればいいか分からない / その他（記入可）
- 5（任意、長文）：そのほか、ご意見があればどうぞ
- ボタン：ウェイトリストに登録
- 送信後：登録しました！初心者モードの公開時にメールでお知らせします。それまでは Shadowing をダウンロードして、手元の音声で練習してみてください。

## 下一个功能投票

选项在三份表单里顺序一样；Tally 里打开“随机排列选项”（Randomize），“其他”留在最后。能限制选几个的话，设成最多 3 个。

### 中文

- 标题：Shadowing 下一个功能投票
- 说明：Shadowing 还在开发中，下一步先做什么，看用的人最想要什么。选出你最想要的，最多 3 个。
- 1（必填，多选，最多 3 个）：你最想要哪几个？
  - 选词查词：选中句子里的一个词，看读音、意思和它在这句里的用法
  - 按说话人练：只循环某个人的句子；角色扮演时，轮到你的句子就停下
  - 对齐我的原文：教材有原文、没有时间，把时间对到原文上，不用重新转写
  - 我说出来了吗：转写你的录音，和原文比，标出漏掉、含糊的词
  - 音高对照：原声和你的音高曲线画在一起，练日语的高低音
  - 导出到 Anki：把句子的音频、原文和解释做成卡片
  - 现成的跟读素材：不用自己找音频
  - 手机版：通勤路上也能练
  - 其他（可填写）
- 2（选填，长文本）：为什么想要它？现在是怎么凑合的？
- 3（选填，邮箱）：邮箱（选填），你投的功能做好时告诉你
- 按钮：投票
- 提交后：收到了，谢谢！你投的功能做好时会写进更新日志；留了邮箱的话，也会告诉你。

### English

- Title: Vote for Shadowing's next feature
- Intro: Shadowing is still in development, and what gets built next depends on what people want most. Pick up to 3 features.
- 1 (required, multiple choice, up to 3): Which do you want most?
  - Word lookup: select a word in a sentence to see its reading, meaning and how it's used there
  - Practice by speaker: loop one speaker's lines only; in role-play, playback stops on your lines
  - Align my own script: your textbook has the text but no timings; fit the timings to that text instead of re-transcribing
  - Did I say it? Transcribe your recording, compare it with the script, and mark words you skipped or slurred
  - Pitch comparison: the original's pitch curve and yours drawn together, for Japanese pitch accent
  - Export to Anki: cards with the sentence audio, text and explanation
  - Ready-made material: no need to find your own audio
  - Phone app: practice on your commute
  - Other (with text)
- 2 (optional, long text): Why do you want it? How do you get by without it now?
- 3 (optional, email): Email (optional), to hear when your pick is ready
- Button: Vote
- Thank-you page: Got it, thank you! When a feature you picked is ready it will be in the changelog, and if you left your email, we'll let you know.

### 日本語

- タイトル：Shadowing 次の機能の投票
- 説明：Shadowing は開発中です。次に何を作るかは、使う人がいちばん欲しいもので決めます。欲しい機能を 3 つまで選んでください。
- 1（必須、複数選択、3 つまで）：いちばん欲しい機能は？
  - 単語を調べる：文中の単語を選ぶと、読み・意味・この文での使われ方を表示
  - 話者ごとの練習：特定の人のセリフだけをループ。ロールプレイでは自分のセリフで止まる
  - 手持ちのスクリプトに合わせる：本文はあるのにタイミングがない教材でも、書き起こし直さずにタイミングを合わせる
  - 言えたかチェック：自分の録音を文字起こしして原文と比べ、抜けた語・不明瞭な語に印を付ける
  - ピッチの比較：お手本と自分のピッチ曲線を重ねて表示（日本語のアクセント練習に）
  - Anki に書き出し：文の音声・本文・解説をカードに
  - すぐ使える教材：音声を自分で探さなくていい
  - スマホ版：通勤中にも練習できる
  - その他（記入可）
- 2（任意、長文）：その機能が欲しい理由や、今どうやってしのいでいるか
- 3（任意、メール）：メールアドレス（任意）。選んだ機能ができたらお知らせします
- ボタン：投票する
- 送信後：ありがとうございます！選んだ機能ができたら更新履歴に載せます。メールアドレスを入力いただいた方には、お知らせもお送りします。
