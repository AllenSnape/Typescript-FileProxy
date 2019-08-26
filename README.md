# FileProxy 文件代理器

使用方式
```shell script
# 交互模式进入
ts-node FileProxy.ts

# 使用配置文件并进入交互模式
ts-node FileProxy.ts [-so] [配置文件]

# 添加执行脚本 -> 该操作不会重写配置的内容
# -s "shell脚本" -s "shell脚本2"

# 重写配置, 仅限列出的内容
# -o output=... -o dependencyBase=... -o source=...

```
