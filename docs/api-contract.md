# 样卷核心流程 API 契约

日期2026-10-14。生产设计依据为 ../.. /deliverables/math-teacher-design-20261013/12-final-system-design.md。
本阶段单家庭本机版：服务仅监听127.0.0.1；Postgres保存题面、任务、教案、追问与学习事件。真实模型输出才可进入课程，评测金标准与课程生成输入隔离。全部JSON用camelCase，ID为字符串，时间为ISO8601。

## 对象

Question: `{id,paperId,number,revision,state,stem,options:[{label,text}],figureDescription,sourceRegions:[{pageIndex,x,y,width,height}],missingFields:string[],parts:[{id,label,prompt}],lessonState,concepts:string[]}`。
state为extracted/needs_confirmation/needs_completion/confirmed；lessonState为draft/checking/ready/needs_repair/stale或null。区域坐标为旋正页的0..1。

Paper: `{id,title,createdAt,state,pages:[{index,url,width,height}],questionCount,partCount}`。
Coverage: `{questionCount,partCount,confirmedQuestions,readyQuestions,readyParts,blockedParts}`。readyParts只来自当前题面版本的完整核验教学包，不能按按钮或生成请求算。

Job: `{id,paperId,questionId,type,state,stage,completedUnits,totalUnits,error,createdAt}`。state为queued/running/cancel_requested/cancelled/succeeded/failed。type为extract/lesson/lessons。stage独立；error为null或可读说明，禁止泄漏密钥。

TeachingPackage: `{id,questionId,questionRevision,lessonVersion,status,reviewLevel,model,createdAt,coveredPartIds:string[],concepts:string[],parts:LessonPart[],checks:{inputConfirmed:boolean,coverage:boolean,answerVerified:boolean,reasoningReviewed:boolean,issues:string[]}}`。

LessonPart: `{partId,label,goal,known:string[],prerequisites:string[],method,steps:[{id,title,explanation,reason,formulaLatex}],answer:{kind,value,display},verification,misconceptions:[{mistake,correction}],summary,scene:null|{kind:'number-line'|'triangle-count',params:object}}`。
steps不能为空或仅答案，goal/known/method/理由/检验/易错/收束必须齐。answer.kind/value与独立金标准对应，value可为字符串、数值、数组或JSON对象；display只负责显示。scene只接受已实现的两种数学组件，不执行模型代码。图片图注缺失不被答案补齐。

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
| PATCH /api/questions/{id} | `{expectedRevision,stem,options,figureDescription,missingFields,parts,confirm:boolean}` | `{question}`；不符版本409；缺项不能confirmed；修题停止旧结果发布 |
| POST /api/papers/{id}/confirm-all | 无 | `{questions,coverage}`；只确认无missingFields的题 |
| POST /api/questions/{id}/lesson | `{expectedRevision}` | `{job}`；未确认409，缺项422；当前就绪包复用 |
| POST /api/papers/{id}/lessons | 无 | `{job}`；只处理当前已确认完整题；两并发上限 |
| GET /api/questions/{id}/lesson | 无 | `{lesson:TeachingPackage|null}`；过期不得当ready |
| POST /api/questions/{id}/ask | `{questionRevision,lessonVersion,partId,stepId,mode,snapshot,text}` | `{id,questionId,questionRevision,lessonVersion,partId,text,answer,status,evidence,createdAt}`，status为checked/needs_review；答疑绑定提交快照，持久保存 |
| GET /api/jobs/{id} | 无 | `{job}` |
| POST /api/jobs/{id}/cancel | 无 | `{job}`；取消请求与完成分开 |
| GET /api/records | 可选paperId | `{items:LearningEvent[]}` |
| POST /api/events | LearningEvent除id/createdAt | `{event}`；原话与观察分别记录 |
| GET /api/sessions/{questionId} | 无 | `{session:Session|null}` |
| PUT /api/sessions/{questionId} | Session除updatedAt；expectedSessionRevision代替sessionRevision | `{session}`；版本冲突409保留提交草稿 |
| GET /api/papers/{id}/coverage | 无 | `{coverage,questions:[{number,questionId,revision,parts:[{partId,status,issues}]}]}` |

HTTP错误统一`{detail:string}`。前端轮询任务后重新读取当前题面和教案，不能把老响应装回新版本。API密钥不得出现在前端、返回或日志。
