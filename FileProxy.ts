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
  console.info();
  console.info('正在使用的配置文件:', config ? (config.name + ' @ ' + config.path) : '无');
  console.info();
  // console.info(' 0/init <配置文件>       : 读取配置文件');
  // console.info(' 1/re-init [配置文件]    : 重新初始化上次读取的文件');
  console.info(' 2/push                  : 从生成的文件夹中读取修改了的文件, 并将他们复制到源码中');
  console.info(' 3/pull                  : 刷新依赖文件, 并重新复制到输出目录中');
  console.info(' 4/diff                  : 检查是否有修改了的文件');
  console.info(' h/help                  : 打印该消息');
  console.info(' -/exit                  : 退出');
  console.info('-f/exit-f                : 强制退出');
  console.info();
  console.info('启动后不要移动任意关联的文件夹, 或更改源代码文件!');
  console.info();
};

/**
 * 文件代理器实现类
 */
export class FileProxy implements IFileProxy {

  /**
   * 记录变化的锁文件, 避免在异常退出后对文件变化追踪的丢失
   */
  public static readonly LOCKER_FILENAME = '.fileproxy.locker';

  /**
   * 初始化时的配置
   */
  private config: FileProxyConfig = null;

  /**
   * 源代码与输出文件夹路径对照
   * key: 源代码路径, value: 输出文件夹内的路径
   */
  private readonly _sourceMapper: FileProxyMapper = {};

  /**
   * 依赖文件与输出文件夹路径对照
   * key、value与{@link FileProxy._sourceMapper}意思一样
   */
  private readonly _dependenciesMapper: FileProxyMapper = {};

  public async init(config: FileProxyConfig): Promise<this> {
    this.config = config;

    // 添加锁文件的忽略
    this.config.ignores = this.config.ignores instanceof Array ? this.config.ignores : [this.config.ignores];
    this.config.ignores.push(path.join(this.config.output, FileProxy.LOCKER_FILENAME));

    // 检查是否存在锁文件
    const locker = this.unlock();
    if (locker && locker.source && locker.dependencies) {
      // 清空旧mapper
      for (const key of Object.keys(this._sourceMapper)) {
        delete this._sourceMapper[key];
      }
      for (const key of Object.keys(this._dependenciesMapper)) {
        delete this._dependenciesMapper[key];
      }

      // 复制锁文件的mapper到系统中去
      for (const key of Object.keys(locker.source)) {
        this._sourceMapper[key] = locker.source[key];
      }
      for (const key of Object.keys(locker.dependencies)) {
        this._dependenciesMapper[key] = locker.dependencies[key];
      }

      this.modified();
    } else {
      // 处理依赖
      if (this.config.dependencyBase) {
        if (!(this.config.dependencies instanceof Array)) {
          this.config.dependencies = [this.config.dependencies];
        }

        for (let i = 0; i < this.config.dependencies.length; i++) {
          if (typeof this.config.dependencies[i] === 'string') {
            this.config.dependencies[i] = path.join(this.config.dependencyBase, this.config.dependencies[i]);
          } else {
            const dep = this.config.dependencies[i] as SourceTarget;
            dep.source = path.join(this.config.dependencyBase, dep.source);
          }
        }
      }
      // 处理源码mapper
      FileProxy.map(this._sourceMapper, this.config.source, this.config);

      // 检查输出文件夹
      if (fs.existsSync(this.config.output)) {
        // 检查是否为一个文件夹, 如果是则抛出错误
        if (!fs.statSync(this.config.output).isDirectory()) {
          throw new Error('输出目录不是个目录, 请更改输出目录!');
        }
      } else {
        // 创建文件夹
        fs.mkdirSync(this.config.output);
      }

      // 拉取依赖
      this.pull();
      // 复制源代码
      FileProxy.copyWithMapper(this._sourceMapper, this.config);

      // 执行脚本
      if (this.config.after) {
        if (typeof this.config.after === 'string') {
          this.config.after = [this.config.after];
        }
        for (const a of this.config.after) {
          if (a) {
            console.log('>', a);
            const result = await exec(a, { cwd: this.config.output });
            console.log(result.stdout);
            if (result.stderr) console.error(result.stderr);
          }
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
    FileProxy.map(this._dependenciesMapper, config.dependencies, config, true);

    // 如果依赖中输出的文件有和源码相同的, 则将其删除
    for (const sk in this._sourceMapper) {
      for (const dk in this._dependenciesMapper) {
        // noinspection JSUnfilteredForInLoop
        if (this._dependenciesMapper[dk].target === this._sourceMapper[sk].target) {
          // noinspection JSUnfilteredForInLoop
          delete this._dependenciesMapper[dk];
        }
      }
    }
  }

  public push(): this {
    // 获取更改了的内容
    const changes = this.modified();

    // 反转复制
    for (const key in changes) {
      if (changes.hasOwnProperty(key)) {
        // 放置到输出目录中的路径
        const modified = changes[key];
        // 检查修改文件是否存在
        if (modified.deleted !== true) {
          // 存在则删除后复制
          if (fs.existsSync(key)) {
            console.info('copy', modified.target, 'to', key);
            fs.unlinkSync(key);
            fs.copyFileSync(modified.target, key);
          } else {
            // 不存在时直接复制
            console.info('new', key);
            FileProxy.copyFile(modified.target, key);
          }
        } else {
          // 不存在则一并删除源文件
          if (fs.existsSync(key)) {
            console.info('delete', key);
            fs.unlinkSync(key);
          }
        }
      }
    }

    // 刷新源代码mapper
    FileProxy.map(this._sourceMapper, config.source, config);

    return this;
  }

  public pull(): this {
    this.readDependencies();
    FileProxy.copyWithMapper(this._dependenciesMapper, this.config);
    return this;
  }

  public modified(): FileProxyMapper {
    // 是否被修改/新增的文件
    const files = {};

    // 检查是否存在依赖和源代码之外的文件, 如果存在则标记为源代码文件
    const outputs = FileProxy.getEverything(this.config.output, true, this.config.ignores);
    // 合并依赖和源代码mapper
    const exists = Object.assign({}, this._dependenciesMapper, this._sourceMapper);
    const outputMapper: FileProxyMapper = {};
    for (const key in exists) {
      // noinspection JSUnfilteredForInLoop
      outputMapper[exists[key].target] = Object.assign({}, exists[key], { target: key });
    }
    const outputMapperKeys = Object.keys(outputMapper);
    // 找出新文件
    outputs.filter(o => {
      if (!outputMapperKeys.includes(o.target)) {
        let source = '';
        let output = '';
        if (typeof this.config.source === 'string') {
          source = this.config.source;
        } else {
          source = this.config.source.source;
          output = this.config.source.target;
        }
        source = path.join(source, o.target.substring(this.config.output.length + output.length));
        console.info(source, '@', o.target, 'new');
        files[source] = { target: o.target };
      }
    });

    // 检查指定的源文件是否存在修改的内容
    for (const key in this._sourceMapper) {
      if (this._sourceMapper.hasOwnProperty(key)) {
        const value = this._sourceMapper[key];
        // 如果输出目录的源代码文件被删了, 则标记
        if (!fs.existsSync(value.target)) {
          console.info(key, '@', value.target, 'deleted');
          files[key] = Object.assign({}, value, { deleted: true });
        } else if (fs.existsSync(key) && FileProxy.getFileHash(value.target) !== value.hash) {
          console.info(key, '@', value.target, 'changed');
          files[key] = value;
        }
      }
    }
    console.info();

    // 写入锁文件
    this.lock(files);

    return files;
  }

  lock(files: FileProxyMapper): this {
    const lockerFile = this.getLockerFilename();

    // 检查文件有效性
    if (fs.existsSync(lockerFile)) {
      const st = fs.statSync(lockerFile);
      if (!st.isDirectory()) {
        FileProxy.rmRf(lockerFile);
      } else {
        fs.unlinkSync(lockerFile);
      }
    }

    // 存在变化时才写入文件
    if (Object.keys(files).length > 0) {
      // 写入的内容
      const lockerFileContent = {
        source: this._sourceMapper,
        dependencies: this._dependenciesMapper,
        changes: files
      };
      fs.writeFileSync(lockerFile, JSON.stringify(lockerFileContent), { mode: 0o444 });
    }

    return this;
  }

  unlock(): { source: FileProxyMapper; dependencies: FileProxyMapper; changes: FileProxyMapper } | null {
    const lockerFile = this.getLockerFilename();
    if (fs.existsSync(lockerFile)) {
      if (fs.statSync(lockerFile).isFile()) {
        try {
          return JSON.parse(fs.readFileSync(lockerFile));
        } catch (e) {
          console.error('解析锁文件失败:', e);
        }
      } else {
        console.error('锁文件解析失败: 锁文件不是个文件!');
      }
    }
    return null;
  }

  /**
   * 获取锁文件路径
   */
  private getLockerFilename(): string {
    return path.join(this.config.output, FileProxy.LOCKER_FILENAME);
  }

  /**
   * 根据mapper复制到目标文件夹
   * @param mapper mapper配置
   * @param config 配置
   */
  private static copyWithMapper(mapper: FileProxyMapper, config: FileProxyConfig): void {
    // 获取输出目录内容
    const outputs = this.getEverything(config.output, true, config.ignores);

    // 开始复制
    for (const key in mapper) {
      if (mapper.hasOwnProperty(key)) {
        // 源文件不存在则直接跳过
        if (!fs.existsSync(key)) continue;

        // 输出的文件
        const mapperOutput = mapper[key].target;

        // 存在且不为文件时, 直接删除
        if (fs.existsSync(mapperOutput) && !fs.statSync(mapperOutput).isFile()) {
          this.rmRf(mapperOutput);
        }

        // 检查输出文件夹中的文件是否存在
        const exists = outputs.find(o => o.target === mapperOutput);
        if (exists) {
          // 检查hash是否相同, 相同则不复制
          if (exists.hash === mapper[key].hash) {
            continue;
          }
          // 不同则先删除
          else {
            this.rmRf(mapperOutput);
          }
        }

        console.log('copy', key, 'to', mapperOutput);

        // 复制文件
        this.copyFile(key, mapperOutput);

        if (mapper[key].readonly) {
          fs.chmodSync(mapperOutput, 0o444);
        }
      }
    }
  }

  /**
   * 复制文件 -> 自动创建不存在的父文件夹
   * @param src 源文件
   * @param dist 复制的目的地
   */
  private static copyFile(src: string, dist: string): void {
    const folder = dist.substring(0, dist.lastIndexOf(path.sep));
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });

    fs.copyFileSync(src, dist);
  }

  /**
   * 解析路径, 并将结果放入mapper
   * @param mapper 放结果的mapper
   * @param files 扫描的文件或文件夹
   * @param config 配置
   * @param readonly 是否标记为只读文件
   */
  private static map(
      mapper: FileProxyMapper,
      files: (SourceTarget | string)[] | string | SourceTarget,
      config: FileProxyConfig,
      readonly: boolean = false
  ): FileProxyMapper {
    // 清空mapper
    for (const key in mapper) {
      if (mapper.hasOwnProperty(key)) delete mapper[key];
    }

    // 分类处理
    if (!(files instanceof Array)) {
      files = [files];
    }
    files.forEach(file => {
      if (file) {
        let prefix = '';
        if (typeof file !== 'string') {
          prefix = file.target;
          file = file.source;
        }
        this.getEverything(file, readonly, config.ignores).forEach(i => mapper[i.target] = Object.assign({}, i, { target: path.join(config.output, prefix, this.parseFileMap(file as string, i.target)) }));
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
   * @param readonly 扫描出来的文件是否标记为只读
   * @param ignores 忽略的内容
   */
  private static getEverything(file: string, readonly: boolean = false, ignores: ignoreType | ignoreType[] = []): FileProxyFile[] {
    const all = [];

    if (ignores) {
      if (!(ignores instanceof Array)) {
        ignores = [ ignores ];
      }
      for (const i of ignores) {
        if (
            (typeof i === 'string' && file === i) ||
            (i instanceof RegExp && i.test(file)) ||
            (typeof i !== 'string' && 'startsWith' in (i as any) && file.startsWith((i as ignoreStartsWith).startsWith)) ||
            (typeof i !== 'string' && 'endsWith' in (i as any) && file.startsWith((i as ignoreEndsWith).endsWith))
        ) {
          return all;
        }
      }
    }

    if (fs.existsSync(file)) {
      const stats: Stats = fs.statSync(file);
      if (stats.isFile()) {
        return [ { hash: FileProxy.getFileHash(file), target: file, readonly } ];
      } else if (stats.isDirectory()) {
        for (const subFile of fs.readdirSync(file)) {
          all.push(...this.getEverything(path.join(file, subFile), readonly, ignores));
        }
      } else {
        console.warn('不支持的路径类型:', file);
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

  /**
   * 获取文件hash值
   * @param file 文件路径
   */
  public static getFileHash(file: string): string | null {
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      return md5(fs.readFileSync(file));
    }
    return null;
  }

}

/**
 * 路径映射
 */
export interface FileProxyMapper {
  [key: string]: FileProxyFile;
}

/**
 * 文件代理器向外接口
 */
export interface IFileProxy {

  /**
   * 根据配置文件进行初始化: 检查目标文件夹、生成文件/文件夹mapper
   */
  init(config: FileProxyConfig): Promise<this>;

  /**
   * 从生成的文件夹中读取修改了的文件, 并将他们复制到源码中
   */
  push(): this;

  /**
   * 刷新依赖文件, 并重新复制到输出目录中
   */
  pull(): this;

  /**
   * 复制过去的源码文件是否被修改过
   * @return 被修改了或新增的文件
   */
  modified(): FileProxyMapper;

  /**
   * 写入变化内容的锁文件
   * @param files 文件的变化内容
   */
  lock(files: FileProxyMapper): this;

  /**
   * 读取文件内容
   */
  unlock(): { source: FileProxyMapper, dependencies: FileProxyMapper, changes: FileProxyMapper } | null;

}

/**
 * 忽略的类型, 字符串是直接去匹配, startsWith用的{@link String.startsWith}, endsWith{@link String.endsWith}, RegExp不用说了
 */
type ignoreStartsWith = { startsWith: string };
type ignoreEndsWith = { endsWith: string };
type ignoreType = ignoreStartsWith | ignoreEndsWith | string | RegExp;

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
   * 依赖文件的基础内容, 存在时则会拼接到每个dependencies对应的路径前面
   */
  dependencyBase?: string;

  /**
   * 源代码目录, 出现与dependencies相同文件时, 将使用该数据将其覆盖
   * 配置的内容如果不存在, 但输出的文件夹中却存在了, 在pull的时候也会将其复制回来
   */
  source: string | SourceTarget;

  /**
   * 生成输出目录之后执行的脚本
   * 如果是多条命令, 默认目录是输出目录文件夹路径, 并且彼此之间无关联, 如果需要多条命令一起执行, 请使用脚本文件
   */
  after?: string | string[];

  /**
   * 忽略的目录 -> 在任何时候都会进行忽略的
   */
  ignores?: ignoreType | ignoreType[];

}

/**
 * 文件代理器中的文件信息
 */
export interface FileProxyFile {

  /**
   * 当前文件的hash值
   */
  hash: string;

  /**
   * 对应的目标路径
   */
  target: string;

  /**
   * 是否为只读文件
   */
  readonly?: boolean;

  /**
   * 是否标记为删除了
   */
  deleted?: boolean;

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
  input.on('data', async (data: any) => {
    data = data.toString().substring(0, data.length - (path.sep === '/' ? 1 : 2));
    const args = data.split(' ');
    switch(args[0]) {
      /*case '0':
      case 'init': {
        if (args.length < 2) {
          console.warn('请添加配置文件!');
        } else {
          await init(args[1]);
        }
      } break;*/

      /*case '1':
      case 're-init': {
        if (config && Object.keys(fp.modified()).length !== 0) {
          console.warn('当前存在未提交代码!');
        } else if (args.length === 1 && config === null) {
          console.warn('还没有初始化任何的配置文件!');
        } else if (args.length > 1) {
          init(args[1]);
        } else {
          init(config.path);
        }
      } break;*/

      case '2':
      case 'push': if (config) {
        fp.push();
      } else {
        console.warn('请先初始化!');
      } break;

      case '3':
      case 'pull': if (config) {
        fp.pull();
      } else {
        console.warn('请先初始化!');
      } break;

      case '4':
      case 'diff': if (config) {
        fp.modified();
      } else {
        console.warn('请先初始化!');
      } break;

      case '-':
      case 'exit': {
        // 检查当前状态后退出
        if (config && Object.keys(fp.modified()).length === 0) {
          process.exit(0);
        }
      } break;

      // 强制退出
      case '-f':
      case 'exit-f': process.exit(0); break;

      // 帮助
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
 * @param overrides 重写配置文件的内容
 */
const init = async (file: string, after: string | string[] = null, overrides: any = {}): Promise<void> => {
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
    config = Object.assign(config, overrides);
    await fp.init(config);
    if (after) {
      process.exit(0)
    }
  } catch (e) {
    console.error('初始化失败:', e);
  }
};

// 解析入参

// 额外的脚本
const extraShells = [];
// 需要被覆盖的内容
const overrides = {};
// 配置文件
let configFile = null;

if (process.argv.length === 2) {
  // do nothing
} else if (process.argv.length === 3) {
  configFile = process.argv[2];
} else {
  for (let i = 0; i < process.argv.length - 1; i++) {
    if (process.argv[i].startsWith('-')) {
      switch (process.argv[i]) {
        case '-s': extraShells.push(process.argv[++i]); continue;
        case '-o': {
          const override = process.argv[++i].split('=');
          overrides[override[0]] = override[1];
        } continue;
        default: console.warn('不支持的命令', process.argv[i]);
      }
    }
  }
  configFile = process.argv[process.argv.length - 1];
}

init(configFile, extraShells.length > 0 ? extraShells : null, overrides).then(() => {
  if (extraShells.length === 0) {
    startInteract();
  }
});
