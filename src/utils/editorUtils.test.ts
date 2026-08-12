import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockTabGroupsAll: { viewColumn: number }[] = [];
const mockExecuteCommand = vi.fn();
let mockActiveTabGroup: { viewColumn: number } = { viewColumn: 1 };
let mockPanelViewColumn: number | undefined = 1;

vi.mock('vscode', () => ({
  ViewColumn: {
    Active: -1,
    Beside: -2,
    One: 1,
    Two: 2,
    Three: 3,
  },
  window: {
    tabGroups: {
      get all() {
        return mockTabGroupsAll;
      },
      get activeTabGroup() {
        return mockActiveTabGroup;
      },
    },
    showTextDocument: vi.fn(),
  },
  commands: {
    executeCommand: (...args: unknown[]) => mockExecuteCommand(...args),
  },
}));

import * as vscode from 'vscode';
import { EditorUtils } from './editorUtils';

function createMockPanel(viewColumn: number | undefined): vscode.WebviewPanel {
  return {
    viewColumn,
  webview: {} as vscode.Webview,
    title: '',
    iconPath: undefined,
    options: {},
    active: true,
    visible: true,
    onDidDispose: vi.fn(),
    onDidChangeViewState: vi.fn(),
    reveal: vi.fn(),
    dispose: vi.fn(),
  } as unknown as vscode.WebviewPanel;
}

describe('EditorUtils.smartSelectViewColumn', () => {
  beforeEach(() => {
    mockTabGroupsAll.length = 0;
    mockActiveTabGroup = { viewColumn: vscode.ViewColumn.One };
    mockExecuteCommand.mockReset();
  });

  it('无活动编辑器时返回 One', () => {
    expect(EditorUtils.smartSelectViewColumn(undefined)).toBe(vscode.ViewColumn.One);
  });

  it('仅有一列时返回 Beside 以侧开第二列', () => {
    mockTabGroupsAll.push(mockActiveTabGroup);
    const editor = { viewColumn: vscode.ViewColumn.One } as vscode.TextEditor;
    expect(EditorUtils.smartSelectViewColumn(editor)).toBe(vscode.ViewColumn.Beside);
  });

  it('已有两列且在左侧时返回右侧列', () => {
    const left = { viewColumn: vscode.ViewColumn.One };
    const right = { viewColumn: vscode.ViewColumn.Two };
    mockTabGroupsAll.push(left, right);
    mockActiveTabGroup = left;
    const editor = { viewColumn: vscode.ViewColumn.One } as vscode.TextEditor;
    expect(EditorUtils.smartSelectViewColumn(editor)).toBe(vscode.ViewColumn.Two);
  });

  it('已有两列且在右侧时返回左侧列', () => {
    const left = { viewColumn: vscode.ViewColumn.One };
    const right = { viewColumn: vscode.ViewColumn.Two };
    mockTabGroupsAll.push(left, right);
    mockActiveTabGroup = right;
    const editor = { viewColumn: vscode.ViewColumn.Two } as vscode.TextEditor;
    expect(EditorUtils.smartSelectViewColumn(editor)).toBe(vscode.ViewColumn.One);
  });

  it('仅有一列且 viewColumn 缺失时仍返回 Beside', () => {
    mockTabGroupsAll.push(mockActiveTabGroup);
    const editor = { viewColumn: undefined } as unknown as vscode.TextEditor;
    expect(EditorUtils.smartSelectViewColumn(editor)).toBe(vscode.ViewColumn.Beside);
  });
});

describe('EditorUtils.ensureWebviewBesideSource', () => {
  beforeEach(() => {
    mockTabGroupsAll.length = 0;
    mockActiveTabGroup = { viewColumn: vscode.ViewColumn.One };
    mockExecuteCommand.mockReset();
    mockExecuteCommand.mockResolvedValue(undefined);
    mockPanelViewColumn = undefined;
  });

  it('仍在单一编辑器组时强制移到右侧新组', async () => {
    mockTabGroupsAll.push(mockActiveTabGroup);
    const panel = createMockPanel(vscode.ViewColumn.One);

    await EditorUtils.ensureWebviewBesideSource(
      panel,
      vscode.ViewColumn.One,
      mockActiveTabGroup as vscode.TabGroup
    );

    expect(mockExecuteCommand).toHaveBeenCalledWith('workbench.action.moveEditorToNewGroupRight');
  });

  it('已侧开到另一列时不移动', async () => {
    const left = { viewColumn: vscode.ViewColumn.One };
    const right = { viewColumn: vscode.ViewColumn.Two };
    mockTabGroupsAll.push(left, right);
    mockActiveTabGroup = right;
    const panel = createMockPanel(vscode.ViewColumn.Two);

    await EditorUtils.ensureWebviewBesideSource(panel, vscode.ViewColumn.One, left as vscode.TabGroup);

    expect(mockExecuteCommand).not.toHaveBeenCalled();
  });

  it('从左侧打开却仍落在左侧时移到右侧已有组', async () => {
    const left = { viewColumn: vscode.ViewColumn.One };
    const right = { viewColumn: vscode.ViewColumn.Two };
    mockTabGroupsAll.push(left, right);
    mockActiveTabGroup = left;
    const panel = createMockPanel(vscode.ViewColumn.One);

    await EditorUtils.ensureWebviewBesideSource(panel, vscode.ViewColumn.One, left as vscode.TabGroup);

    expect(mockExecuteCommand).toHaveBeenCalledWith('workbench.action.moveEditorToNextGroup');
    expect(mockExecuteCommand).not.toHaveBeenCalledWith('workbench.action.moveEditorToNewGroupRight');
  });

  it('从右侧打开却仍落在右侧时移到左侧已有组', async () => {
    const left = { viewColumn: vscode.ViewColumn.One };
    const right = { viewColumn: vscode.ViewColumn.Two };
    mockTabGroupsAll.push(left, right);
    mockActiveTabGroup = right;
    const panel = createMockPanel(vscode.ViewColumn.Two);

    await EditorUtils.ensureWebviewBesideSource(panel, vscode.ViewColumn.Two, right as vscode.TabGroup);

    expect(mockExecuteCommand).toHaveBeenCalledWith('workbench.action.moveEditorToPreviousGroup');
    expect(mockExecuteCommand).not.toHaveBeenCalledWith('workbench.action.moveEditorToNextGroup');
    expect(mockExecuteCommand).not.toHaveBeenCalledWith('workbench.action.moveEditorToNewGroupRight');
  });

  it('面板 viewColumn 缺失但已有多列时不主动移动', async () => {
    const left = { viewColumn: vscode.ViewColumn.One };
    const right = { viewColumn: vscode.ViewColumn.Two };
    mockTabGroupsAll.push(left, right);
    const panel = createMockPanel(undefined);

    await EditorUtils.ensureWebviewBesideSource(panel, vscode.ViewColumn.One, left as vscode.TabGroup);

    expect(mockExecuteCommand).not.toHaveBeenCalled();
  });
});
