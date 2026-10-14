# 样卷核心流程 API 契约

日期2026-10-15。生产设计依据为 ../.. /deliverables/math-teacher-design-20261013/12-final-system-design.md。
本阶段单家庭本机版：服务仅监听127.0.0.1；Postgres保存题面、任务、教案、追问与学习事件。真实模型输出才可进入课程，评测金标准与课程生成输入隔离。全部JSON用camelCase，ID为字符串，时间为ISO8601。

## 对象

Question: `{id,paperId,number,revision,state,stem,options:[{label,text}],figureDescription,sourceRegions:[{pageIndex,x,y,width,height}],missingFields:string[],parts:[{id,label,prompt}],lessonState,concepts:string[]}`。
state为extracted/needs_confirmation/needs_completion/confirmed；lessonState为draft/checking/ready/needs_repair/stale或null。区域坐标为旋正页的0..1。

Paper: `{id,title,createdAt,state,pages:[{index,url,width,height}],questionCount,partCount}`。
Coverage: `{questionCount,partCount,confirmedQuestions,readyQuestions,readyParts,blockedParts}`。readyParts只来自当前题面版本的完整核验教学包，不能按按钮或生成请求算。

Job: `{id,paperId,questionId,type,state,stage,completedUnits,totalUnits,error,createdAt}`。state为queued/running/cancel_requested/cancelled/succeeded/failed。type为extract/lesson/lessons。stage独立；error为null或可读说明，禁止泄漏密钥。

Video: `{id,state,stage,progress,error,questionId,questionRevision,lessonVersion,partId,pace,snapshotHash,createdAt,updatedAt?,width:1280,height:720,hasAudio:false,durationSeconds?,fps?,frameCount?,url?}`。state为queued/rendering/ready/failed；progress是0..100的整数，只有ready为100且提供url。stage为queued/bundling/browser/composition/rendering/encoding/ready；error提供可读的失败说明，详细阶段诊断留在私有目录。视频任务独立于AI Job，不写入AI生成任务或学习掌握记录。

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
| POST /api/questions/{id}/videos | `{expectedRevision,lessonVersion,partId,pace?:1\|2}`，默认pace=1 | HTTP200 `{video:Video}`，实际写入已批准小问快照并排队；queued不表示已产生MP4 |
| GET /api/videos/{id} | 无；id必须为规范UUID | `{video:Video}`；rendering读取Remotion实际进度，ready才提供下载url；未知或无效id为404 |
| GET /api/videos/{id}/file | 无；只允许ready任务的固定lesson.mp4 | H.264 MP4文件，1280×720；`Cache-Control: private, no-store`，下载名为`lesson-r{questionRevision}-v{lessonVersion}.mp4`；未完成、文件缺失或路径无效为404 |
| POST /api/questions/{id}/ask | `{questionRevision,lessonVersion,partId,stepId,mode,snapshot,text}`；snapshot顶层包含当前小问的x/a/rows；teacher模式另保留暂停帧frame/localFrame/fps/pace与teacherPhase；保留sceneState、stepIndex与reflection | `{id,questionId,questionRevision,lessonVersion,partId,text,answer,status,evidence,createdAt}`，status为checked/needs_review；答疑绑定提交快照，持久保存 |
| GET /api/questions/{id}/asks | 无 | `{items}`，本题已保存追问，保留旧题面版本标记 |
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

## 教师时间线与追问现场

网页Remotion Player与视频渲染复用同一Lesson组合组件及时间线。老师主线可自动演进、暂停和定位；追问先暂停播放器，再取得当前画面的snapshot，避免只用课堂段落起始状态回答正在移动的图形。

| snapshot字段 | 含义 |
|---|---|
| frame | 当前小问全局帧位置，从0开始 |
| localFrame | 当前教学片段内的帧位置，从0开始 |
| fps | 时间线帧率，当前为30 |
| pace | 课堂速度，1为正常、2为两倍速；动画与片段时长使用同一速度 |
| stepIndex | 当前教学片段，沿用0/1/2起的步骤映射 |
| teacherAnimation | 受控教师动画现场为true；探索现场不使用这个标记替代探索条件 |
| teacherPhase | 当前动画阶段；三角形数为growth/example/original，数轴按当前教学动作标识阶段 |
| teachingAction | 三角形数更细的动作，如small-example、original-common、cancel-common、verify、summary |
| x/a/rows | 当前受控数学参数；服务端用题面固定参数及这些现场数值重新计算computedSceneFacts |

三角形数的教师动画和孩子探索使用不同的rows契约：

- `teacherAnimation=true, teacherPhase='growth'`：rows为1至8的整数；服务端提供growth的每行点数与总点数，不提前当作相减比较。
- `teacherAnimation=true, teacherPhase='original'`：rows必须等于scene.params.upper，Q26为24；提供visibleOriginal的新增行23/24、可见47点、共同253点、原题总300点。共同部分用省略块表示，不能把24层解释成探索小例。
- example及普通探索：rows为2至8的整数；提供previewComparison，比较当前小点阵与少两行的点阵，同时另保留原题22/24的originalComparison。小例数值和原题数值分开。

动画snapshot用于还原提问现场；数学结论使用服务端computedSceneFacts，不能把客户端提交的pointCount、距离和或答案标签直接当作计算依据。

## 本机视频导出边界

创建视频必须精确匹配当前题面revision和当前lessonVersion。题面未confirmed或仍缺条件、教案未ready、checks四项未全部为true、小问不属于题面或未被完整覆盖、同一partId出现重复讲义，均不允许导出。版本不符返回409，条件或内容不完整返回422，请求中的任意outputPath及额外字段也返回422。

每次创建只冻结该已批准小问的教学字段，以及题目ID、题面版本、教案版本、小问ID、pace；保存不可变JSON快照及SHA256。数轴的parameterValue/targetSum/targetMinimum与原课堂一致。快照不包含原页图片、孩子笔记、探索草稿、AI密钥或数据库凭据。后续题面修改不会悄悄改写已经创建的视频；历史视频继续显示原版本，不能冒充新版讲解。

导出使用本机Remotion bundler与renderer，固定Lesson组件生成1280×720、30fps的H.264 MP4。当前只有动画、板书和图文讲解，`hasAudio=false`，没有配音。服务器一次渲染一个视频；progress来自真实打包及渲染回调，排队不会用计时器伪造进度。ready须等渲染进程成功、MP4文件存在且输出元数据可读；仅成功创建请求或达到某个进度不能宣称导出完成。

视频及快照保存在本机私有`data/runtime/videos/{uuid}/`，文件接口不能指定任意目录。重启可读取已完成视频并继续queued任务；上次rendering任务标为failed，不将中断输出当成功。失败后重新POST创建新任务，不使用AI Job的retry路由。详细渲染诊断保存在私有renderer-error.json，API只返回安全阶段说明。

视频模块的队列、版本、路径、恢复和HTTP契约工程测试使用明确标注的fake renderer或文件夹具；这些测试通过不等于真实MP4验收。真实验收需要实际调用Remotion、检查媒体信息、播放或抽帧核对教师推理与公式，并单独记录证据。
