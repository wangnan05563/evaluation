// 工作量评估工具桌面壳 preload：保持与 BempDiff 壳一致的隔离模型。
// 当前前端（frontend/index.html）直连 HTTP API，无需 Node/IPC 能力；
// 仅暴露一个受控的版本探测口，后续如需文件对话框等能力在此按需扩展。
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('weval', {
  desktop: true,
  version: process.versions.electron || ''
})
