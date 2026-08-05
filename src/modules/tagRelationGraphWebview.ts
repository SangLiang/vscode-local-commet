import * as vscode from 'vscode';
import { WebviewUtils, ResourceUris } from '../utils/webviewUtils';
import { logger } from '../utils/logger';
import { VIEW_TYPES } from '../constants';
import { EditorUtils } from '../utils/editorUtils';
import { getErrorMessage } from '../utils/utils';

export interface GraphNode {
    id: string;
    label: string;
    type: 'center' | 'tag';
    filePath: string;
    line?: number;
    color: string;
    hasChildren: boolean;
}

export interface GraphEdge {
    id: string;
    source: string;
    target: string;
}

export interface GraphData {
    nodes: GraphNode[];
    edges: GraphEdge[];
    level: number;
    centerNode: {
        id: string;
        filePath: string;
        label: string;
    };
    breadcrumb: BreadcrumbItem[];
}

export interface BreadcrumbItem {
    id: string;
    label: string;
    filePath: string;
    line?: number;
}

export interface TagRelationGraphMessage {
    command: string;
    nodeId?: string;
    label?: string;
    filePath?: string;
    line?: number;
    level?: number;
}

export class TagRelationGraphWebview {
    private static currentPanel: TagRelationGraphWebview | undefined;
    private static currentFilePath: string | undefined;

    private readonly panel: vscode.WebviewPanel;
    private readonly context: vscode.ExtensionContext;
    private readonly onMessage: (message: TagRelationGraphMessage) => void;

    private constructor(
        panel: vscode.WebviewPanel,
        context: vscode.ExtensionContext,
        onMessage: (message: TagRelationGraphMessage) => void
    ) {
        this.panel = panel;
        this.context = context;
        this.onMessage = onMessage;
        this.panel.onDidDispose(() => this.dispose());
    }

    static createOrShow(
        context: vscode.ExtensionContext,
        filePath: string,
        fileName: string,
        onMessage: (message: TagRelationGraphMessage) => void
    ): TagRelationGraphWebview {
        const activeEditor = vscode.window.activeTextEditor;

        if (TagRelationGraphWebview.currentPanel && 
            TagRelationGraphWebview.currentFilePath === filePath) {
            TagRelationGraphWebview.currentPanel.panel.reveal();
            return TagRelationGraphWebview.currentPanel;
        }

        if (TagRelationGraphWebview.currentPanel) {
            TagRelationGraphWebview.currentPanel.panel.dispose();
        }

        const sourceGroup = vscode.window.tabGroups.activeTabGroup;
        const sourceViewColumn = activeEditor?.viewColumn ?? sourceGroup.viewColumn;
        const viewColumn = EditorUtils.smartSelectViewColumn(activeEditor);
        const panel = vscode.window.createWebviewPanel(
            VIEW_TYPES.TAG_RELATION_GRAPH,
            `Tag关系图: ${fileName}`,
            viewColumn,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(context.extensionUri, 'src', 'templates', 'tagRelationGraph'),
                    vscode.Uri.joinPath(context.extensionUri, 'out', 'lib')
                ]
            }
        );
        void EditorUtils.ensureWebviewBesideSource(sourceViewColumn, sourceGroup);

        const webview = new TagRelationGraphWebview(panel, context, onMessage);
        TagRelationGraphWebview.currentPanel = webview;
        TagRelationGraphWebview.currentFilePath = filePath;

        webview.initialize();
        return webview;
    }

    private initialize(): void {
        const resourceUris = WebviewUtils.buildResourceUris(this.panel.webview, this.context.extensionUri, {
            customResources: [
                { path: 'src/templates/tagRelationGraph/graph.css', name: 'cssUri' },
                { path: 'src/templates/tagRelationGraph/graph.js', name: 'jsUri' },
                { path: 'out/lib/cytoscape.min.js', name: 'cytoscapeUri' }
            ]
        });

        this.panel.webview.html = this.getWebviewContent(resourceUris);
        this.registerMessageHandler();
    }

    updateGraph(data: GraphData): void {
        this.panel.webview.postMessage({
            command: 'updateGraph',
            data: data
        });
    }

    showError(message: string): void {
        this.panel.webview.postMessage({
            command: 'showError',
            error: message
        });
    }

    private registerMessageHandler(): void {
        this.panel.webview.onDidReceiveMessage(async (message) => {
            try {
                await this.onMessage(message);
            } catch (error) {
                logger.error('处理消息失败:', error);
                this.showError(getErrorMessage(error));
            }
        });
    }

    private getWebviewContent(resourceUris: ResourceUris): string {
        const template = WebviewUtils.loadTemplate(
            this.context,
            'tagRelationGraph/graph.html'
        );

        const templateVariables: Record<string, string> = {
            title: 'Tag 关系图',
            cssUri: resourceUris.cssUri || '',
            jsUri: resourceUris.jsUri || '',
            cytoscapeUri: resourceUris.cytoscapeUri || '',
            cspSource: this.panel.webview.cspSource
        };

        return WebviewUtils.replaceTemplateVariables(template, templateVariables);
    }

    dispose(): void {
        TagRelationGraphWebview.currentPanel = undefined;
        TagRelationGraphWebview.currentFilePath = undefined;
    }
}
