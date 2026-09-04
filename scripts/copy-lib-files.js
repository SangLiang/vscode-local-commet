/**
 * 复制库文件脚本
 * 从 node_modules 复制 marked、mermaid 和 katex 的浏览器版本到 out/lib 目录
 * 这些文件会在打包时被包含到 vsix 中
 */

const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const nodeModulesPath = path.join(projectRoot, 'node_modules');
const outLibPath = path.join(projectRoot, 'out', 'lib');

// 确保 out/lib 目录存在
if (!fs.existsSync(outLibPath)) {
    fs.mkdirSync(outLibPath, { recursive: true });
}

/**
 * 查找文件，尝试多个可能的路径
 */
function findFile(possiblePaths, packageName) {
    for (const filePath of possiblePaths) {
        if (fs.existsSync(filePath)) {
            return filePath;
        }
    }
    return null;
}

// 需要复制的文件配置
const filesToCopy = [
    {
        packageName: 'cytoscape',
        possiblePaths: [
            path.join(nodeModulesPath, 'cytoscape', 'dist', 'cytoscape.min.js'),
            path.join(nodeModulesPath, 'cytoscape', 'cytoscape.min.js')
        ],
        target: path.join(outLibPath, 'cytoscape.min.js')
    },
    {
        packageName: 'marked',
        possiblePaths: [
            path.join(nodeModulesPath, 'marked', 'marked.min.js'),
            path.join(nodeModulesPath, 'marked', 'marked.esm.min.js')
        ],
        target: path.join(outLibPath, 'marked.min.js')
    },
    {
        packageName: 'mermaid',
        possiblePaths: [
            path.join(nodeModulesPath, 'mermaid', 'dist', 'mermaid.min.js'),
            path.join(nodeModulesPath, 'mermaid', 'mermaid.min.js'),
            path.join(nodeModulesPath, '@mermaid-js', 'mermaid', 'dist', 'mermaid.min.js')
        ],
        target: path.join(outLibPath, 'mermaid.min.js')
    },
    {
        packageName: 'katex',
        possiblePaths: [
            path.join(nodeModulesPath, 'katex', 'dist', 'katex.min.js'),
            path.join(nodeModulesPath, 'katex', 'katex.min.js')
        ],
        target: path.join(outLibPath, 'katex.min.js')
    },
    {
        packageName: 'katex-css',
        possiblePaths: [
            path.join(nodeModulesPath, 'katex', 'dist', 'katex.min.css'),
            path.join(nodeModulesPath, 'katex', 'katex.min.css')
        ],
        target: path.join(outLibPath, 'katex.min.css')
    },
    {
        packageName: 'highlight.js',
        possiblePaths: [
            path.join(nodeModulesPath, '@highlightjs', 'cdn-assets', 'highlight.min.js'),
            path.join(nodeModulesPath, '@highlightjs', 'cdn-assets', 'build', 'highlight.min.js'),
            path.join(nodeModulesPath, 'highlight.js', 'lib', 'highlight.min.js'),
            path.join(nodeModulesPath, 'highlight.js', 'highlight.min.js')
        ],
        target: path.join(outLibPath, 'highlight.min.js')
    },
    // 复制多个 highlight.js 主题文件
    {
        packageName: 'highlight.js-css-github-dark',
        possiblePaths: [
            path.join(nodeModulesPath, '@highlightjs', 'cdn-assets', 'styles', 'github-dark.min.css'),
            path.join(nodeModulesPath, '@highlightjs', 'cdn-assets', 'build', 'styles', 'github-dark.min.css'),
            path.join(nodeModulesPath, 'highlight.js', 'styles', 'github-dark.min.css'),
            path.join(nodeModulesPath, 'highlight.js', 'styles', 'github-dark.css')
        ],
        target: path.join(outLibPath, 'github-dark.min.css')
    },
    {
        packageName: 'highlight.js-css-github',
        possiblePaths: [
            path.join(nodeModulesPath, '@highlightjs', 'cdn-assets', 'styles', 'github.min.css'),
            path.join(nodeModulesPath, '@highlightjs', 'cdn-assets', 'build', 'styles', 'github.min.css'),
            path.join(nodeModulesPath, 'highlight.js', 'styles', 'github.min.css'),
            path.join(nodeModulesPath, 'highlight.js', 'styles', 'github.css')
        ],
        target: path.join(outLibPath, 'github.min.css')
    },
    {
        packageName: 'highlight.js-css-vs2015',
        possiblePaths: [
            path.join(nodeModulesPath, '@highlightjs', 'cdn-assets', 'styles', 'vs2015.min.css'),
            path.join(nodeModulesPath, '@highlightjs', 'cdn-assets', 'build', 'styles', 'vs2015.min.css'),
            path.join(nodeModulesPath, 'highlight.js', 'styles', 'vs2015.min.css'),
            path.join(nodeModulesPath, 'highlight.js', 'styles', 'vs2015.css')
        ],
        target: path.join(outLibPath, 'vs2015.min.css')
    },
    {
        packageName: 'highlight.js-css-vs',
        possiblePaths: [
            path.join(nodeModulesPath, '@highlightjs', 'cdn-assets', 'styles', 'vs.min.css'),
            path.join(nodeModulesPath, '@highlightjs', 'cdn-assets', 'build', 'styles', 'vs.min.css'),
            path.join(nodeModulesPath, 'highlight.js', 'styles', 'vs.min.css'),
            path.join(nodeModulesPath, 'highlight.js', 'styles', 'vs.css')
        ],
        target: path.join(outLibPath, 'vs.min.css')
    },
    {
        packageName: 'highlight.js-css-monokai',
        possiblePaths: [
            path.join(nodeModulesPath, '@highlightjs', 'cdn-assets', 'styles', 'monokai.min.css'),
            path.join(nodeModulesPath, '@highlightjs', 'cdn-assets', 'build', 'styles', 'monokai.min.css'),
            path.join(nodeModulesPath, 'highlight.js', 'styles', 'monokai.min.css'),
            path.join(nodeModulesPath, 'highlight.js', 'styles', 'monokai.css')
        ],
        target: path.join(outLibPath, 'monokai.min.css')
    },
    {
        packageName: 'highlight.js-css-atom-one-dark',
        possiblePaths: [
            path.join(nodeModulesPath, '@highlightjs', 'cdn-assets', 'styles', 'atom-one-dark.min.css'),
            path.join(nodeModulesPath, '@highlightjs', 'cdn-assets', 'build', 'styles', 'atom-one-dark.min.css'),
            path.join(nodeModulesPath, 'highlight.js', 'styles', 'atom-one-dark.min.css'),
            path.join(nodeModulesPath, 'highlight.js', 'styles', 'atom-one-dark.css')
        ],
        target: path.join(outLibPath, 'atom-one-dark.min.css')
    },
    {
        packageName: 'highlight.js-css-atom-one-light',
        possiblePaths: [
            path.join(nodeModulesPath, '@highlightjs', 'cdn-assets', 'styles', 'atom-one-light.min.css'),
            path.join(nodeModulesPath, '@highlightjs', 'cdn-assets', 'build', 'styles', 'atom-one-light.min.css'),
            path.join(nodeModulesPath, 'highlight.js', 'styles', 'atom-one-light.min.css'),
            path.join(nodeModulesPath, 'highlight.js', 'styles', 'atom-one-light.css')
        ],
        target: path.join(outLibPath, 'atom-one-light.min.css')
    },
    // 保留默认的 highlight.min.css 作为回退（使用 github-dark）
    {
        packageName: 'highlight.js-css-default',
        possiblePaths: [
            path.join(nodeModulesPath, '@highlightjs', 'cdn-assets', 'styles', 'github-dark.min.css'),
            path.join(nodeModulesPath, '@highlightjs', 'cdn-assets', 'build', 'styles', 'github-dark.min.css'),
            path.join(nodeModulesPath, 'highlight.js', 'styles', 'github-dark.min.css'),
            path.join(nodeModulesPath, 'highlight.js', 'styles', 'github-dark.css')
        ],
        target: path.join(outLibPath, 'highlight.min.css')
    }
];

const startTime = Date.now();

function formatDuration(ms) {
    if (ms < 1000) {
        return `${ms}ms`;
    }
    return `${(ms / 1000).toFixed(2)}s`;
}

console.log('开始复制库文件到 out/lib...');

let copiedCount = 0;
let failedCount = 0;

filesToCopy.forEach(({ packageName, possiblePaths, target }) => {
    const sourceFile = findFile(possiblePaths, packageName);
    
    if (!sourceFile) {
        console.error(`  错误: 找不到 ${packageName} 文件`);
        console.error(`   尝试的路径:`);
        possiblePaths.forEach(p => {
            console.error(`     - ${path.relative(projectRoot, p)}`);
        });
        failedCount++;
        return;
    }
    
    try {
        // 复制文件
        fs.copyFileSync(sourceFile, target);
        const stats = fs.statSync(target);
        const sizeKB = (stats.size / 1024).toFixed(2);
        console.log(`  已复制 ${packageName}: ${path.relative(projectRoot, target)} (${sizeKB} KB)`);
        console.log(`   来源: ${path.relative(projectRoot, sourceFile)}`);
        copiedCount++;
    } catch (error) {
        console.error(` 复制 ${packageName} 失败:`, error.message);
        failedCount++;
    }
});

if (failedCount === 0) {
    console.log(`\n 成功复制 ${copiedCount} 个文件到 out/lib 目录`);
} else {
    console.error(`\n 复制完成，但有 ${failedCount} 个文件失败`);
    console.error('请确保已运行 npm install 安装依赖');
    process.exit(1);
}

/**
 * 复制整个目录到目标位置
 */
function copyDirectory(sourceDir, targetDir) {
    if (!fs.existsSync(sourceDir)) {
        console.error(`  错误: 找不到目录 ${path.relative(projectRoot, sourceDir)}`);
        return 0;
    }

    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }

    let count = 0;
    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
        const src = path.join(sourceDir, entry.name);
        const dest = path.join(targetDir, entry.name);
        if (entry.isDirectory()) {
            count += copyDirectory(src, dest);
        } else {
            fs.copyFileSync(src, dest);
            count++;
        }
    }
    return count;
}

const directoriesToCopy = [
    {
        packageName: 'katex-fonts',
        source: path.join(nodeModulesPath, 'katex', 'dist', 'fonts'),
        target: path.join(outLibPath, 'fonts')
    }
];

console.log('\n开始复制字体目录到 out/lib/fonts...');

let dirCopiedCount = 0;
let dirFailedCount = 0;

directoriesToCopy.forEach(({ packageName, source, target }) => {
    try {
        const count = copyDirectory(source, target);
        if (count > 0) {
            console.log(`  已复制 ${packageName}: ${path.relative(projectRoot, target)} (${count} 个文件)`);
            dirCopiedCount++;
        } else {
            dirFailedCount++;
        }
    } catch (error) {
        console.error(` 复制 ${packageName} 失败:`, error.message);
        dirFailedCount++;
    }
});

if (dirFailedCount === 0) {
    console.log(`\n 成功复制 ${dirCopiedCount} 个目录到 out/lib 目录`);
} else {
    console.error(`\n 目录复制完成，但有 ${dirFailedCount} 个目录失败`);
    console.error('请确保已运行 npm install 安装依赖');
    process.exit(1);
}

console.log(`\n⏱️ copy-lib 总耗时: ${formatDuration(Date.now() - startTime)}`);

