(function() {
    const vscode = acquireVsCodeApi();
    const textarea = document.getElementById('contentInput');
    const previewArea = document.getElementById('previewArea');
    /** 打开面板时磁盘/模板上的正文，用于 dirty 判断（早于 getState 恢复） */
    const diskCommittedBaseline = textarea.value;
    let previewVisible = false;
    let currentPreviewFontSize = null; // 保存当前预览字体大小

    const renderCore = window.MarkdownRenderCore.create();
    /** 可用标签白名单，由扩展侧 SET_AVAILABLE_TAGS 下发；传入 renderMarkdownToHtml 后仅渲染真实存在的 @tag */
    let availableTagNames = [];
    // 全局、一次性的初始化任务
    const initializationPromise = renderCore.waitForLibs()
        .catch(error => {
            console.error("关键库初始化失败:", error);
            // 可以在预览区域显示一个永久性的错误
            previewArea.innerHTML = `<p style="color:red;">预览组件加载失败: ${error.message}</p>`;
            // 抛出错误以防止后续操作执行
            throw error;
        });
    
    // Tab切换功能
    let currentTab = 'preview-tab';
    
    // 状态管理：恢复之前保存的状态
    const previousState = vscode.getState();
    if (previousState) {
        if (previousState.content && previousState.content !== textarea.value) {
            textarea.value = previousState.content;
        }
        if (previousState.previewVisible) {
            previewVisible = previousState.previewVisible;
            // 如果之前在预览状态，恢复到预览tab
            if (previewVisible) {
                currentTab = 'preview-tab';
            }
        }
        if (previousState.currentTab) {
            currentTab = previousState.currentTab;
        }
    }

    /** 与磁盘或上次成功「保存并继续」一致的正文；严格全文比较 */
    let committedText = diskCommittedBaseline;

    const discardOverlay = document.getElementById('discard-confirm-overlay');
    const discardBtnBack = document.getElementById('discard-confirm-back');
    const discardBtnAbandon = document.getElementById('discard-confirm-abandon');

    function normalizeForDirty(s) {
        return s;
    }

    function isEditorDirty() {
        return normalizeForDirty(textarea.value) !== normalizeForDirty(committedText);
    }

    /** 与扩展侧 Tab 标题同步：仅在实际变化时上报 */
    let lastPostedDirty = undefined;
    let dirtyTabPostTimer = null;
    function postDirtyStateToHost() {
        const d = isEditorDirty();
        if (lastPostedDirty === d) {
            return;
        }
        lastPostedDirty = d;
        vscode.postMessage({
            command: 'editorDirtyState',
            isDirty: d
        });
    }
    function scheduleDirtyPostToHost() {
        if (dirtyTabPostTimer) {
            clearTimeout(dirtyTabPostTimer);
        }
        dirtyTabPostTimer = setTimeout(function() {
            dirtyTabPostTimer = null;
            postDirtyStateToHost();
        }, 120);
    }

    function isDiscardOverlayVisible() {
        return discardOverlay && discardOverlay.classList.contains('is-visible');
    }

    function showDiscardConfirm() {
        if (!discardOverlay) {
            postCancelAbandonConfirmed();
            return;
        }
        discardOverlay.classList.add('is-visible');
        discardOverlay.setAttribute('aria-hidden', 'false');
        if (discardBtnBack) {
            discardBtnBack.focus();
        }
    }

    function hideDiscardConfirm() {
        if (!discardOverlay) {
            return;
        }
        discardOverlay.classList.remove('is-visible');
        discardOverlay.setAttribute('aria-hidden', 'true');
        textarea.focus();
    }

    function postCancelAbandonConfirmed() {
        vscode.postMessage({
            command: 'cancel',
            abandonConfirmed: true
        });
    }

    function requestCancelOrClose() {
        if (isDiscardOverlayVisible()) {
            return;
        }
        if (!isEditorDirty()) {
            postCancelAbandonConfirmed();
            return;
        }
        showDiscardConfirm();
    }

    if (discardBtnBack) {
        discardBtnBack.addEventListener('click', function() {
            hideDiscardConfirm();
        });
    }
    if (discardBtnAbandon) {
        discardBtnAbandon.addEventListener('click', function() {
            hideDiscardConfirm();
            postCancelAbandonConfirmed();
        });
    }
    if (discardOverlay) {
        discardOverlay.addEventListener('click', function(e) {
            if (e.target === discardOverlay) {
                hideDiscardConfirm();
            }
        });
    }
    
    // 保存状态的函数
    function saveState() {
        vscode.setState({
            content: textarea.value,
            previewVisible: previewVisible,
            currentTab: currentTab
        });
    }

    // 更新预览内容
    async function updatePreview(content) {
        try {
            if (!content) {
                previewArea.innerHTML = '<p>没有内容可预览</p>';
                return;
            }

            await initializationPromise;
            const finalHtmlWithSvg = await renderCore.renderMarkdownToHtml(content, availableTagNames);

            // 一次性更新DOM（更新前保存输入框滚动比例，更新后恢复预览滚动，避免输入时预览总回到顶部）
            const inputMax = textarea.scrollHeight - textarea.clientHeight;
            const inputRatio = inputMax > 0 ? textarea.scrollTop / inputMax : 0;
            previewArea.innerHTML = finalHtmlWithSvg || '<p>预览生成失败</p>';
            requestAnimationFrame(function() {
                const previewMax = previewArea.scrollHeight - previewArea.clientHeight;
                if (previewMax > 0 && inputRatio >= 0) {
                    previewArea.scrollTop = Math.round(inputRatio * previewMax);
                }
            });
            
            if (currentPreviewFontSize && typeof window.applyPreviewFontSize === 'function') {
                window.applyPreviewFontSize(previewArea, currentPreviewFontSize);
            }
            
            const tagLinks = previewArea.querySelectorAll('.tag-link');
            tagLinks.forEach(link => {
                link.addEventListener('click', function(e) {
                    e.preventDefault();
                    const tagName = this.getAttribute('data-tag');
                    if (tagName) {
                        vscode.postMessage({
                            command: 'goToTagDeclaration',
                            tagName: tagName
                        });
                    }
                });
            });
        } catch (error) {
            console.error('预览更新失败:', error);
            previewArea.innerHTML = '<p>预览生成失败，请重试</p>';
        }
    }

    // Tab切换功能
    function initTabSwitching() {
        const tabButtons = document.querySelectorAll('.tab-btn');
        const tabContents = document.querySelectorAll('.tab-content');
        
        tabButtons.forEach(button => {
            button.addEventListener('click', function() {
                const targetTab = this.getAttribute('data-tab');
                switchTab(targetTab);
            });
        });

        // Toggle preview size functionality
        const toggleButton = document.getElementById('toggle-preview-size-btn');
        const container = document.querySelector('.container');
        if (toggleButton && container) {
            toggleButton.addEventListener('click', () => {
                container.classList.toggle('maximized');
                const isMaximized = container.classList.contains('maximized');
                toggleButton.title = isMaximized ? '编辑' : '预览';
                toggleButton.textContent = isMaximized ? '编辑' : '预览';
            });
        }
    }
    
    function switchTab(targetTab) {
        // 更新按钮状态
        const tabButtons = document.querySelectorAll('.tab-btn');
        const tabContents = document.querySelectorAll('.tab-content');
        
        tabButtons.forEach(btn => {
            btn.classList.remove('active');
            if (btn.getAttribute('data-tab') === targetTab) {
                btn.classList.add('active');
            }
        });
        
        // 更新内容显示
        tabContents.forEach(content => {
            content.classList.remove('active');
            if (content.id === targetTab) {
                content.classList.add('active');
            }
        });
        
        // 如果切换到预览tab，自动更新预览内容
        if (targetTab === 'preview-tab') {
            const content = textarea.value;
            updatePreview(content);
            previewVisible = true;
        }
        
        currentTab = targetTab;
        saveState();
    }
    
    // 标签自动补全 - 支持动态更新
    let tagSuggestions = window.tagSuggestions || '';
    let tagList = tagSuggestions.split(',').filter(tag => tag.length > 0);
    
    // 监听来自extension的数据更新
    window.addEventListener('message', event => {
        const message = event.data;
        if (message.command === 'updateTagSuggestions') {
            tagSuggestions = message.tagSuggestions || '';
            tagList = tagSuggestions.split(',').filter(tag => tag.length > 0);
            console.log('标签建议已更新:', tagList.length + ' 个标签');
        } else if (message.command === 'setAvailableTags') {
            // 扩展侧下发可用标签白名单，用于精确渲染 @tag 链接
            const next = Array.isArray(message.tagNames) ? message.tagNames : [];
            if (next.length !== availableTagNames.length || next.some((t, i) => t !== availableTagNames[i])) {
                availableTagNames = next;
                // 当前若处于预览态，立即用新白名单重渲染
                if (currentTab === 'preview-tab' && textarea.value) {
                    debouncedUpdatePreview(textarea.value);
                }
            }
        } else if (message.command === 'updateCodeContext') {
            // 异步更新代码上下文
            updateCodeContext(message.contextLines, message.contextStartLine, message.lineNumber);
        } else if (message.command === 'updateCurrentLineContent') {
            // 更新当前行内容显示
            updateCurrentLineContent(message.lineContent, message.lineNumber);
        } else if (message.command === 'setMermaidTheme') {
            const handDrawn = message.theme === 'hand-drawn';
            if (renderCore.reinitializeMermaid({ handDrawnEnabled: handDrawn })) {
                console.log(`Mermaid 主题已设置为: ${message.theme}`);
                if (currentTab === 'preview-tab' && textarea.value) {
                    updatePreview(textarea.value);
                }
            }
        } else if (message.command === 'setPreviewFontSize') {
            // 设置预览区域字体大小
            if (message.fontSize && message.fontSize > 0) {
                currentPreviewFontSize = message.fontSize;
                if (typeof window.applyPreviewFontSize === 'function') {
                    window.applyPreviewFontSize(previewArea, message.fontSize);
                }
            }
        }
    });
    
    // 更新代码上下文显示
    function updateCodeContext(contextLines, contextStartLine, lineNumber) {
        const codeTab = document.getElementById('code-tab');
        if (!codeTab || !contextLines || contextLines.length === 0) return;
        
        // 查找或创建代码上下文区域
        let contextItem = codeTab.querySelector('.context-item:has(.code-context-preview)');
        if (!contextItem) {
            // 创建新的上下文区域
            const contextHtml = `
                <div class="context-item">
                    <span class="context-label">代码上下文:</span>
                    <div class="context-value">
                        <div class="code-context-preview"></div>
                    </div>
                </div>
            `;
            codeTab.insertAdjacentHTML('beforeend', contextHtml);
            contextItem = codeTab.querySelector('.context-item:last-child');
        }
        
        const previewContainer = contextItem.querySelector('.code-context-preview');
        if (previewContainer) {
            let contextHtml = '';
            contextLines.forEach((line, index) => {
                const currentLineNumber = (contextStartLine || 0) + index;
                const isTargetLine = currentLineNumber === lineNumber;
                const lineClass = isTargetLine ? 'target-line' : 'context-line';
                const lineNumberDisplay = currentLineNumber + 1;
                const escapedLine = typeof window.escapeHtml === 'function' ? window.escapeHtml(line) : line;
                
                contextHtml += `
                    <div class="code-line ${lineClass}" data-line-number="${currentLineNumber}">
                        <span class="line-number">${lineNumberDisplay}</span>
                        <span class="line-content">${escapedLine}</span>
                    </div>
                `;
            });
            
            previewContainer.innerHTML = contextHtml;
            console.log('代码上下文已更新:', contextLines.length + ' 行');
            
            // 同步更新当前行内容显示
            if (lineNumber !== undefined) {
                const relativeLineIndex = lineNumber - contextStartLine;
                if (relativeLineIndex >= 0 && relativeLineIndex < contextLines.length) {
                    const currentLineContent = contextLines[relativeLineIndex];
                    updateCurrentLineContent(currentLineContent, lineNumber);
                }
                
                // 更新行号栏显示
                updateLineNumberDisplay(lineNumber);
            }
            
            // 为每一行添加点击事件
            const codeLines = previewContainer.querySelectorAll('.code-line');
            codeLines.forEach(line => {
                line.addEventListener('click', function() {
                    // 移除所有行的高亮
                    codeLines.forEach(l => l.classList.remove('target-line'));
                    // 为当前点击的行添加高亮
                    this.classList.add('target-line');
                    
                    // 获取行号
                    const clickedLineNumber = parseInt(this.getAttribute('data-line-number'));
                    
                                    // 通知扩展更新选中的行
                vscode.postMessage({
                    command: 'updateSelectedLine',
                    lineNumber: clickedLineNumber
                });
                
                // 更新行号栏显示
                updateLineNumberDisplay(clickedLineNumber);
                
                console.log('选中行已更新:', clickedLineNumber);
                });
                
                // 添加鼠标悬停效果
                line.addEventListener('mouseenter', function() {
                    if (!this.classList.contains('target-line')) {
                        this.classList.add('hover-line');
                    }
                });
                
                line.addEventListener('mouseleave', function() {
                    this.classList.remove('hover-line');
                });
            });
        }
    }
    
    // 更新行号栏显示
    function updateLineNumberDisplay(lineNumber) {
        const codeTab = document.getElementById('code-tab');
        if (!codeTab) return;
        
        // 查找行号显示区域
        const contextItems = codeTab.querySelectorAll('.context-item');
        let lineNumberItem = null;
        
        for (const item of contextItems) {
            const label = item.querySelector('.context-label');
            if (label && label.textContent === '行号:') {
                lineNumberItem = item;
                break;
            }
        }
        
        if (lineNumberItem) {
            const lineNumberValue = lineNumberItem.querySelector('.context-value');
            if (lineNumberValue) {
                lineNumberValue.textContent = `第 ${lineNumber + 1} 行`;
            }
        }
    }
    
    // 更新当前行内容显示
    function updateCurrentLineContent(lineContent, lineNumber) {
        const codeTab = document.getElementById('code-tab');
        if (!codeTab) return;
        
        // 查找或创建"当前代码"显示区域
        let currentCodeItem = codeTab.querySelector('.context-item:has(.current-code)');
        if (!currentCodeItem) {
            // 如果没有找到，查找"代码上下文"区域，在其前插入"当前代码"区域
            const contextItem = codeTab.querySelector('.context-item:has(.code-context-preview)');
            if (contextItem) {
                const currentCodeHtml = `
                    <div class="context-item">
                        <span class="context-label">当前代码:</span>
                        <div class="context-value">
                            <div class="code-preview current-code"></div>
                        </div>
                    </div>
                `;
                contextItem.insertAdjacentHTML('beforebegin', currentCodeHtml);
                currentCodeItem = codeTab.querySelector('.context-item:has(.current-code)');
            }
        }
        
        if (currentCodeItem) {
            const currentCodePreview = currentCodeItem.querySelector('.current-code');
            if (currentCodePreview) {
                // 转义HTML内容
                const escapedContent = typeof window.escapeHtml === 'function' ? window.escapeHtml(lineContent) : lineContent;
                
                // 使用innerHTML来正确显示转义后的内容，避免HTML实体被显示为原始字符
                currentCodePreview.innerHTML = escapedContent;
                
                                 // 更新标签显示
                 const contextLabel = currentCodeItem.querySelector('.context-label');
                 if (contextLabel) {
                     // 使用textContent确保内容被正确转义
                     contextLabel.textContent = '当前代码:';
                 }
                
                console.log('当前行内容已更新:', lineNumber + 1, lineContent);
            }
        }
    }
    
    // 全局函数定义
    window.save = function() {
        const content = textarea.value;
        vscode.postMessage({
            command: 'save',
            content: content
        });
    };
    
    window.cancel = function() {
        requestCancelOrClose();
    };
    
    // 自动补全功能
    const autocompleteDropdown = document.getElementById('autocompleteDropdown');
    let selectedIndex = -1;
    let filteredTags = [];
    let autocompleteVisible = false;
    
    function showAutocomplete(tags, cursorPos) {
        if (tags.length === 0) {
            hideAutocomplete();
            return;
        }
        
        filteredTags = tags;
        selectedIndex = 0;
        autocompleteVisible = true;
        
        // 清空下拉列表
        autocompleteDropdown.innerHTML = '';
        
        // 添加选项
        tags.forEach((tag, index) => {
            const item = document.createElement('div');
            item.className = 'autocomplete-item' + (index === 0 ? ' selected' : '');
            item.innerHTML = '<span class="tag-name">@' + tag + '</span><span class="tag-description">标签引用</span>';
            item.addEventListener('click', () => {
                insertTag(tag);
            });
            autocompleteDropdown.appendChild(item);
        });
        
        // 显示下拉框（先显示，后调整位置，避免测量错误）
        autocompleteDropdown.style.display = 'block';
        
        // 计算光标位置
        const position = getCaretPixelPosition(textarea, cursorPos);
        
        // 设置下拉框初始位置（相对于textarea）
        autocompleteDropdown.style.left = position.left + 'px';
        autocompleteDropdown.style.top = (position.top + position.height + 2) + 'px';
        
        // 确保下拉框不超出容器边界（需要在显示后调整）
        setTimeout(() => {
            adjustDropdownPosition();
        }, 0);
    }
    
    /**
     * 获取光标在textarea中的像素位置
     */
    function getCaretPixelPosition(textarea, caretPos) {
        // 创建一个隐藏的div，模拟textarea的样式
        const div = document.createElement('div');
        const style = window.getComputedStyle(textarea);
        
        // 复制textarea的样式到div，确保布局一致
        div.style.position = 'absolute';
        div.style.visibility = 'hidden';
        div.style.whiteSpace = 'pre-wrap';
        div.style.wordWrap = 'break-word';
        div.style.top = '-9999px';
        div.style.left = '-9999px';
        div.style.overflow = 'hidden';
        
        // 复制重要的样式属性
        [
            'fontFamily', 'fontSize', 'fontWeight', 'lineHeight',
            'paddingTop', 'paddingLeft', 'paddingRight', 'paddingBottom',
            'borderTopWidth', 'borderLeftWidth', 'borderRightWidth', 'borderBottomWidth',
            'width', 'boxSizing'
        ].forEach(prop => {
            div.style[prop] = style[prop];
        });
        
        document.body.appendChild(div);
        
        // 设置文本内容到光标位置
        const textBeforeCaret = textarea.value.substring(0, caretPos);
        div.textContent = textBeforeCaret;
        
        // 创建一个span来标记光标位置
        const span = document.createElement('span');
        span.textContent = '\u200b'; // 使用零宽度字符
        div.appendChild(span);
        
        // 获取span的位置（即光标位置）
        const spanRect = span.getBoundingClientRect();
        const textareaRect = textarea.getBoundingClientRect();
        
        // 获取textarea的内边距
        const paddingLeft = parseInt(style.paddingLeft) || 0;
        const paddingTop = parseInt(style.paddingTop) || 0;
        
        // 计算相对于textarea内容区域的位置
        let left = spanRect.left - textareaRect.left;
        let top = spanRect.top - textareaRect.top - textarea.scrollTop + textarea.scrollHeight - div.scrollHeight;
        
        // 如果计算出现问题，使用备用方法
        if (top < 0 || top > textarea.clientHeight) {
            // 使用行高估算位置
            const lineHeight = parseInt(style.lineHeight) || parseInt(style.fontSize) * 1.2;
            const lines = textBeforeCaret.split('\n');
            const lineIndex = lines.length - 1;
            top = paddingTop + lineIndex * lineHeight - textarea.scrollTop;
        }
        
        const height = parseInt(style.lineHeight) || parseInt(style.fontSize) * 1.2;
        
        // 清理
        document.body.removeChild(div);
        
        return {
            left: Math.max(0, left),
            top: Math.max(0, top),
            height: height
        };
    }
    
    /**
     * 调整下拉框位置，确保不超出容器边界
     */
    function adjustDropdownPosition() {
        const dropdown = autocompleteDropdown;
        const textareaContainer = textarea.parentElement; // autocomplete容器
        const container = textareaContainer.parentElement; // input-area容器
        
        // 获取各个元素的边界信息
        const containerRect = container.getBoundingClientRect();
        const textareaRect = textarea.getBoundingClientRect();
        const dropdownRect = dropdown.getBoundingClientRect();
        
        // 获取当前下拉框的位置（相对于textarea）
        let currentLeft = parseInt(dropdown.style.left) || 0;
        let currentTop = parseInt(dropdown.style.top) || 0;
        
        // 计算下拉框在屏幕上的实际位置
        const actualLeft = textareaRect.left + currentLeft;
        const actualTop = textareaRect.top + currentTop;
        const actualRight = actualLeft + dropdownRect.width;
        const actualBottom = actualTop + dropdownRect.height;
        
        // 检查是否超出右边界
        if (actualRight > containerRect.right) {
            const overflow = actualRight - containerRect.right;
            currentLeft = Math.max(0, currentLeft - overflow - 10);
            dropdown.style.left = currentLeft + 'px';
        }
        
        // 检查是否超出左边界
        if (actualLeft < containerRect.left) {
            const underflow = containerRect.left - actualLeft;
            currentLeft = currentLeft + underflow + 10;
            dropdown.style.left = currentLeft + 'px';
        }
        
        // 检查是否超出底部边界，如果超出则显示在光标上方
        if (actualBottom > containerRect.bottom) {
            // 计算光标的实际位置
            const position = getCaretPixelPosition(textarea, textarea.selectionStart);
            // 将下拉框显示在光标上方
            currentTop = position.top - dropdownRect.height - 5;
            dropdown.style.top = Math.max(5, currentTop) + 'px';
        }
        
        // 检查是否超出顶部边界
        if (actualTop < containerRect.top) {
            // 如果上方也放不下，则在可视区域内显示
            const visibleTop = Math.max(5, containerRect.top - textareaRect.top + 5);
            dropdown.style.top = visibleTop + 'px';
        }
    }
    
    function hideAutocomplete() {
        autocompleteVisible = false;
        autocompleteDropdown.style.display = 'none';
        selectedIndex = -1;
        filteredTags = [];
    }
    
    function updateSelection(direction) {
        if (!autocompleteVisible || filteredTags.length === 0) return;
        
        // 移除当前选中状态
        const items = autocompleteDropdown.querySelectorAll('.autocomplete-item');
        if (items[selectedIndex]) {
            items[selectedIndex].classList.remove('selected');
        }
        
        // 更新选中索引
        selectedIndex += direction;
        if (selectedIndex < 0) selectedIndex = filteredTags.length - 1;
        if (selectedIndex >= filteredTags.length) selectedIndex = 0;
        
        // 添加新的选中状态
        if (items[selectedIndex]) {
            items[selectedIndex].classList.add('selected');
            items[selectedIndex].scrollIntoView({ block: 'nearest' });
        }
    }
    
    function insertTag(tag) {
        const cursorPos = textarea.selectionStart;
        const text = textarea.value;

        // 找到@的位置
        const beforeCursor = text.substring(0, cursorPos);
        const atIndex = beforeCursor.lastIndexOf('@');

        if (atIndex !== -1) {
            // 替换@后的内容
            const beforeAt = text.substring(0, atIndex);
            const afterCursor = text.substring(cursorPos);
            const newText = beforeAt + '@' + tag + ' ' + afterCursor;

            textarea.value = newText;
            const newCursorPos = atIndex + tag.length + 2; // @tag + 空格
            textarea.setSelectionRange(newCursorPos, newCursorPos);
            textarea.focus();
        }

        hideAutocomplete();
        scheduleDirtyPostToHost();

        // 如果当前在预览tab，立即更新预览（因为直接修改value不会触发input事件）
        if (currentTab === 'preview-tab') {
            debouncedUpdatePreview(textarea.value);
        }

        // 保存状态
        saveState();
    }
    
    const debouncedUpdatePreview = typeof window.debounce === 'function' ? window.debounce(updatePreview, 500) : updatePreview;

    textarea.addEventListener('input', function(e) {
        // 如果当前在预览tab，实时更新预览
        if (currentTab === 'preview-tab') {
            const content = e.target.value;
            debouncedUpdatePreview(content);
        }
        
        const cursorPos = e.target.selectionStart;
        const text = e.target.value;
        const beforeCursor = text.substring(0, cursorPos);
        
        // 检查是否刚输入了@
        const atMatch = beforeCursor.match(/@([\u4e00-\u9fa5a-zA-Z0-9_]*)$/);
        if (atMatch && tagList.length > 0) {
            const searchTerm = atMatch[1].toLowerCase();
            const availableTags = tagList.filter(tag => 
                tag.startsWith('@') && 
                tag.slice(1).toLowerCase().includes(searchTerm)
            ).map(tag => tag.slice(1)); // 移除@前缀
            
            if (availableTags.length > 0) {
                showAutocomplete(availableTags, cursorPos);
            } else {
                hideAutocomplete();
            }
        } else {
            hideAutocomplete();
        }
        
        // 保存输入状态
        saveState();
        scheduleDirtyPostToHost();
    });
    
    // 处理键盘导航
    textarea.addEventListener('keydown', function(e) {
        if (autocompleteVisible) {
            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault();
                    updateSelection(1);
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    updateSelection(-1);
                    break;
                case 'Enter':
                case 'Tab':
                    e.preventDefault();
                    if (selectedIndex >= 0 && filteredTags[selectedIndex]) {
                        insertTag(filteredTags[selectedIndex]);
                    }
                    break;
                case 'Escape':
                    e.preventDefault();
                    e.stopPropagation();
                    hideAutocomplete();
                    break;
            }
        }
    });
    
    // 点击其他地方时隐藏自动补全
    document.addEventListener('click', function(e) {
        if (!autocompleteDropdown.contains(e.target) && e.target !== textarea) {
            hideAutocomplete();
        }
    });
    
    // 监听textarea滚动事件，重新调整下拉框位置
    textarea.addEventListener('scroll', function() {
        if (autocompleteVisible) {
            adjustDropdownPosition();
        }
    });
    
    // 监听窗口大小变化，重新调整下拉框位置
    window.addEventListener('resize', function() {
        if (autocompleteVisible) {
            setTimeout(() => {
                adjustDropdownPosition();
            }, 100);
        }
    });
    
    // 全局快捷键支持
    document.addEventListener('keydown', function(e) {
        if (isDiscardOverlayVisible()) {
            if (e.key === 'Escape') {
                e.preventDefault();
                hideDiscardConfirm();
            }
            return;
        }
        if (!autocompleteVisible) {
            if (e.ctrlKey && e.key === 'Enter') {
                e.preventDefault();
                window.save();
            } else if (e.ctrlKey && e.key === 's') {
                e.preventDefault();
                window.saveAndContinue();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                window.cancel();
            }
        }
    });
    
    // 监听失去焦点时保存状态
    textarea.addEventListener('blur', function() {
        saveState();
    });
    
    // 初始化tab切换功能
    initTabSwitching();

    // ========== 预览滚动同步到输入框 ==========
    // 说明：预览内容（渲染后的 HTML）与输入内容（Markdown 源码）高度不一致，
    // 所以这里用「滚动进度比例」(0~1) 来对齐：ratio = scrollTop / (scrollHeight - clientHeight)。
    let scrollSyncInProgress = false; // 防止程序设置 scrollTop 时引发递归触发

    // 页面内开关：默认勾选，不做持久化（用户关闭后，本次面板内生效即可）
    const scrollSyncCheckbox = document.getElementById('scroll-sync-checkbox');
    let scrollSyncEnabled = true;
    if (scrollSyncCheckbox) {
        scrollSyncEnabled = !!scrollSyncCheckbox.checked;
        scrollSyncCheckbox.addEventListener('change', function() {
            scrollSyncEnabled = !!scrollSyncCheckbox.checked;
        });
    }

    /** 预览区域滚动时，把相同进度比例应用到输入框 */
    function syncScrollFromPreviewToInput() {
        if (!scrollSyncEnabled) return;
        if (scrollSyncInProgress || currentTab !== 'preview-tab') return;
        const preview = previewArea;
        const previewMax = preview.scrollHeight - preview.clientHeight; // 可滚动最大距离
        if (previewMax <= 0) return;
        scrollSyncInProgress = true;
        const ratio = preview.scrollTop / previewMax; // 当前进度 0~1
        const inputMax = textarea.scrollHeight - textarea.clientHeight;
        if (inputMax > 0) {
            textarea.scrollTop = Math.round(ratio * inputMax);
        }
        requestAnimationFrame(function() { scrollSyncInProgress = false; }); // 下一帧再放开，避免本次 set 触发对方 scroll 又同步回来
    }

    previewArea.addEventListener('scroll', syncScrollFromPreviewToInput);
    
    // 恢复tab状态
    if (previousState && previousState.currentTab) {
        switchTab(previousState.currentTab);
    }
    
    // 初始化时如果有恢复的预览状态或当前是预览标签页，更新预览内容
    if ((previewVisible || currentTab === 'preview-tab') && textarea.value) {
        updatePreview(textarea.value);
        console.log('页面加载时自动更新预览内容');
    }
    
    // 设置焦点
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    // 同步 Tab 脏标记（含 getState 恢复后与基线不一致的情况）
    setTimeout(function() {
        postDirtyStateToHost();
    }, 0);
    
    // 暴露函数给全局作用域
    window.saveAndContinue = function() {
        vscode.postMessage({
            command: 'saveAndContinue',
            content: textarea.value
        });
    };
    
    // 添加分享函数
    window.share = function() {
        // 获取当前注释内容
        const content = textarea.value;
        
        // 发送分享消息到扩展，包含内容和其它可能的信息
        vscode.postMessage({
            command: 'share',
            content: content,
            comment: {
                content: content,
                timestamp: Date.now()
            }
        });
    };
    
    // 监听来自扩展的消息
    window.addEventListener('message', event => {
        const message = event.data;
        switch (message.command) {
            case 'editorBaselineCommitted':
                if (typeof message.text === 'string') {
                    committedText = message.text;
                    saveState();
                }
                postDirtyStateToHost();
                break;
            case 'editorSaveSkipped':
                if (message.reason === 'no-op' && typeof message.text === 'string') {
                    committedText = message.text;
                    saveState();
                }
                // reason === 'empty'：不更新基线（仍视为相对磁盘的未提交空稿）
                postDirtyStateToHost();
                break;
            case 'shareSuccess':
                // 分享成功后可以更新UI状态
                console.log('注释分享成功，sharedId:', message.sharedId);
                // 可以在这里添加更新UI的代码，比如禁用分享按钮或改变其文本
                // 例如：显示"已分享"状态
                const shareButton = document.querySelector('.share-btn');
                if (shareButton) {
                    shareButton.innerHTML = `
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                        </svg>
                        已分享
                    `;
                    shareButton.disabled = true;
                }
                break;
            case 'shareError':
                // 处理分享错误
                console.error('分享失败:', message.error);
                // 显示错误消息
                alert('分享失败: ' + message.error);
                break;
        }
    });

    // Mermaid图表交互功能
    // 存储图表状态
    const chartStates = new Map();

    // 初始化图表状态
    function initChartState(chartId) {
        if (!chartStates.has(chartId)) {
            chartStates.set(chartId, {
                scale: 1,
                translateX: 0,
                translateY: 0,
                isDragging: false,
                lastX: 0,
                lastY: 0
            });
        }
        return chartStates.get(chartId);
    }

    // 更新图表变换
    function updateChartTransform(chartId) {
        const state = chartStates.get(chartId);
        if (!state) return;

        const chartContainer = document.querySelector(`[data-chart-id="${chartId}"]`);
        if (!chartContainer) return;

        const svg = chartContainer.querySelector('svg');
        if (!svg) return;

        // 使用以左上角为原点的缩放，便于基于鼠标位置的缩放计算
        svg.style.transformOrigin = '0 0';
        // 变换顺序：translate 后 scale（右到左应用），确保 p' = S * p + T，其中 T 为屏幕像素位移
        const transform = `translate(${state.translateX}px, ${state.translateY}px) scale(${state.scale})`;
        svg.style.transform = transform;

        // 更新缩放信息
        const zoomInfo = chartContainer.querySelector('.mermaid-zoom-info');
        if (zoomInfo) {
            zoomInfo.textContent = `${Math.round(state.scale * 100)}%`;
        }

        // 更新容器状态
        if (state.scale > 1 || state.translateX !== 0 || state.translateY !== 0) {
            chartContainer.classList.add('zoomed');
        } else {
            chartContainer.classList.remove('zoomed');
        }
    }

    // 缩放图表
    window.zoomChart = function(chartId, factor) {
        const state = initChartState(chartId);
        const newScale = Math.max(0.1, Math.min(5, state.scale * factor));
        state.scale = newScale;
        updateChartTransform(chartId);
    };

    // 重置图表
    window.resetChart = function(chartId) {
        const state = chartStates.get(chartId);
        if (state) {
            state.scale = 1;
            state.translateX = 0;
            state.translateY = 0;
            updateChartTransform(chartId);
        }
    };

    // 鼠标滚轮缩放
    function setupChartWheelZoom() {
        // 按住 Ctrl 并滚动滚轮来缩放图表
        document.addEventListener('wheel', function(e) {
            const chartContainer = e.target.closest && e.target.closest('.mermaid-chart');
            if (!chartContainer) return;

            // 只有在按下 Ctrl 键时才进行缩放
            if (!e.ctrlKey) return;

            const chartId = chartContainer.getAttribute('data-chart-id');
            if (!chartId) return;

            const state = initChartState(chartId);
            const svg = chartContainer.querySelector('svg');
            if (!svg) return;

            // 阻止页面滚动，专注于图表缩放
            e.preventDefault();

            const rect = svg.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            // 使用指数缩放使触控板/高分辨率滚轮更平滑
            const zoomIntensity = 0.0005; // 减小缩放灵敏度（约每档 7-8%）
            const wheel = -e.deltaY; // 向下滚动缩小，向上放大
            const factor = Math.exp(wheel * zoomIntensity);

            const newScale = Math.max(0.1, Math.min(5, state.scale * factor));
            const ratio = newScale / state.scale;

            // 调整平移量以保持鼠标下的点在屏幕位置不变
            state.translateX = mouseX * (1 - ratio) + state.translateX * ratio;
            state.translateY = mouseY * (1 - ratio) + state.translateY * ratio;
            state.scale = newScale;

            updateChartTransform(chartId);
        }, { passive: false });
    }

    // 鼠标拖拽功能
    function setupChartDrag() {
        let currentChart = null;
        let currentState = null;

        document.addEventListener('mousedown', function(e) {
            const chartContainer = e.target.closest('.mermaid-chart');
            if (chartContainer && e.button === 0) { // 左键点击
                const chartId = chartContainer.getAttribute('data-chart-id');
                if (chartId) {
                    currentChart = chartContainer;
                    currentState = initChartState(chartId);
                    currentState.isDragging = true;
                    currentState.lastX = e.clientX;
                    currentState.lastY = e.clientY;
                    chartContainer.style.cursor = 'grabbing';
                }
            }
        });

        document.addEventListener('mousemove', function(e) {
            if (currentChart && currentState && currentState.isDragging) {
                const deltaX = e.clientX - currentState.lastX;
                const deltaY = e.clientY - currentState.lastY;
                
                currentState.translateX += deltaX;
                currentState.translateY += deltaY;
                
                currentState.lastX = e.clientX;
                currentState.lastY = e.clientY;
                
                updateChartTransform(currentChart.getAttribute('data-chart-id'));
            }
        });

        document.addEventListener('mouseup', function() {
            if (currentChart && currentState) {
                currentState.isDragging = false;
                currentChart.style.cursor = 'grab';
                currentChart = null;
                currentState = null;
            }
        });

        // 鼠标离开窗口时停止拖拽
        document.addEventListener('mouseleave', function() {
            if (currentChart && currentState) {
                currentState.isDragging = false;
                currentChart.style.cursor = 'grab';
                currentChart = null;
                currentState = null;
            }
        });
    }

    // 初始化图表交互功能
    function initChartInteractions() {
        if (typeof window.fitAllMermaidCharts === 'function') {
            window.fitAllMermaidCharts();
        }
        setupChartWheelZoom();
        setupChartDrag();
    }

    // 在预览更新后初始化图表交互
    const originalUpdatePreview = updatePreview;
    updatePreview = async function(content) {
        await originalUpdatePreview(content);
        // 延迟初始化，确保DOM已更新
        setTimeout(() => {
            initChartInteractions();
        }, 100);
    };

    // 立即初始化
    initChartInteractions();
})();