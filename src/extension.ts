import * as vscode from 'vscode';
import { ExtensionContainer } from './core/ExtensionContainer';
import { ExtensionLifecycle } from './core/ExtensionLifecycle';

let _container: ExtensionContainer | undefined;
let lifecycle: ExtensionLifecycle | undefined;

export function getContainer(): ExtensionContainer {
    if (!_container) {
        throw new Error('Extension container not initialized');
    }
    return _container;
}

export async function activate(context: vscode.ExtensionContext) {
    _container = new ExtensionContainer(context);
    lifecycle = new ExtensionLifecycle(_container, context);
    await lifecycle.activate();
}

export async function deactivate() {
    if (lifecycle) {
        await lifecycle.deactivate();
    }
}
