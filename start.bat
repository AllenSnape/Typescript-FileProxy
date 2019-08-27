@echo off

rem 当前目录
SET WORKPLACE=%cd%

rem TS脚本地址
SET GITHUB_FILE_PROXY_TS=https://raw.githubusercontent.com/AllenSnape/Typescript-FileProxy/master/FileProxy.ts
SET GITHUB_FILE_PROXY_PACKAGE_JSON=https://raw.githubusercontent.com/AllenSnape/Typescript-FileProxy/master/package.json
rem 临时文件/文件夹
SET FILE_PROXY_FOLDER=%Temp%\as-typescript-file-proxy
SET FILE_PROXY_TS=%FILE_PROXY_FOLDER%\FileProxy.ts
SET FILE_PROXY_PACKAGE_JSON=%FILE_PROXY_FOLDER%\package.json

mkdir %FILE_PROXY_FOLDER%

rem 检查是否安装了nodejs和ts-node
node --version
IF NOT ERRORLEVEL 0 (
    echo Please install NodeJS first at https://nodejs.org/en/download/
    goto nodejsRequiredHome
)
call npm --version
IF NOT ERRORLEVEL 0 (
    echo Please install NodeJS with NPM; If you did install NodeJS, please check if it installed correctly
    goto nodejsRequiredHome
)
call ts-node --version
IF NOT ERRORLEVEL 0 (
    call npm i -g typescript
    call npm i -g ts-node
)

echo Downloading temporary files
echo Download %GITHUB_FILE_PROXY_TS% -^> %FILE_PROXY_TS%
powershell -command "(new-object System.Net.WebClient).DownloadFile('%GITHUB_FILE_PROXY_TS%', '%FILE_PROXY_TS%')"
echo Download %GITHUB_FILE_PROXY_PACKAGE_JSON% -^> %FILE_PROXY_PACKAGE_JSON%
powershell -command "(new-object System.Net.WebClient).DownloadFile('%GITHUB_FILE_PROXY_PACKAGE_JSON%', '%FILE_PROXY_PACKAGE_JSON%')"

cd %FILE_PROXY_FOLDER%
echo Installing dependencies
call npm i
call ts-node FileProxy.ts -o source %WORKPLACE%\test\sources -o dependenciesBase %WORKPLACE%\test\dependencies %WORKPLACE%\test.config.ts

:nodejsRequiredHome
explorer https://nodejs.org/en/download/
exit 1
