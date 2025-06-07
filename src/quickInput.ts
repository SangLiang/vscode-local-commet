import * as vscode from 'vscode';
import { TagManager } from './tagManager';

export async function showQuickInputWithTagCompletion(
    prompt: string, 
    placeholder: string, 
    value?: string,
    tagManager?: TagManager
): Promise<string | undefined> {
    return new Promise<string | undefined>((resolve) => {
        const quickPick = vscode.window.createQuickPick();
        quickPick.placeholder = placeholder;
        quickPick.title = prompt;
        quickPick.value = value || '';
        quickPick.canSelectMany = false;
        quickPick.ignoreFocusOut = true;
        quickPick.matchOnDescription = true;
        quickPick.matchOnDetail = true;
        
        let isShowingCompletions = false;
        
        const updateCompletions = (inputValue: string) => {
            const lastAtIndex = inputValue.lastIndexOf('@');
            
            if (lastAtIndex !== -1 && tagManager) {
                const afterAt = inputValue.substring(lastAtIndex + 1);
                
                if (/^[a-zA-Z0-9_]*$/.test(afterAt)) {
                    const availableTags = tagManager.getAvailableTagNames();
                    
                    if (availableTags.length > 0) {
                        const filteredTags = availableTags.filter((tag: string) => 
                            afterAt === '' || tag.toLowerCase().startsWith(afterAt.toLowerCase())
                        );
                        
                        if (filteredTags.length > 0) {
                            const items = filteredTags.map((tag: string) => ({
                                label: `@${tag}`,
                                description: '🏷️ 标签补全',
                                detail: `插入标签引用 @${tag}`,
                                originalTag: tag
                            }));
                            
                            quickPick.items = items;
                            isShowingCompletions = true;
                            
                            if (quickPick.items.length > 0) {
                                quickPick.activeItems = [quickPick.items[0]];
                            }
                        } else {
                            quickPick.items = [];
                            isShowingCompletions = false;
                        }
                    } else {
                        quickPick.items = [];
                        isShowingCompletions = false;
                    }
                } else {
                    quickPick.items = [];
                    isShowingCompletions = false;
                }
            } else {
                quickPick.items = [];
                isShowingCompletions = false;
            }
        };

        // 初始化
        updateCompletions(quickPick.value);

        // 监听输入变化
        quickPick.onDidChangeValue((inputValue) => {
            updateCompletions(inputValue);
        });

        // 选择逻辑
        quickPick.onDidAccept(() => {
            if (isShowingCompletions && quickPick.selectedItems.length > 0) {
                const selectedItem = quickPick.selectedItems[0];
                const currentValue = quickPick.value;
                const lastAtIndex = currentValue.lastIndexOf('@');
                
                if (lastAtIndex !== -1 && (selectedItem as any).originalTag) {
                    // 只替换@后面的部分
                    const beforeAt = currentValue.substring(0, lastAtIndex + 1); // 包含@
                    const newValue = beforeAt + (selectedItem as any).originalTag + ' '; // @标签名 + 空格
                    quickPick.value = newValue;
                    quickPick.items = [];
                    isShowingCompletions = false;
                    
                    // 继续编辑，不关闭对话框
                    updateCompletions(newValue);
                    return;
                }
            }
            
            // 如果不是选择补全项，则完成输入
            resolve(quickPick.value);
            quickPick.dispose();
        });

        quickPick.onDidHide(() => {
            resolve(undefined);
            quickPick.dispose();
        });

        quickPick.show();
    });
} 