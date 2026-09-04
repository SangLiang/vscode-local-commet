/**
 * 清理 out 目录
 * 用于在打包前确保没有旧编译产物
 */

const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname, '../out');

if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true, force: true });
    console.log('✅ 已清理 out/ 目录');
} else {
    console.log('ℹ️ out/ 目录不存在，无需清理');
}
