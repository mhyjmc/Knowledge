# Docker Desktop 排障

当前检查结果：Docker CLI 已安装，但引擎不能启动。关键输出是 `Docker Desktop is unable to start` 和 `Virtualization Enabled In Firmware: No`。这表示 BIOS/UEFI 没有向 Windows 提供硬件虚拟化；Docker Desktop 的 Linux 容器后端依赖 WSL2/虚拟机。

先重启电脑，出现厂商 Logo 时连续按 `Delete` 或 `F2`（部分设备是 `F10` 或 `Esc`）进入 BIOS/UEFI。在 Advanced、CPU Configuration 或 Security 等菜单启用 Intel `Virtualization Technology`/`VT-x`，或 AMD `SVM Mode`/`AMD-V`。按 `F10` 保存退出。当前系统只报告通用型号 `System Product Name`，无法可靠判断具体菜单名称；不要修改磁盘模式、启动顺序、TPM 等无关设置。

回到 Windows 后，用管理员 PowerShell 执行 `systeminfo | Select-String 'Virtualization Enabled In Firmware|Hyper-V Requirements'`、`wsl --status`、`wsl --update` 和 `wsl --set-default-version 2`。第一条应显示 `Yes`。如果 WSL 功能缺失，执行 `Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux -All -NoRestart` 以及 `Enable-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform -All -NoRestart`，按提示重启。

之后启动 Docker Desktop，等待运行中，再检查 `docker version`、`docker info` 和 `docker context show`。应同时看到 Client 和 Server，context 应为 `desktop-linux`。若服务仍未启动，管理员 PowerShell 执行 `Start-Service com.docker.service`。

Docker 引擎确认正常后，在项目目录执行 `Copy-Item deploy/.env.production.example deploy/.env.production`，编辑部署文件填写随机数据库密码和模型密钥，再运行 `npm run prod:up`。访问 `http://127.0.0.1:8080` 验证登录、资料导入、引用问答和待办确认；结束时运行 `npm run prod:down`。不要使用 `docker compose down -v`，它会删除生产演示数据库卷；密钥不要贴到聊天、提交 Git 或放入前端。

项目 Docker 配置、镜像和 Compose 已通过源码类型检查与构建检查；本机 Docker 引擎尚未通过启动验收，当前阻断是固件虚拟化关闭和终端没有管理员权限。开启 BIOS 虚拟化并重启后，从本文件继续验证即可。
