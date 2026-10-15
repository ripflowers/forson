# 知间 · 初中互动老师

按最终设计开发的本机核心版：上传原照/整卷 → 真实AI提取 → 原图对照校对 → 逐小问老师主线 → 数轴/点阵探索 → Postgres学习记录。

代码独立于工作区其他项目。页面沿用Noto Sans SC/Manrope、青色令牌、明暗主题和画布＋老师侧栏。AI输出仅是受控数据，不执行模型生成的网页代码。

## 本地启动

本轮已准备项目专用Postgres容器`zhijian-core-db`，仅监听127.0.0.1:55432，数据留在专用卷。根目录`.env`不入Git，默认DeepSeek地址和模型已填；在本机填入`DEEPSEEK_API_KEY`。不要把密钥填入网页或聊天。

```sh
cd /Users/ripflowers/workspace/ningxx/zhijian-learning-app
uv venv .venv --python 3.12
uv pip install --python .venv/bin/python -r server/requirements.txt
cd web && npm ci && cd ..
python3 scripts/start_local.py
```

已有`.venv`则跳过创建。学习页面`http://127.0.0.1:5178`，业务服务`http://127.0.0.1:8787`。不开放公网，不把本机单家庭范围声称为多人认证系统。服务未配置AI时只能保存输入和展示连接状态，不返回模拟题目或教学答案。

Docker Compose V2可用时，新机器可以`docker compose up -d db`建立本机数据库；本轮使用专用`docker run`容器，重启数据库可执行`docker start zhijian-core-db`。初始化数据库密码与`.env`的DATABASE_URL需一致。

## 用这份原卷验收

本机已保存这份样卷及真实AI课程。打开页面后选择“我的试卷”，可直接进入任意完整题目的老师课堂，无需重新导入或再次付费生成。当前27题号、39叶小问中，38个可解叶全部通过覆盖检查与独立内容复核；第11题原照缺少定义，保持待补全。

“导入这份样卷”读取保存的两张原照，调用视觉AI，不读取金标准。首次提取保留原始输出；先核对原图中的负号、分数、小问、图标签及选项，再确认。第11题定义缺失，保持待补。正确的叶小问清单为39项，其中38项当前可核验。

第15题原图第三项是减号，正确结果−24。此前设计样稿的0有误；此版必须用原图和独立数学核验拒绝这一错误。第19题有四个叶小问，不能只教距离最小的第一问就计整题完成。

完整课程必须逐问包含目标、已知、先备、方法、步骤与理由、结论、检验、易错及收束。仅结构字段齐全不足以保证正确，还要通过独立答案与理由检查。当前核验等级明确标自动核对，不能冒称真人教师签审。

```sh
.venv/bin/python scripts/validate_sample.py --paper-id 94ef6be9-95e5-4579-ac7f-9d0ebb62aee8
```

代码验证：`PYTHONPATH=server .venv/bin/python -m pytest server/tests -q`；前端在`web`目录运行`npm test`及`npm run build`。数据库测试使用独立的`TEST_DATABASE_URL`，不能用家庭学习库代替。

这条命令只读取真实服务数据并生成逐小问差异报告，不填入参考答案、不生成课程、不改题。运行证据保存在`data/runtime/evidence`，不入Git。金标准是独立验收材料，真实OCR、生成内容、人工校对及学习效果分别报告。

## 连续讲授与视频

老师课堂沿同一块板书连续讲授，无需逐段点击下一步；有声课堂先由用户点击播放，满足浏览器声音许可。可以暂停、拖动整课时间线、回看步骤、调速或进入探索。当前数学动画覆盖三角形数与绝对值距离，其他题采用条件和累计推理板书。输入笔记/疑问、页面隐藏及课程结束会暂停；读过记录仍需明确操作。

课堂由Remotion Player驱动，网页与本机MP4导出共用同一个Lesson composition和数学计算。第26题现可点击“准备老师声音”，再“从头听老师讲课”：真实普通话声音、点阵与同步字幕沿同一时间线推进。讲稿是当前已核验教案的口语改写，不重新调用AI生成课程；其他题暂时仍是图文课堂。

填写疑问时先一起暂停并冻结原帧；真实DeepSeek答疑及独立核对通过后制作补讲配音，补讲结束再按原播放意图从冻结帧继续。离开课堂、页面隐藏、版本变化、核验失败或声音播放失败时保持暂停。当前同版本的历史已核对答复也可点击“听老师补讲”，保留历史现场标记；本轮已用此前真实答复验证Edge补讲、主课冻结及原帧续讲。

2026-10-15的[DeepSeek官方状态页](https://status.deepseek.com/)报告网页/API部分中断，本次新追问与Flash探测未成功；历史答复验证不能替代此次新答疑生成。答疑/审核各45秒超时门禁已加入代码并通过隔离测试，重启后的实际超时路径待验收。完整状态见第26题专门记录；有声MP4目前仍在渲染。

在“把这节课带走”选择正常讲解/紧凑回顾，导出当前小问完整教案。已加载第26题配音时导出请求带入同一配音快照，制作720p、30fps的有声教学视频；未准备配音的课堂仍导出无声图文视频。配音使用`edge-tts`在线Edge语音，准备需要联网及本机`ffprobe`；已有MP3/MP4本机保存。推广到更多家庭前需专业TTS的稳定性与服务约定，本轮仅针对第26题验收。

开发预览在web目录执行 `npx remotion studio src/remotion/entry.tsx --no-open`。真实教案props只保存在私有运行目录，按需传 `--props ../data/runtime/evidence/remotion-q26-props.json`。Studio是开发工具，用完停止；家庭学习页面仍为5178。

## 设计与接口

- [实施计划](docs/superpowers/plans/2026-10-14-sample-core.md)
- [API契约](docs/api-contract.md)
- [原图与39小问基准](docs/sample-ground-truth.md)
- [DeepSeek官方接入依据](docs/deepseek-integration.md)
- [原核心运行验收记录](docs/core-runtime-report.md)
- [连续课堂与Remotion设计](docs/guided-classroom-design.md)
- [本轮课堂及视频验收](docs/guided-classroom-acceptance.md)
- [第19题讲解更正记录](docs/q19-teaching-correction-20261014.md)
- [第26题有声课堂设计与运行记录](docs/q26-voice-classroom-20261015.md)

最终设计源位于`../deliverables/math-teacher-design-20261013/12-final-system-design.md`。数据不默认公开；原照只供当前家庭私用。
