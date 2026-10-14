# DeepSeek真实接口配置

核对日期2026-10-14。用户选择DeepSeek服务，默认Base URL `https://api.deepseek.com`，视觉提取使用 `deepseek-flash`；数学授课与逐步审核使用 `deepseek-v4-pro` 的高推理模式。初轮Flash文本讲义经独立内容审查发现错误，已撤回并保留原始证据。旧`deepseek-v4-flash-vision-exp`名称已由现行Flash承接，不用旧型号作默认。

本机`.env`中填写`DEEPSEEK_API_KEY`，服务从环境变量或此文件读取；不填写在网页，不提交Git。既有OpenAI密钥不能发给DeepSeek。未配置时显示未连接，不返回预设题面或讲义。

图像使用`user`消息的`image_url`内容块，携带原图/精确裁剪的base64。先提取真实题面，再由用户对照印刷原图确认；原图中的手写推算不当标准答案。结构化输出由服务端验证，模型不得执行代码。当前模型限额以供应方实际返回为准。

真实运行报告必须记录模型、调用时间、原始提取、校对差异、每个小问课程及独立核验；不把本文件或已有金标准叫作API实测。

官方依据：[首个API调用](https://api-docs.deepseek.com/)、[图像理解及当前视觉模型](https://api-docs.deepseek.com/guides/vision/)、[Chat Completions字段](https://api-docs.deepseek.com/api/create-chat-completion/)。

Pro用于文本，不接收题图。模型能力与参数依据：[模型表](https://api-docs.deepseek.com/quick_start/pricing/)、[推理模式](https://api-docs.deepseek.com/guides/thinking_mode/)。推理模式提高检查力度，仍不能替代逐小问内容验收。
