# ASTRYN 仓库执行规则

默认中文。写入前读取 AUTHORITY.md、PROJECT_CONTRACT.yaml、docs/current/STATUS.md，并检查实际文件与 Git 状态。当前用户指令优先于归档任务；归档不等于启动授权。

## 范围与数据
- 默认只写 D:\All projects\ASTRYN。其他目录是引用，不因位于 workspace roots 就自动授权操作。
- AAOS 仅在具体任务授权时只读；正式源码修改必须另有集成授权。
- E:、F: 禁止未经 exact path + exact operation 授权访问。
- 不读取凭据、私人会话；不提交密钥、模型权重、用户资料、个人对话和运行数据库。
- 本地产物放 .project-local/runs 与 .project-local/artifacts，不作为正式证据自动提交。

## 架构
- ASTRYN 拥有人格、陪伴互动、角色表达和呈现。
- AAOS 拥有通用模型、记忆、上下文、任务、权限和权威写入。
- 通过有类型、版本、权限的 Host Adapter 接入；禁止直接写 AAOS SQLite/CAS。
- Dev Host 是开发工具；不建立第二套正式前端或长期记忆主库。
- 系统任务状态只来自权威事件；合成数据与真实集成明确区分。

## 修改与验收
- 保护已有 dirty/untracked 文件；一个 checkout 同时只有一个 writer。
- 不自动 git init、reset、clean、强推、发布或安装；commit/push/merge 分别判断授权。
- 按 manifest、现行合同与 CI 发现测试入口；当前尚无测试命令，不虚构 PASS。
- 收尾检查 diff/status/范围，报告 PASS/PARTIAL/BLOCKED/NOT_EXECUTED/UNVERIFIED。
- 证据区分 NO_EVIDENCE/SYNTHETIC/INTEGRATED/REAL；构建不等于运行，测试不等于宿主集成。
