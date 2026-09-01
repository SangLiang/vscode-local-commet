import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FileHeatData, FileHeatInfo } from './fileHeatManager';

const mockGlobalState = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
}));

const mockContext = vi.hoisted(() => ({
  globalState: mockGlobalState,
}));

const mockWorkspaceState = vi.hoisted(() => ({
  folders: undefined as any,
}));

vi.mock('vscode', () => ({
  workspace: {
    get workspaceFolders() {
      return mockWorkspaceState.folders;
    },
    onDidOpenTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
    onDidSaveTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
    onDidCloseTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
  },
  window: {
    onDidChangeActiveTextEditor: vi.fn(() => ({ dispose: vi.fn() })),
    activeTextEditor: undefined,
  },
  EventEmitter: vi.fn(() => ({
    fire: vi.fn(),
    dispose: vi.fn(),
    event: vi.fn(() => ({ dispose: vi.fn() })),
  })),
}));

vi.mock('../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { FileHeatManager } from './fileHeatManager';

const DAY_MS = 24 * 60 * 60 * 1000;

function makeHeatInfo(filePath: string, lastAccessTime: number, accessCount = 1): FileHeatInfo {
  return { filePath, accessCount, lastAccessTime, totalActiveTime: 0 };
}

describe('FileHeatManager 文件热度管理器测试', () => {
  let manager: FileHeatManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkspaceState.folders = [{
      uri: { fsPath: '/workspace/project' },
      name: 'project',
      index: 0,
    }];
    mockGlobalState.get.mockReturnValue({});
    manager = new FileHeatManager(mockContext as any);
  });

  afterEach(() => {
    manager.dispose();
  });

  describe('cleanupOldData - 清理过期热度数据', () => {
    it('应清理超过 30 天未访问的条目，保留近期条目', () => {
      const now = Date.now();
      (manager as any).heatData = {
        '/recent.ts': makeHeatInfo('/recent.ts', now - 5 * DAY_MS, 3),
        '/old.ts': makeHeatInfo('/old.ts', now - 40 * DAY_MS, 1),
      } as FileHeatData;

      manager.cleanupOldData(30);

      const heatData = (manager as any).heatData as FileHeatData;
      expect(heatData['/recent.ts']).toBeDefined();
      expect(heatData['/old.ts']).toBeUndefined();
      expect(mockGlobalState.update).toHaveBeenCalledTimes(1);
    });

    it('应支持自定义 daysBefore 阈值', () => {
      const now = Date.now();
      (manager as any).heatData = {
        '/a.ts': makeHeatInfo('/a.ts', now - 8 * DAY_MS),
        '/b.ts': makeHeatInfo('/b.ts', now - 3 * DAY_MS),
      } as FileHeatData;

      manager.cleanupOldData(7);

      const heatData = (manager as any).heatData as FileHeatData;
      expect(heatData['/a.ts']).toBeUndefined();
      expect(heatData['/b.ts']).toBeDefined();
    });

    it('没有过期条目时不应调用 saveHeatData', () => {
      const now = Date.now();
      (manager as any).heatData = {
        '/recent.ts': makeHeatInfo('/recent.ts', now, 1),
      } as FileHeatData;

      manager.cleanupOldData(30);

      expect(mockGlobalState.update).not.toHaveBeenCalled();
    });

    it('空 heatData 时不应调用 saveHeatData', () => {
      (manager as any).heatData = {} as FileHeatData;

      manager.cleanupOldData(30);

      expect(mockGlobalState.update).not.toHaveBeenCalled();
    });

    it('删除条目后应调用 saveHeatData 持久化剩余数据', () => {
      const now = Date.now();
      (manager as any).heatData = {
        '/keep.ts': makeHeatInfo('/keep.ts', now - 1 * DAY_MS, 5),
        '/old.ts': makeHeatInfo('/old.ts', now - 60 * DAY_MS, 2),
      } as FileHeatData;

      manager.cleanupOldData(30);

      expect(mockGlobalState.update).toHaveBeenCalledTimes(1);
      const [, value] = mockGlobalState.update.mock.calls[0];
      const persisted = value as FileHeatData;
      expect(persisted['/keep.ts']).toBeDefined();
      expect(persisted['/old.ts']).toBeUndefined();
    });

    it('边界条目（恰好等于阈值）应保留，严格早于阈值才删除', () => {
      const now = Date.now();
      const cutoff = now - 30 * DAY_MS;
      (manager as any).heatData = {
        '/edge.ts': makeHeatInfo('/edge.ts', cutoff, 1),
        '/just-old.ts': makeHeatInfo('/just-old.ts', cutoff - 1, 1),
      } as FileHeatData;

      manager.cleanupOldData(30);

      const heatData = (manager as any).heatData as FileHeatData;
      expect(heatData['/edge.ts']).toBeDefined();
      expect(heatData['/just-old.ts']).toBeUndefined();
    });
  });

  describe('constructor - 启动时接线清理', () => {
    it('构造时应清理 globalState 中过期的条目', () => {
      const now = Date.now();
      const loaded: FileHeatData = {
        '/keep.ts': makeHeatInfo('/keep.ts', now - 1 * DAY_MS, 2),
        '/stale.ts': makeHeatInfo('/stale.ts', now - 90 * DAY_MS, 1),
      };
      mockGlobalState.get.mockReturnValue(loaded);

      const m = new FileHeatManager(mockContext as any);

      const heatData = (m as any).heatData as FileHeatData;
      expect(heatData['/keep.ts']).toBeDefined();
      expect(heatData['/stale.ts']).toBeUndefined();
      expect(mockGlobalState.update).toHaveBeenCalledTimes(1);

      m.dispose();
    });

    it('构造时若无过期条目不应触发额外写盘', () => {
      const now = Date.now();
      const loaded: FileHeatData = {
        '/keep.ts': makeHeatInfo('/keep.ts', now - 1 * DAY_MS, 2),
      };
      mockGlobalState.get.mockReturnValue(loaded);

      const m = new FileHeatManager(mockContext as any);

      expect(mockGlobalState.update).not.toHaveBeenCalled();

      m.dispose();
    });
  });
});
