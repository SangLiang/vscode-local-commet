import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// 读取构建时生成的日志级别配置
let BUILD_LOG_LEVEL: string | undefined;
try {
    // 从 out 目录读取 logger.config.json（编译后的配置文件）
    // 编译后代码在 out/utils/logger.js，需要向上一级到 out 目录
    const configPath = path.join(__dirname, 'logger.config.json');
    if (fs.existsSync(configPath)) {
        const configContent = fs.readFileSync(configPath, 'utf8');
        const config = JSON.parse(configContent);
        BUILD_LOG_LEVEL = config.LOG_LEVEL;
    }
} catch (e) {
    // 如果配置文件不存在或读取失败（开发模式），使用默认值
    BUILD_LOG_LEVEL = undefined;
}

/**
 * 日志级别枚举
 */
export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
    NONE = 4
}

/**
 * 统一日志工具类
 * 日志级别根据构建环境自动设置，无需用户配置
 * - 开发/调试版本：INFO级别（显示详细信息）
 * - 生产版本：ERROR级别（仅显示错误，保护隐私）
 */
export class Logger {
    private static instance: Logger;
    private logLevel: LogLevel;
    private outputChannel: vscode.OutputChannel | null = null;

    private constructor() {
        // 根据环境自动设置日志级别
        this.logLevel = this.determineLogLevel();
    }

    /**
     * 获取Logger单例实例
     */
    public static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    /**
     * 根据构建配置自动确定日志级别
     * 优先级：
     * 1. 构建时生成的配置文件（build:dev -> INFO, build:prod -> ERROR）
     * 2. 环境变量 LOG_LEVEL（开发时可用）
     * 3. 默认 ERROR（生产环境安全默认值）
     */
    private determineLogLevel(): LogLevel {
        // 优先使用构建时生成的配置（最可靠）
        if (BUILD_LOG_LEVEL) {
            switch (BUILD_LOG_LEVEL.toLowerCase()) {
                case 'debug':
                    return LogLevel.DEBUG;
                case 'info':
                    return LogLevel.INFO;
                case 'warn':
                    return LogLevel.WARN;
                case 'error':
                    return LogLevel.ERROR;
                case 'none':
                    return LogLevel.NONE;
            }
        }

        // 开发时回退到环境变量（用于本地开发）
        const logLevelEnv = process.env.LOG_LEVEL?.toLowerCase();
        if (logLevelEnv) {
            switch (logLevelEnv) {
                case 'debug':
                    return LogLevel.DEBUG;
                case 'info':
                    return LogLevel.INFO;
                case 'warn':
                    return LogLevel.WARN;
                case 'error':
                    return LogLevel.ERROR;
                case 'none':
                    return LogLevel.NONE;
            }
        }

        // 默认使用 ERROR 级别（生产环境安全默认值）
        // 这样即使没有设置，发布的生产包也会默认使用 ERROR 级别
        return LogLevel.ERROR;
    }

    /**
     * 获取或创建输出通道
     */
    private getOutputChannel(): vscode.OutputChannel {
        if (!this.outputChannel) {
            this.outputChannel = vscode.window.createOutputChannel('Local Comment');
        }
        return this.outputChannel;
    }

    /**
     * 格式化日志消息
     */
    private formatMessage(level: string, message: unknown, ...args: unknown[]): string {
        const timestamp = new Date().toISOString();
        const formattedMessage = typeof message === 'string' 
            ? message 
            : JSON.stringify(message, null, 2);
        
        if (args.length > 0) {
            const formattedArgs = args.map(arg => 
                typeof arg === 'string' ? arg : JSON.stringify(arg, null, 2)
            ).join(' ');
            return `[${timestamp}] [${level}] ${formattedMessage} ${formattedArgs}`;
        }
        
        return `[${timestamp}] [${level}] ${formattedMessage}`;
    }

    /**
     * 输出日志到控制台和输出通道
     */
    private output(level: LogLevel, levelName: string, message: unknown, ...args: unknown[]): void {
        if (this.logLevel === LogLevel.NONE || level < this.logLevel) {
            return;
        }

        const formattedMessage = this.formatMessage(levelName, message, ...args);
        
        // 输出到VSCode输出通道
        const channel = this.getOutputChannel();
        channel.appendLine(formattedMessage);

        // 根据级别输出到控制台（保持向后兼容）
        switch (level) {
            case LogLevel.DEBUG:
                console.debug(formattedMessage);
                break;
            case LogLevel.INFO:
                console.log(formattedMessage);
                break;
            case LogLevel.WARN:
                console.warn(formattedMessage);
                break;
            case LogLevel.ERROR:
                console.error(formattedMessage);
                break;
        }
    }

    /**
     * 调试日志（最详细）
     */
    public debug(message: unknown, ...args: unknown[]): void {
        this.output(LogLevel.DEBUG, 'DEBUG', message, ...args);
    }

    /**
     * 信息日志（一般信息）
     */
    public info(message: unknown, ...args: unknown[]): void {
        this.output(LogLevel.INFO, 'INFO', message, ...args);
    }

    /**
     * 警告日志
     */
    public warn(message: unknown, ...args: unknown[]): void {
        this.output(LogLevel.WARN, 'WARN', message, ...args);
    }

    /**
     * 错误日志
     */
    public error(message: unknown, ...args: unknown[]): void {
        this.output(LogLevel.ERROR, 'ERROR', message, ...args);
    }

    /**
     * 显示输出通道
     */
    public showOutputChannel(): void {
        if (this.outputChannel) {
            this.outputChannel.show();
        }
    }

    /**
     * 清理资源
     */
    public dispose(): void {
        if (this.outputChannel) {
            this.outputChannel.dispose();
            this.outputChannel = null;
        }
    }
}

/**
 * 导出便捷方法
 */
export const logger = Logger.getInstance();

