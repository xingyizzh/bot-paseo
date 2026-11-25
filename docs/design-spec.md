# Paseo Bot —— DS-Bot 级视觉与交互设计规范

本规范对齐 [team.zh.png](file:///Users/xingyi/ai/DS-Bot/docs/images/team.zh.png) 与 [details.zh.png](file:///Users/xingyi/ai/DS-Bot/docs/images/details.zh.png) 的克制质感，基于 React Native 原语实现（iOS / Android / Web / Electron 一致）。

## 1. 双主题精确色板

| Token | DS-Bot Light | DS-Bot Dark | 用途 |
|---|---|---|---|
| `background` | `#FFFFFF` | `#111113` | 主画布与页面底 |
| `sidebar` | `#F7F7F8` | `#161619` | 侧栏底色 |
| `raised` | `#F2F2F4` | `#1D1D21` | Hero 卡片、分组卡片、设置卡底 |
| `control` | `#EBECEF` | `#26262B` | 胶囊标签、分段控件、输入底 |
| `border` | `#E6E6EA` | `#2B2B31` | 1px 细分割线与描边 |
| `foreground` | `#111114` | `#F4F4F6` | 主标题与正文 |
| `mutedForeground` | `#6E6E77` | `#8E8E98` | 次要说明、时间戳、简介 |
| `accent` | `#3B66F5` | `#5C83FF` | 强调按钮、激活态、重点标签 |
| `ring` | `#3B66F5` | `#5C83FF` | 焦点框 |
| `sidebarHover` | `#EFEFF2` | `#1F2026` | 侧栏行悬停 |
| `sidebarSelected` | `#E8ECF8` | `#242838` | 侧栏当前选中行 |

## 2. 四大页面空间规范

1. **侧栏 (`bot_sidebar`)**：
   - 顶栏：左侧 `Paseo Bot`（15px 粗体），右侧两个紧凑圆形按钮（收发箱带红/琥珀徽标、`+` 新建 Bot）。
   - 主位 Hero 卡：`borderRadius: 16`，柔和 `raised` 填充 + `1px border`，居中 `48px` 彩色圆形头像（右下角星标徽章）、Bot 名称、浅胶囊角色标签（`总管` / `陪伴`）；双主位（管家 + 陪伴）紧凑并排或上下错层，点击即打开或唤醒绑定 Paseo Agent。
   - 分组与列表：可折叠分组头（箭头 + 组名 + 计数 + 聚合状态点）；Bot 行 `34px` 彩色圆头像 + 1 行粗体名 + 1 行截断简介/状态，右侧单一语义状态点（待拍板 `#D97706` > 运行中 `#16A34A` > 未读 `#3B66F5`）。
   - 底部轻量状态栏：`Inbox · N` / `Outbox · N`，点击直达总控台。
2. **右侧详情抽屉 (`bot_studio` AgentPanel)**：
   - 顶部居中 `56px` 大头像 + 名称 + 角色胶囊 + 分段胶囊 `详情 | 关联线程 | 操作`。
   - `详情`：模型/目录/人设简介与只读统计；`关联线程`：列出派发出的子 Thread 卡片，点击一跳穿透原会话；`操作`：快速打开编辑、派活或新建关联线程。
3. **收发箱总控台 (`inbox_outbox_hub`)**：
   - 居中 `maxWidth: 720`（手机端自适应全宽 `padding: 16`）；顶部双胶囊切换 `Outbox 收口` 与 `Inbox 收件箱`。
   - `Outbox 收口` 严格按 `needs_decision` > `blocked` > `delivered` 排序；每卡带「穿透原线程」按钮与「确认已阅」按钮。
   - `Inbox 收件箱` 顶部单行极速录入（回车直接存盘 `captured`），原话锁定为左侧强调线引用块，每条支持「派发任务」内联展开选择目标 Bot/目录，顶栏提供「导入 Personal HQ」。
4. **时间线轻量事件 (`timeline_polish`)**：
   - 捕获插件工具调用（`inbox_capture` / `bot_dispatch_thread` / `outbox_post`），折叠为居中极淡胶囊提示行，不占聊天气泡视觉权重。
