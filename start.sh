# 当前目录
WORKPLACE=$(pwd)

# TS脚本地址
GITHUB_FILE_PROXY_TS="https://raw.githubusercontent.com/AllenSnape/Typescript-FileProxy/master/FileProxy.ts"
GITHUB_FILE_PROXY_PACKAGE_JSON="https://raw.githubusercontent.com/AllenSnape/Typescript-FileProxy/master/package.json"
# 临时文件/文件夹
FILE_PROXY_FOLDER="/tmp/as-typescript-file-proxy"
FILE_PROXY_TS="$FILE_PROXY_FOLDER/FileProxy.ts"
FILE_PROXY_PACKAGE_JSON="$FILE_PROXY_FOLDER/package.json"

mkdir -p $FILE_PROXY_FOLDER

# 检查是否安装了nodejs和ts-node
node --version
if [ $? -ne 0 ]; then
  echo "Please install NodeJS first at https://nodejs.org/en/download/"
  exit 1
fi
npm --version
if [ $? -ne 0 ]; then
  echo "Please install NodeJS with NPM; If you did install NodeJS, please check if it installed correctly"
  exit 1
fi
ts-node --version
if [ $? -ne 0 ]; then
  npm i -g typescript
  npm i -g ts-node
fi

echo "Downloading temporary files"
echo "Download $GITHUB_FILE_PROXY_TS -> $FILE_PROXY_TS"
curl $GITHUB_FILE_PROXY_TS -o $FILE_PROXY_TS
echo "Download $GITHUB_FILE_PROXY_PACKAGE_JSON -> $FILE_PROXY_PACKAGE_JSON"
curl $GITHUB_FILE_PROXY_PACKAGE_JSON -o $FILE_PROXY_PACKAGE_JSON

cd $FILE_PROXY_FOLDER
echo "Installing dependencies"
npm i
ts-node FileProxy.ts -o source="$WORKPLACE\test\sources" -o dependenciesBase="$WORKPLACE\test\dependencies" "$WORKPLACE\test.config.ts"
