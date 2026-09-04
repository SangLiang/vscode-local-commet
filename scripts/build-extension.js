/**
 * 使用 esbuild 打包扩展主代码
 * 将 src/extension.ts 及其所有依赖打包成单个 out/extension.js
 */

const esbuild = require('esbuild');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const entryPoint = path.join(projectRoot, 'src', 'extension.ts');
const outfile = path.join(projectRoot, 'out', 'extension.js');

const isWatch = process.argv.includes('--watch');
const isProduction = process.env.NODE_ENV === 'production';

const buildOptions = {
    entryPoints: [entryPoint],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'es2020',
    format: 'cjs',
    external: ['vscode'],
    sourcemap: true,
    minify: isProduction,
    logLevel: 'info',
};

async function main() {
    try {
        if (isWatch) {
            const ctx = await esbuild.context(buildOptions);
            await ctx.watch();
        } else {
            await esbuild.build(buildOptions);
        }
    } catch (error) {
        console.error('esbuild 打包失败:', error);
        process.exit(1);
    }
}

main();
