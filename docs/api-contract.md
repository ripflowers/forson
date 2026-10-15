# 样卷核心流程 API 契约

日期2026-10-15。生产设计依据为 ../.. /deliverables/math-teacher-design-20261013/12-final-system-design.md。
本阶段单家庭本机版：服务仅监听127.0.0.1；Postgres保存题面、任务、教案、追问与学习事件。真实模型输出才可进入课程，评测金标准与课程生成输入隔离。全部JSON用camelCase，ID为字符串，时间为ISO8601。

## 对象

Question: `{id,paperId,number,revision,state,stem,options:[{label,text}],figureDescription,sourceRegions:[{pageIndex,x,y,width,height}],missingFields:string[],parts:[{id,label,prompt}],lessonState,concepts:string[]}`。
state为extracted/needs_confirmation/needs_completion/confirmed；lessonState为draft/checking/ready/needs_repair/stale或null。区域坐标为旋正页的0..1。

Paper: `{id,title,createdAt,state,pages:[{index,url,width,height}],questionCount,partCount}`。
Coverage: `{questionCount,partCount,confirmedQuestions,readyQuestions,readyParts,blockedParts}`。readyParts只来自当前题面版本的完整核验教学包，不能按按钮或生成请求算。

Job: `{id,paperId,questionId,type,state,stage,completedUnits,totalUnits,error,createdAt}`。state为queued/running/cancel_requested/cancelled/succeeded/failed。type为extract/lesson/lessons。stage独立；error为null或可读说明，禁止泄漏密钥。

Video: `{id,state,stage,progress,error,questionId,questionRevision,lessonVersion,partId,pace,snapshotHash,createdAt,updatedAt?,width:1280,height:720,hasAudio:boolean,narrationId:string|null,durationSeconds?,fps?,frameCount?,url?}`。state为queued/rendering/ready/failed；progress是0..100的整数，只有ready为100且提供url。stage为queued/bundling/browser/composition/rendering/encoding/ready；error提供可读的失败说明，详细阶段诊断留在私有目录。提供有效narrationId时hasAudio=true，否则为false；这个字段在queued时仅描述渲染请求，不表示真实MP4已经通过验收。视频任务独立于AI Job，不写入AI生成任务或学习掌握记录。

Narration: `{id,state:'ready',questionId,questionRevision,lessonVersion,partId,lessonHash,voice,rate,scriptVersion,fps:30,createdAt,clips:NarrationClip[],stageDurations:number[],durationInFrames:number,askId?,answerHash?}`。成功接口只返回全部实际音频完成后的ready清单，私有准备记录另有preparing/failed状态。lessonHash是批准小问内容的SHA256；askId/answerHash只用于核验答复补讲，不用于完整主课。当前声线zh-CN-XiaoxiaoNeural、rate=-8%、scriptVersion=q26-teacher-voice-2；仅适配当前第26题main教案及22/24三角形点阵语义。

NarrationClip: `{id:'clip-NNN',stageIndex,text,from,durationInFrames,audioFrames,audioHash,audioUrl,visualFrom,visualTo}`。from/audioFrames/durationInFrames均为原30fps配音时间线上的整数帧，不是秒；audioFrames由真实MP3的ffprobe时长向上取整，durationInFrames额外包含12帧观察停留；每章末另加30帧。stageDurations记录各章完整帧数，durationInFrames为全课总帧数。visualFrom/visualTo是TeachingVisual的canonical秒：把本段真实语音进度映射到该动画窗口，两端相等时保持画面。MP3文件通过audioHash冻结校验；audioUrl来自本机文件接口，不暴露本机绝对路径。

TeachingPackage: `{id,questionId,questionRevision,lessonVersion,status,reviewLevel,model,createdAt,coveredPartIds:string[],concepts:string[],parts:LessonPart[],checks:{inputConfirmed:boolean,coverage:boolean,answerVerified:boolean,reasoningReviewed:boolean,issues:string[]}}`。

LessonPart: `{partId,label,goal,known:string[],prerequisites:string[],method,steps:[{id,title,explanation,reason,formulaLatex}],answer:{kind,value,display},verification,misconceptions:[{mistake,correction}],summary,scene:null|{kind:'number-line'|'triangle-count',params:object}}`。
steps不能为空或仅答案，goal/known/method/理由/检验/易错/收束必须齐。answer.kind/value与独立金标准对应，value可为字符串、数值、数组或JSON对象；display只负责显示。scene只接受已实现的两种数学组件，不执行模型代码。图片图注缺失不被答案补齐。

number-line的params固定为`{left,right,targetSum?,targetMinimum?,parameterName?:'a',parameterValue?}`；参数a探索时由受控函数计算left=-a、right=3，老师示范状态独立。triangle-count固定为`{lower,upper,previewRows?}`；Q26为22/24，探索小点阵为2至8层，原题增量23+24=47。老师原题动画的rows可以为24，具体边界见下文，不能用探索小例的上限截断原题。

LearningEvent: `{id,questionId,questionRevision,lessonVersion,partId,kind,authorKind,text,payload,createdAt}`。authorKind为learner/system-observation/system；kind为note/observation/lesson-part-viewed/question-finished/help-used/answer-exposed。
Session: `{questionId,questionRevision,lessonVersion,sessionRevision,partId,stepIndex,mode,sceneState,reflection,returnTarget,updatedAt}`。mode为teacher/explore/exercise；returnTarget保存原模式、步骤、小问、参数和草稿。

## 路由

| 操作 | 请求 | 成功返回 |
|---|---|---|
| GET /api/status | 无 | `{aiConfigured,provider,model,visionModel,dbReady,scope:'local-family'}` |
| GET /api/papers | 无 | `{items:Paper[]}` |
| POST /api/papers | multipart files[]与title；最多10图/20页PDF/100MB | `{paper:Paper,job:Job}`，已保存原页并开始真实识别 |
| POST /api/sample-import | 无 | 同上；真实读取两张原照，不装载金标准题面 |
| GET /api/papers/{id} | 无 | `{paper,questions:Question[],coverage}` |
| PATCH /api/questions/{id} | `{expectedRevision,stem,options,figureDescription,missingFields,parts,sourceRegions?,confirm:boolean}` | `{question}`；不符版本409；缺项不能confirmed；修题停止旧结果发布 |
| POST /api/papers/{id}/confirm-all | 无 | `{questions,coverage}`；只确认无missingFields的题 |
| POST /api/questions/{id}/lesson | `{expectedRevision}` | `{job}`；未确认409，缺项422；当前就绪包复用 |
| POST /api/papers/{id}/lessons | 无 | `{job}`；只处理当前已确认完整题；整卷每批6题；全局AI请求8并发上限，任务调度最多2个job |
| GET /api/questions/{id}/lesson | 无 | `{lesson:TeachingPackage|null}`；过期不得当ready |
| POST /api/questions/{id}/videos | `{expectedRevision,lessonVersion,partId,pace?:1\|2,narrationId?:string\|null}`，默认pace=1 | HTTP200 `{video:Video}`，实际写入已批准小问及可选完整主课配音快照并排队；queued不表示已产生MP4 |
| GET /api/videos/{id} | 无；id必须为规范UUID | `{video:Video}`；rendering读取Remotion实际进度，ready才提供下载url；未知或无效id为404 |
| GET /api/videos/{id}/file | 无；只允许ready任务的固定lesson.mp4 | H.264 MP4文件，1280×720；`Cache-Control: private, no-store`，下载名为`lesson-r{questionRevision}-v{lessonVersion}.mp4`；未完成、文件缺失或路径无效为404 |
| POST /api/questions/{id}/ask | `{questionRevision,lessonVersion,partId,stepId,mode,snapshot,text}`；snapshot顶层包含当前小问的x/a/rows；teacher模式另保留暂停帧frame/localFrame/fps/pace与teacherPhase；保留sceneState、stepIndex与reflection | `{id,questionId,questionRevision,lessonVersion,partId,text,answer,status,evidence,createdAt}`，status为checked/needs_review；答疑绑定提交快照，持久保存 |
| GET /api/questions/{id}/asks | 无 | `{items}`，本题已保存追问，保留旧题面版本标记 |
| GET /api/questions/{id}/narration | query `lessonVersion`必填整数≥1；`partId`可选，默认main、长度1..80 | `{narration:Narration\|null}`；读取当前内容、声线、语速、脚本版本的完整缓存，无当前缓存时为null；不触发TTS |
| POST /api/questions/{id}/narration | `{expectedRevision,lessonVersion,partId}`，前两项严格整数≥1 | HTTP200 `{narration:Narration}`；等待所有真实TTS片段合成及音频时长核验，或复用内容一致的完整缓存；不是Job排队接口 |
| GET /api/narration/{narrationId}/clips/{clipId}.mp3 | 规范UUID；clipId必须为该ready清单内的clip-NNN | MP3文件，`audio/mpeg`、`Cache-Control: private, no-store`；未知、未完成、文件缺失或路径无效为404 |
| POST /api/questions/{id}/asks/{askId}/narration | 同NarrationRequest：`{expectedRevision,lessonVersion,partId}` | HTTP200 `{narration:Narration}`；仅为本题当前小问的checked答复制作一段真实补讲，附askId/answerHash；未核验答复422，版本不符409，未知答复404 |
| GET /api/jobs/{id} | 无 | `{job}` |
| POST /api/jobs/{id}/cancel | 无 | `{job}`；取消请求与完成分开 |
| POST /api/jobs/{id}/retry | 无；仅failed/cancelled可重试 | `{job}`；创建新任务与lease，不能发布旧调用结果 |
| GET /api/records | 可选paperId | `{items:LearningEvent[]}` |
| POST /api/events | LearningEvent除id/createdAt | `{event}`；原话与观察分别记录 |
| GET /api/sessions/{questionId} | 无 | `{session:Session|null}` |
| PUT /api/sessions/{questionId} | Session除updatedAt；expectedSessionRevision代替sessionRevision | `{session}`；版本冲突409保留提交草稿 |
| GET /api/papers/{id}/coverage | 无 | `{coverage,questions:[{number,questionId,revision,parts:[{partId,status,issues}]}]}` |

HTTP错误统一`{detail:string}`。前端轮询任务后重新读取当前题面和教案，不能把老响应装回新版本。API密钥不得出现在前端、返回或日志。

无密钥仍可保存原图，返回实际paper及明确失败的配置任务，题面为空；页面标原图已保存/尚未识别。配好密钥后重试才调用AI，不能用金标准填补空题面。

后台Pro采用高推理；追问及答疑复核采用低推理并独立审核。stepIndex的0/1分别为读题与选方法，2起映射当前真实步骤，最后一页为检验收束；stepId须与这个位置相符，前两页/收束页为null。无效位置或不符的步骤返回422，模型上下文记录当前教学页及真实步骤，不能以旧步骤解释新页。

本轮代码给追问生成及独立审核分别设置45秒限时；任一阶段超时，保留原话和snapshot，保存status=needs_review，并在evidence中记录`responseTimeout:true,timeoutSeconds:45`。此时不产生checked答复、补讲配音或自动续讲。两个模型阶段的限时不是整个HTTP请求的统一45秒限时。三个隔离测试通过；当前API已重启加载修改，真实新追问在生成阶段45秒超时，保存为needs_review，主课停在7700帧且无补讲播放；详见第26题实际记录。

## 教师时间线与追问现场

网页Remotion Player与视频渲染复用同一Lesson组合组件及时间线。老师主线可自动演进、暂停和定位；追问先暂停播放器，再取得当前画面的snapshot，避免只用课堂段落起始状态回答正在移动的图形。

| snapshot字段 | 含义 |
|---|---|
| frame | 当前小问全局帧位置，从0开始 |
| localFrame | 当前教学片段内的帧位置，从0开始 |
| fps | 时间线帧率，当前为30 |
| pace | composition内部节奏，网页当前为1，视频请求可为1/2；网页用户调速由Player的playbackRate同时作用于声音和画面，不能把canonical动画秒与播放秒混为一谈 |
| stepIndex | 当前教学片段，沿用0/1/2起的步骤映射 |
| teacherAnimation | 受控教师动画现场为true；探索现场不使用这个标记替代探索条件 |
| teacherPhase | 当前动画阶段；三角形数为growth/example/original，数轴按当前教学动作标识阶段 |
| teachingAction | 三角形数更细的动作，如small-example、original-common、cancel-common、verify、summary |
| x/a/rows | 当前受控数学参数；服务端用题面固定参数及这些现场数值重新计算computedSceneFacts |
| narrationId/clipId | 有声课堂当前配音与口述片段ID；它们描述提问时的现场，不替代题面及教案版本校验 |
| spokenText/speaking | 当前完整片段口述文本及是否处于本段音频帧；观察停留期间spokenText为null、speaking=false |
| visualFrame | 有声片段进度映射后的canonical动画帧，不等于主课frame或章节localFrame；三角形点数从该帧受控计算 |

三角形数的教师动画和孩子探索使用不同的rows契约：

- `teacherAnimation=true, teacherPhase='growth'`：rows为1至8的整数；服务端提供growth的每行点数与总点数，不提前当作相减比较。
- `teacherAnimation=true, teacherPhase='original'`：rows必须等于scene.params.upper，Q26为24；提供visibleOriginal的新增行23/24、可见47点、共同253点、原题总300点。共同部分用省略块表示，不能把24层解释成探索小例。
- example及普通探索：rows为2至8的整数；提供previewComparison，比较当前小点阵与少两行的点阵，同时另保留原题22/24的originalComparison。小例数值和原题数值分开。

动画snapshot用于还原提问现场；数学结论使用服务端computedSceneFacts，不能把客户端提交的pointCount、距离和或答案标签直接当作计算依据。

## 本机视频导出边界

创建视频必须精确匹配当前题面revision和当前lessonVersion。题面未confirmed或仍缺条件、教案未ready、checks四项未全部为true、小问不属于题面或未被完整覆盖、同一partId出现重复讲义，均不允许导出。版本不符返回409，条件或内容不完整返回422，请求中的任意outputPath及额外字段也返回422。

每次创建只冻结该已批准小问的教学字段，以及题目ID、题面版本、教案版本、小问ID、pace；保存不可变JSON快照及SHA256。数轴的parameterValue/targetSum/targetMinimum与原课堂一致。快照不包含原页图片、孩子笔记、探索草稿、AI密钥或数据库凭据。后续题面修改不会悄悄改写已经创建的视频；历史视频继续显示原版本，不能冒充新版讲解。

提供narrationId时还必须是ready完整主课清单，questionId/revision/lessonVersion/partId/lessonHash与当前批准小问一致，stageDurations数量等于steps.length+3且clip.stageIndex覆盖全部阶段；答疑补讲清单禁止代替主课。服务端逐个读取并核验MP3的SHA256，复制到当前视频私有audio目录，把配音清单冻结进inputProps。缺失或变化的音频返回422，配音与当前内容不符返回409。渲染引用固定的本机音频快照，不使用任意远程音频或任意outputPath。

导出使用本机Remotion bundler与renderer，固定Lesson组件生成1280×720、30fps的H.264 MP4。有配音时混入AAC音轨，组件中的Sequence/Html5Audio与动画使用同一帧时钟；pace=2同步缩短画面与音频并保持音高。无narrationId则hasAudio=false，仍生成无声图文视频。服务器一次渲染一个视频；progress来自真实打包及渲染回调，排队不会用计时器伪造进度。ready须等渲染进程成功、MP4文件存在且输出元数据可读；有声导出额外用ffprobe确认存在音频流。仅成功创建请求或达到某个进度不能宣称导出完成。

视频及快照保存在本机私有`data/runtime/videos/{uuid}/`，文件接口不能指定任意目录。重启可读取已完成视频并继续queued任务；上次rendering任务标为failed，不将中断输出当成功。失败后重新POST创建新任务，不使用AI Job的retry路由。详细渲染诊断保存在私有renderer-error.json，API只返回安全阶段说明。

视频模块的队列、版本、路径、恢复和HTTP契约工程测试使用明确标注的fake renderer或文件夹具；这些测试通过不等于真实MP4验收。真实验收需要实际调用Remotion、检查媒体信息、播放或抽帧核对教师推理与公式，并单独记录证据。

## 配音准备与补讲边界

NarrationRequest拒绝额外字段，不能从网页指定voice/rate/script、保存目录或任意TTS文本。题面未confirmed、仍缺条件、教案未ready、四项核验不全、小问未覆盖或不符合本轮第26题脚本语义，返回422；题面或教案版本冲突返回409。TTS网络失败、音频流/时长核验失败或本机ffprobe不可用返回503，API只返回可读安全说明。准备期间如果教案内容变化，结束后再次检查lessonHash，不发布为当前配音。

准备缓存身份含questionId/revision/lessonVersion/partId/lessonHash/voice/rate/scriptVersion/fps；补讲额外含askId/answerHash。命中缓存前核验身份SHA256与每个音频文件SHA256，不以文件名存在代替完整性。服务重启时将遗留preparing标记failed，不能把不完整音频当ready；重新POST可准备新配音。

补讲首先核对本题答复的版本、partId和checked状态，只将已经核验的answer改成口述。当前支持Q26用到的有限数学词汇，包括T下标n、简单分式、加减乘除等；未支持的反斜杠命令或上下标会明确返回422并保留文字。TTS准备后再核验答复状态与answerHash，避免旧答复声音装回新答复。网页在提问前冻结Player帧，补讲用独立audio播放；只有补讲结束及原播放意图、当前身份、前台状态、老师模式、会话保存状态均允许时才从冻结帧继续。

同questionId/revision/lessonVersion/partId的历史checked答复可按精确askId调用补讲接口；缓存身份继续包含该askId及answerHash，不能复用另一条答复的声音。网页切换历史答复前先停止主课和旧补讲，保留历史现场标签；重新听历史解释不触发新答疑生成，也不表示当前新的追问已经成功。

配音使用在线Edge TTS，准备需联网；已完成音频由本机私有文件接口播放。当前没有面向多人生产使用的语音SLA，其他科目配音未在本轮实现。设计与逐项运行证据见[q26有声课堂记录](q26-voice-classroom-20261015.md)；原无声视频报告保留为历史证据。
