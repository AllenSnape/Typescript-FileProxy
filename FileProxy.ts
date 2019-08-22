import { Stats } from "fs";

const fs = require('fs'), path = require('path'), input = process.stdin;
const exec = require('util').promisify(require('child_process').exec);
const md5 = require('js-md5');

// region 初始化

let config: FileProxyConfig = null;

input.setEncoding('utf-8');

/**
 * 打印使用文档
 */
const printDocument = (): void => {
  console.log();
  console.log('正在使用的配置文件:', config ? (config.name + '@' + config.path) : '无');
  console.log();
  console.log(' 0/init <配置文件>       : 读取配置文件');
  console.log(' 1/re-init [配置文件]    : 重新初始化上次读取的文件; 配置文件存在时则会检查输出目录是否有未正常退出时留下的内容');
  console.log(' 2/push                  : 从生成的文件夹中读取修改了的文件, 并将他们复制到源码中');
  console.log(' 3/pull                  : 刷新依赖文件, 并重新复制到输出目录中');
  console.log(' h/helo                  : 打印该消息');
  console.log(' -/exit                  : 退出');
  console.log('-f/exit-f                : 强制退出');
  console.log();
  console.log('启动后不要移动文件夹!');
  console.log();
};

/**
 * 文件代理器实现类
 */
export class FileProxy implements IFileProxy {

  /**
   * 初始化时的配置
   */
  private config: FileProxyConfig = null;

  /**
   * 源代码与输出文件夹路径对照
   * key: 源代码路径, value: 输出文件夹内的路径
   */
  private readonly _sourcesMapper: FileProxyMapper = {};

  /**
   * 依赖文件与输出文件夹路径对照
   * key、value与{@link FileProxy._sourcesMapper}意思一样
   */
  private readonly _dependenciesMapper: FileProxyMapper = {};

  public async init(config: FileProxyConfig): Promise<this> {
    this.config = config;

    // 处理源码mapper
    FileProxy.map(this._sourcesMapper, config.sources, config.output);

    // 创建输出文件夹
    if (fs.existsSync(config.output)) {
      // 检查是否为一个文件夹, 如果是则抛出错误
      if (!fs.statSync(config.output).isDirectory()) {
        throw new Error('输出目录不是个目录, 请更改输出目录!');
      }
      // 清空文件夹
      FileProxy.rmRf(config.output);
    }
    // 创建文件夹
    fs.mkdirSync(config.output);

    // 拉取依赖
    this.pull();
    // 复制源代码
    FileProxy.copyWithMapper(this._sourcesMapper, true);

    // 执行脚本
    if (config.after) {
      if (typeof config.after === 'string') {
        config.after = [config.after];
      }
      for (const a of config.after) {
        if (a) {
          console.log('>', a);
          const result = await exec(a, { cwd: config.output });
          console.log(result.stdout);
          if (result.stderr) console.error(result.stderr);
        }
      }
    }

    return this;
  }

  /**
   * 读取依赖文件, 因为依赖文件改动性大, 且不应该覆盖源码文件
   */
  private readDependencies(): void {
    // 处理依赖mapper
    FileProxy.map(this._dependenciesMapper, config.dependencies, config.output);

    // 如果依赖中输出的文件有和源码相同的, 则将其删除
    for (const dk in this._dependenciesMapper) {
      for (const sk in this._sourcesMapper) {
        // noinspection JSUnfilteredForInLoop
        if (this._dependenciesMapper[dk] === this._sourcesMapper[sk]) {
          // noinspection JSUnfilteredForInLoop
          delete this._dependenciesMapper[dk];
        }
      }
    }
  }

  public push(): this {
    // 反转复制
    for (const key in this._sourcesMapper) {
      if (this._sourcesMapper.hasOwnProperty(key)) {
        // 放置到输出目录中的路径
        const modified = this._sourcesMapper[key];
        // 检查修改文件是否存在
        if (fs.existsSync(modified)) {
          if (fs.existsSync(key)) {
            // 检查两个文件的md5, 不相同时才复制
            if (md5(fs.readFileSync(modified)) !== md5(fs.readFileSync(key))) {
              console.log('copy', modified, 'to', key);
              fs.unlinkSync(key);
              fs.copyFileSync(modified, key);
            }
          } else {
            // 不存在时直接复制
            fs.copyFileSync(modified, key);
          }
        } else {
          // 不存在则一并删除源文件
          if (fs.existsSync(key)) {
            fs.unlinkSync(key);
          }
        }
      }
    }

    return this;
  }

  public pull(): this {
    this.readDependencies();
    FileProxy.copyWithMapper(this._dependenciesMapper, true, true);
    return this;
  }

  public modified(): boolean {
    let flag = false;
    for (const key in this._sourcesMapper) {
      // noinspection JSUnfilteredForInLoop
      if (
        fs.existsSync(key) && fs.existsSync(this._sourcesMapper[key]) &&
        md5(fs.readFileSync(key)) !== md5(fs.readFileSync(this._sourcesMapper[key]))
      ) {
        // noinspection JSUnfilteredForInLoop
        console.log(key, '@', this._sourcesMapper[key], '文件已被修改, 请push或强制退出!');
        flag = true;
      }
    }
    return flag;
  }

  /**
   * 根据mapper复制到目标文件夹
   * @param mapper mapper配置
   * @param override 如果文件已存在, 是否更改
   * @param readonly 输出的文件是否为只读文件
   */
  private static copyWithMapper(
      mapper: FileProxyMapper,
      override: boolean = false, readonly: boolean = false
  ): void {

    // 开始复制
    for (const key in mapper) {
      if (mapper.hasOwnProperty(key)) {
        // 检查源文件是否存在, 不存在则直接跳过
        if (!fs.existsSync(key)) continue;

        const mapperOutput = mapper[key];
        if (fs.existsSync(mapperOutput)) {
          if (override) {
            fs.unlinkSync(mapperOutput);
          } else {
            continue;
          }
        }

        console.log('copy', key, 'to', mapperOutput);

        // 创建文件夹
        const mapperOutputFolder = mapperOutput.substring(0, mapperOutput.lastIndexOf(path.sep));
        if (!fs.existsSync(mapperOutputFolder)) fs.mkdirSync(mapperOutputFolder, { recursive: true });

        fs.copyFileSync(key, mapperOutput);

        if (readonly) {
          fs.chmodSync(mapperOutput, 0o444);
        }
      }
    }
  }

  /**
   * 解析路径, 并将结果放入mapper
   * @param mapper 放结果的mapper
   * @param files 扫描的文件或文件夹
   * @param output 输出目录
   */
  private static map(mapper: FileProxyMapper, files: (SourceTarget | string)[] | string | SourceTarget, output: string): FileProxyMapper {
    // 清空mapper
    for (const key in mapper) {
      if (mapper.hasOwnProperty(key)) delete mapper[key];
    }

    // 分类处理
    if (!(files instanceof Array)) {
      files = [files];
    }
    files.forEach(file => {
      if (typeof file === 'string') {
        this.getEverything(file).forEach(i => mapper[i] = path.join(output, this.parseFileMap(file, i)));
      } else {
        this.getEverything(file.source).forEach(i => mapper[i] = path.join(output, file.target, this.parseFileMap(file.source, i)));
      }
    });

    return mapper;
  }

  /**
   * 处理mapper出来的内容, 把源文件的地址转换为输出目录的地址
   * @param from 源文件的地址
   * @param to 输出目录的地址
   */
  private static parseFileMap(from: string, to: string): string {
    return to === from ? from.substring(from.lastIndexOf(path.sep) + 1) : to.substring(from.length)
  }

  /**
   * 清空一个文件夹
   * @param folder 文件夹路径
   */
  private static rmRf(folder): void {
    if (fs.existsSync(folder)) {
      if (fs.statSync(folder).isDirectory()) {
        for (const file of fs.readdirSync(folder)) {
          this.rmRf(path.join(folder, file));
        }
        fs.rmdirSync(folder);
      } else {
        fs.unlinkSync(folder);
      }
    }
  }

  /**
   * 读取文件夹下所有的内容 -> 将忽略软链接和快捷方式进行
   * @param file 读取的文件/文件夹
   */
  private static getEverything(file: string): string[] {
    const all = [];
    if (fs.existsSync(file)) {
      const stats: Stats = fs.statSync(file);
      if (stats.isFile()) {
        return [ file ];
      } else {
        for (const subFile of fs.readdirSync(file)) {
          all.push(...this.getEverything(path.join(file, subFile)));
        }
      }
    }
    return all;
  }

  /**
   * 格式化文件格式 -> 替换反斜杠为斜杆, 开头不是绝对路径的, 添加./
   * @param filepath 文件路径
   */
  public static parseFilepath(filepath: string): string {
    filepath = filepath.replace(/\\/gi, '/');
    return /^([a-zA-Z]:\/|\/|\.\/)/.test(filepath) ? filepath : ('./' + filepath);
  }

}

/**
 * 路径映射
 */
export interface FileProxyMapper {
  [key: string]: string;
}

/**
 * 文件代理器向外接口
 */
export interface IFileProxy {

  /**
   * 根据配置文件进行初始化: 检查目标文件夹、生成文件/文件夹mapper
   */
  init: (config: FileProxyConfig) => this | Promise<this>;

  /**
   * 从生成的文件夹中读取修改了的文件, 并将他们复制到源码中
   */
  push: () => this;

  /**
   * 刷新依赖文件, 并重新复制到输出目录中
   */
  pull: () => this;

  /**
   * 复制过去的源码文件是否被修改过
   */
  modified: () => boolean;

}

/**
 * 文件代理器配置
 */
export interface FileProxyConfig {

  /**
   * 项目名称
   */
  name: string;

  /**
   * 文件路径, 将在启动后由程序生成
   */
  path?: string;

  /**
   * 输出的文件夹: 必须是个文件夹, 并且必须是个空文件夹, 因为初始化时会清空该文件夹
   */
  output: string;

  /**
   * 依赖文件, 将以只读的方式复制到输出文件夹
   * 内容可以是一个文件, 也可以是一个文件夹; 为文件夹时, 将会将其子文件和子文件夹一起进行操作
   * 内容不得是软链接或快捷方式, 因为这些可能造成循环依赖, 所以将被直接忽略
   */
  dependencies: (SourceTarget | string)[] | string | SourceTarget;

  /**
   * 源代码目录, 出现与dependencies相同文件时, 将使用该数据将其覆盖
   * 配置的内容如果不存在, 但输出的文件夹中却存在了, 在pull的时候也会将其复制回来
   * 内容规则与{@link FileProxyConfig.dependencies}一致
   */
  sources: (SourceTarget | string)[] | string | SourceTarget;

  /**
   * 生成输出目录之后执行的脚本
   * 如果是多条命令, 默认目录是输出目录文件夹路径, 并且彼此之间无关联, 如果需要多条命令一起执行, 请使用脚本文件
   */
  after?: string | string[];

}

/**
 * 一个来源数据和一个应用至的目标数据
 */
interface SourceTarget {

  /**
   * 来源数据
   */
  source: string;

  /**
   * 应用至的目标数据
   */
  target: string;

}

// endregion

// 实例
const fp: IFileProxy = new FileProxy();
// 开始交互模式
const startInteract = () => {
  input.on('data', data => {
    data = data.toString().substring(0, data.length - (path.sep === '/' ? 1 : 2));
    const args = data.split(' ');
    switch(args[0]) {
      case '0':
      case 'init': {
        if (args.length < 2) {
          console.warn('请添加配置文件!');
        } else {
          init(args[1]);
        }
      }
        break;

      case '1':
      case 're-init': {
        if (args.length === 1 && config === null) {
          console.warn('还没有初始化任何的配置文件!');
        } else if (args.length > 1) {
          init(args[1]);
        } else {
          init(config.path);
        }
      }
        break;

      case '2':
      case 'push': fp.push(); break;

      case '3':
      case 'pull': fp.pull(); break;

      case '-':
      case 'exit': {
        // 检查当前状态后退出
        if (!fp.modified()) {
          process.exit(0);
        }
      }
        break;
      // 强制退出
      case '-f':
      case 'exit-f': process.exit(0); break;

      case 'help':
      case 'h':
      default: printDocument();
    }
    process.stdout.write('> ');
  });

  printDocument();
  process.stdout.write('> ');
};

/**
 * 初始化
 * @param file 初始化的文件
 * @param after 生成输出目录之后执行的脚本
 */
const init = (file: string, after: string | string[] = null): void => {
  file = FileProxy.parseFilepath(file);

  // 如果存在缓存中则清除缓存
  if (require.resolve(file) in require.cache) {
    delete require.cache[require.resolve(file)];
  }

  try {
    config = require(file) as FileProxyConfig;
    config.path = file;
    config.after = config.after ? (typeof config.after === 'string' ? [config.after] : config.after) : [];
    if (after) {
      if (typeof after === 'string') {
        config.after.push(after);
      } else {
        config.after.push(...after);
      }
    }
    (fp.init(config) as Promise<IFileProxy>).then(() => after ? process.exit(0) : undefined).catch(e => console.error(e));
  } catch (e) {
    console.error('初始化失败:', e);
  }
};

// 解析入参

// ts-node FileProxy.ts [默认配置文件] [输出文档生成之后调用的脚本 [脚本2] ...]
if (process.argv.length > 3) {
  init(process.argv[2], process.argv.slice(3));
} else {
  // ts-node FileProxy.ts [默认配置文件]
  if (process.argv.length === 3) {
    init(process.argv[2]);
  }
  startInteract();
}
