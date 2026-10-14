# 知间真实样卷核心流程 Implementation Plan

> **For agentic workers:** 按已获授权的最终设计实施；工作目录独立，前后端及金标准分别拥有文件。用有意义的测试先确定行为，集成后独立审核。

**Goal:** 用用户两张原照跑通真实识别、逐小问校对、老师授课、互动探索和跨刷新学习记录。

**Architecture:** React/TypeScript延续现有原型的字体、青色令牌、画布及老师侧栏。FastAPI调用DeepSeek兼容API；Postgres持久保存版本、任务和学习证据，私有本地目录保存原图。金标准仅用于独立评测，不能作为识别或生成结果。

**Tech Stack:** React、Vite、KaTeX、FastAPI、Pydantic、httpx、psycopg、Postgres；初版仅本机绑定。

**Spec:** /Users/ripflowers/workspace/ningxx/deliverables/math-teacher-design-20261013/12-final-system-design.md

## Global Constraints

- 所有代码位于zhijian-learning-app，不修改商城或旧设计样稿。
- API精确采用docs/api-contract.md；密钥仅服务端环境变量，数据目录不入Git。
- 27主题号含缺定义第11题；叶小问以原图人工清单为准。缺定义禁止猜答。
- 旧稿第15题错误不能流入AI答案校验；原图第三项为减号，结果−24。
- 数值、理由、子问覆盖与学习事实分开。系统观察不能叫孩子原话，读过不自动记掌握。
- ready只发布当前题面版本核验通过的完整教案；修题/取消/重试晚回不能覆盖。
- 保持Noto Sans SC/Manrope、共同明暗配色、清晰图式、44px操作与320px重排。

## Review Focus

1. 图像里负号、绝对值线、分数和图标签容易串；逐原图对照，Q15做减号回归。
2. 题号齐全却漏8/17/18/19/23/27的小问；覆盖按partId逐项检验。
3. 缺定义或修改题面后旧任务晚回；验证没有ready发布。
4. 刷新与跳出课堂丢草稿/冒充已保存；Postgres重启和浏览器恢复检查。
5. 自动观察与孩子解释、看过摘要与完整授课混淆；事件来源和课程范围分别断言。

## Task 1 原图金标准

Files: data/sample_manifest.json、docs/sample-ground-truth.md。
- [ ] 旋正和局部阅读原照，列27题及全部叶小问，给原图区域。
- [ ] 对可计算结果独立验算，记录旧稿差异；Q11明确不可核验。
- [ ] 检查编号连续、partId唯一、39叶小问与38完整小问（若原图核对不同则修正文档，不强凑）。

## Task 2 真实服务与持久化

Files: server/zhijian/*.py、server/tests/*、server/requirements.txt。
Interfaces: docs/api-contract.md；读取原照、AI配置、Postgres，金标准仅核验阶段读取。
- [ ] 测试题面修订和记录持久化、Q11阻断、缺partId不能就绪、Q15不能接受0、取消及旧版本晚回不得发布。
- [ ] 实现原图保存/旋正、真实视觉提取、人工确认、逐题老师教案、完整性/答案/理由复核。
- [ ] 用事务和任务幂等保存当前结果；追问绑定快照；事件与会话保存到Postgres。
- [ ] 跑pytest，并用真实数据库验证健康、上传和刷新后的数据。

## Task 3 真实学习界面

Files: web/*。
Interfaces: docs/api-contract.md；所有题面/教案/记录来自API，禁止预置27题或答案。
- [ ] 上传原图、任务进度、原图对照校对、逐小问目录与覆盖计数。
- [ ] 教师完整主线按小问及步骤展开，Why追问、暂停、可选探索与返回原步骤。
- [ ] 距离数轴、三角形点阵由计算函数驱动；来源标记、原话和观察分别保存，恢复现场不自动发声。
- [ ] npm test、npm run build；浏览器检查320/1024px以及真实记录刷新恢复。

## Task 4 样卷运行与独立验收

Files: scripts/validate_sample.py、docs/core-runtime-report.md、data/runtime/evidence/*（不入Git）。
- [ ] 对真实OCR与人工原图金标准逐题/符号/小问比较，保留原始失败，不预置通过率。
- [ ] 经校对后生成26完整主题的课程，按38小问检查逐步理由、结论、检验、易错与收束。
- [ ] 重点检查Q15减号、Q19四部分、Q26新增两行；以真实生成内容评测。
- [ ] 浏览器上传/校对/课堂/探索/记录/恢复与服务竞态测试，修正阻塞问题。
- [ ] 独立审核代码和证据后交付启动命令与可用页面；未实测内容明确标注。
