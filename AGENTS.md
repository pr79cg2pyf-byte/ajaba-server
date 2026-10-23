

<!-- andy-version-baseline-20261022:start -->
## 开发前版本核对与软件版本号（Boss 2026-10-22）
1. 修改前确认项目、远端、目标分支/发布线；用 `git fetch origin` 获取最新引用，记录本地 HEAD、上游 SHA、领先/落后数量、未提交改动及软件版本号。离线或无法读取远端时明确标为未核实，不宣称最新版。
2. 比较 GitHub、Claude 分支及其他代理交付；按目标发布线和功能差异选择基线，不以文件时间或最后提交日期直接判定最新版。旧原型的测试不能证明新版应用可用。
3. 干净且只落后的同分支副本可以 `git merge --ff-only @{upstream}` 更新；有改动、分叉、其他代理正在写入或不明分支时保留现场，记录差异，不自动 reset/clean/stash、覆盖、强推或切换活动分支。拉取引用不等于工作区已更新。
4. 每个软件必须有明确版本号（优先 SemVer），在清单及用户可见的设置/关于页、CLI 或 API 中可查询；构建另记录 commit/dirty 状态。开发版、原型与正式版明确区分，不把开发版本号称为已发布。
5. 前后端可各自编号；清单、锁文件及构建标识必须一致。交付记录版本、分支、SHA、测试、集成/部署状态；构建完成后再次核对远端与源码变化，变化则重新确认验收范围。
6. 本规则不增加预算、解除 STOP/暂停或授予部署权限。遵守原账本和当前任务授权，不启动无边界更新或代理循环。
Ajaba 当前候选发布线：前端 `ajaba-2.0`（D:/AIProjects/AJ-worktrees/ui-redesign-20261013），后端 `ajaba-2.0`（D:/AIProjects/AJ-worktrees/server-2.0-20261014）；每次开发须现场核实。主 master 与 smart-shelf 原型保留为各自独立副本，禁止混用验收证据。
<!-- andy-version-baseline-20261022:end -->

## Build identity regression (2026-10-24)
Generate commit/dirty metadata during build and expose it through `/api/version`; do not label runtime Git state as the artifact identity. Verify the endpoint plus source-archive unknown/null fallback. Generated metadata is excluded from dirty detection, and development builds with uncommitted source must remain visibly dirty.
