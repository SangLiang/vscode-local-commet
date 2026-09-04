/**
 * 生产版本打包脚本
 * 生成正式包，并设置日志级别为 error，同时输出各阶段耗时
 */

const { execSync } = require('child_process');
const path = require('path');

function formatDuration(ms) {
    if (ms < 1000) {
        return `${ms}ms`;
    }
    return `${(ms / 1000).toFixed(2)}s`;
}

process.env.NODE_ENV = 'production';

const totalStartTime = Date.now();

console.log('📦 正在打包生产版本');
console.log('   日志级别: error (仅显示错误日志)');

try {
    console.log('   清理旧编译产物...');
    const cleanStart = Date.now();
    execSync(`node scripts/clean-out.js`, {
        stdio: 'inherit',
        cwd: path.join(__dirname, '..')
    });
    console.log(`   ⏱️ 清理耗时: ${formatDuration(Date.now() - cleanStart)}`);

    console.log('   设置日志级别为 error...');
    const logLevelStart = Date.now();
    execSync(`node scripts/set-log-level.js prod`, {
        stdio: 'inherit',
        cwd: path.join(__dirname, '..')
    });
    console.log(`   ⏱️ 设置日志级别耗时: ${formatDuration(Date.now() - logLevelStart)}`);

    console.log('   打包VSIX文件（将自动编译TypeScript）...');
    const packageStart = Date.now();
    execSync(`npx @vscode/vsce package`, {
        stdio: 'inherit',
        cwd: path.join(__dirname, '..')
    });
    console.log(`   ⏱️ vsce package 耗时: ${formatDuration(Date.now() - packageStart)}`);

    console.log('\n✅ 生产版本打包完成');
    console.log(`⏱️ 总耗时: ${formatDuration(Date.now() - totalStartTime)}`);
} catch (error) {
    console.error('\n❌ 打包失败:', error.message);
    console.error(`⏱️ 失败前已耗时: ${formatDuration(Date.now() - totalStartTime)}`);
    process.exit(1);
}
