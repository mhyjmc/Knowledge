# GitHub 上传说明

目标仓库：https://github.com/mhyjmc/Knowledge ，公开可见。项目根目录是本文件上一级，不需要把外层 D:\zhxzzz 目录一起上传。

## 上传内容

- Vue 前端、Fastify 后端、项目脚本、依赖锁文件、部署示例和通用中文开发文档。
- .env.example 与 deploy/.env.production.example 只提供配置字段和示例值，不包含真实密钥。
- 截图使用测试资料和示例账号。

## 仅保留在本机

- .env、deploy/.env.production、本地 PostgreSQL 数据目录、浏览器临时验收数据、node_modules 和构建产物。
- docs/15 到 docs/18 为个人求职材料，包含真实联系方式，不进入公开仓库。

Git 的排除规则在 .gitignore。Docker 的排除规则在 .dockerignore，避免本地配置随构建上下文发送。后续新增密钥时应先确认它没有进入暂存区，再提交。

## 克隆后的启动

按 README 的步骤安装依赖、复制配置示例并启动 PostgreSQL；使用模型问答前在本机 .env 填入模型密钥。项目没有在线演示地址，公开仓库只提供源码与本地运行说明。
