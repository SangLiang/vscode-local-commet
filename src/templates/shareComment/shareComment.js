(function() {
    const vscode = acquireVsCodeApi();
    const previewArea = document.getElementById('previewArea');
    let currentPreviewFontSize = null;

    const renderCore = window.MarkdownRenderCore.create();
    /** 可用标签白名单，由扩展侧 SET_AVAILABLE_TAGS 下发；传入 renderMarkdownToHtml 后仅渲染真实存在的 @tag */
    let availableTagNames = [];
    const initializationPromise = renderCore.waitForLibs()
        .then(() => {
            console.log('所有库初始化成功');
        })
        .catch(error => {
            console.error("关键库初始化失败:", error);
            previewArea.innerHTML = `<p style="color:red;">预览组件加载失败: ${error.message}</p>`;
            throw error;
        });

    async function updatePreview(content) {
        if (!content || content.trim() === '') {
            previewArea.innerHTML = '<p style="color: var(--vscode-descriptionForeground); text-align: center; margin-top: 40px;">暂无内容</p>';
            return;
        }

        try {
            await initializationPromise;
            const finalHtmlWithSvg = await renderCore.renderMarkdownToHtml(content, availableTagNames);
            previewArea.innerHTML = finalHtmlWithSvg || '<p>预览生成失败</p>';

            if (currentPreviewFontSize && typeof window.applyPreviewFontSize === 'function') {
                window.applyPreviewFontSize(previewArea, currentPreviewFontSize);
            }

            if (window.MermaidChartInteract) {
                window.MermaidChartInteract.initAll(previewArea, { fit: true, ensureId: false });
            }
        } catch (error) {
            console.error('预览更新失败:', error);
            previewArea.innerHTML = `
                <div class="mermaid-error">
                    <p>预览渲染失败</p>
                    <pre>${error.message}</pre>
                </div>
            `;
        }
    }

    window.closePreview = function() {
        vscode.postMessage({
            command: 'close'
        });
    };

    window.exportToLocalComment = function() {
        vscode.postMessage({
            command: 'exportToLocalComment'
        });
    };

    window.addEventListener('message', event => {
        const message = event.data;
        switch (message.command) {
            case 'setPreviewFontSize':
                if (message.fontSize && message.fontSize > 0) {
                    currentPreviewFontSize = message.fontSize;
                    if (typeof window.applyPreviewFontSize === 'function') {
                        window.applyPreviewFontSize(previewArea, message.fontSize);
                    }
                }
                break;
            case 'setMermaidTheme':
                try {
                    const isHandDrawn = message.theme === 'hand-drawn';
                    if (renderCore.reinitializeMermaid({ handDrawnEnabled: isHandDrawn })) {
                        if (window.markdownContent) {
                            updatePreview(window.markdownContent);
                        }
                    }
                } catch (error) {
                    console.error('设置Mermaid主题失败:', error);
                }
                break;
            case 'setAvailableTags':
                {
                    const next = Array.isArray(message.tagNames) ? message.tagNames : [];
                    if (next.length !== availableTagNames.length || next.some((t, i) => t !== availableTagNames[i])) {
                        availableTagNames = next;
                        if (window.markdownContent) {
                            updatePreview(window.markdownContent);
                        }
                    }
                }
                break;
        }
    });

    function initializePreview() {
        if (window.markdownContent) {
            updatePreview(window.markdownContent);
        } else {
            console.log('window.markdownContent 不存在或为空');
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializePreview);
    } else {
        initializePreview();
    }
})();
