# 构建执行器：脱离会话独立运行完整构建链，完成后写标记文件
$env:WE_PYTHON = 'F:\Program Files\Python3.14\python.exe'
Set-Location D:\code\otherProjects\27_Evaluation
Remove-Item logs\build_done.flag -ErrorAction SilentlyContinue
'' | & '.\scripts\构建打包.bat' *> logs\build_t00630b.log
$LASTEXITCODE | Out-File -Encoding ascii logs\build_exitcode.txt
'DONE' | Out-File -Encoding ascii logs\build_done.flag
