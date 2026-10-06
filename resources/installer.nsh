; NSIS 安装向导定制
;
; electron-builder 会把本文件 include 进它生成的安装脚本，
; 可用钩子就是 app-builder-lib/templates/nsis/*.nsh 里用 !ifmacrodef 判断的那些宏：
;   customWelcomePage / customFinishPage / customHeader / customInit / customInstall
;   customUnInstall / customUnWelcomePage / customPageAfterChangeDir ...
;
; 注意两点：
; 1. 顶部横幅、左侧大图、安装器图标走 electron-builder.yml 的
;    installerHeader / installerSidebar / installerIcon —— 那些 define 必须在
;    插入页面之前生效，只有走配置才放得对位置。
; 2. 文案里的换行必须写字面量 $\r$\n，不能直接敲回车，
;    否则 makensis 报 "unterminated string parsing line"。

; ---------- 欢迎页 ----------
; assisted 安装器的模板默认**没有**欢迎页，定义这个宏等于插入一页。
!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "欢迎安装 Teas Music Player"
  !define MUI_WELCOMEPAGE_TEXT "Teas Music Player 是一个开源的$\r$\n网易云音乐桌面客户端。$\r$\n$\r$\n接下来向导会带你完成：$\r$\n· 阅读并同意许可协议$\r$\n· 选择安装位置$\r$\n· 复制文件并创建快捷方式$\r$\n$\r$\n点击「下一步」继续。"
  !insertmacro MUI_PAGE_WELCOME
!macroend

; ---------- 完成页 ----------
; 定义 customFinishPage 后，模板里默认那套"完成后运行"的实现会被整段跳过，
; 所以必须自己照抄一份 StartApp，否则会丢掉「运行 Teas Music Player」勾选框。
!macro customFinishPage
  Function StartApp
    ${if} ${isUpdated}
      StrCpy $1 "--updated"
    ${else}
      StrCpy $1 ""
    ${endif}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd

  !define MUI_FINISHPAGE_TITLE "Teas Music Player 安装完成"
  !define MUI_FINISHPAGE_TEXT "Teas Music Player 已安装到你的电脑上。$\r$\n$\r$\n点击「完成」关闭安装向导。"
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !define MUI_FINISHPAGE_RUN_TEXT "运行 Teas Music Player"
  !insertmacro MUI_PAGE_FINISH
!macroend

; ---------- 卸载欢迎页 ----------
!macro customUnWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "卸载 Teas Music Player"
  !define MUI_WELCOMEPAGE_TEXT "向导将从你的电脑上卸载 Teas Music Player。$\r$\n$\r$\n你的登录信息、设置与本地曲库保存在用户数据目录中，卸载不会删除它们。$\r$\n$\r$\n点击「下一步」继续。"
  !insertmacro MUI_UNPAGE_WELCOME
!macroend
