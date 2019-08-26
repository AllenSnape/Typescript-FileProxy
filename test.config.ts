import {FileProxyConfig} from "./FileProxy";

const config: FileProxyConfig = {
    name: '测试配置',
    output: 'C:\\Users\\as\\Desktop\\FileProxy\\test\\output',
    source: 'C:\\Users\\as\\Desktop\\FileProxy\\test\\sources',
    dependencies: [
        'test\\dependencies',
        { source: 'node_modules\\js-md5\\build', target: 'build' }
    ],
    dependencyBase: 'C:\\Users\\as\\Desktop\\FileProxy\\',
    ignores: 'C:\\Users\\as\\Desktop\\FileProxy\\test\\dependencies\\newDep.txt'
};

module.exports = config;
