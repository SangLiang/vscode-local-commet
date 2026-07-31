(function() {
    const vscode = acquireVsCodeApi();
    const previewArea = document.getElementById('previewArea');
    let currentPreviewFontSize = null; // 保存当前预览字体大小

    const renderCore = window.MarkdownRenderCore.create();
    /** 可用标签白名单，由扩展侧 SET_AVAILABLE_TAGS 下发；传入 renderMarkdownToHtml 后仅渲染真实存在的 @tag */
    let availableTagNames = [];
    // 全局、一次性的初始化任务
    const initializationPromise = renderCore.waitForLibs()
        .then(() => {
            console.log('所有库初始化成功');
        })
        .catch(error => {
            console.error("关键库初始化失败:", error);
            previewArea.innerHTML = `<p style="color:red;">预览组件加载失败: ${error.message}</p>`;
            throw error;
        });

    // 更新预览内容
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

            initChartInteractions();
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

    // 初始化图表交互
    function initChartInteractions() {
        const charts = document.querySelectorAll('.mermaid-chart');
        charts.forEach(chart => {
            const chartId = chart.dataset.chartId;
            if (chartId) {
                if (typeof window.fitMermaidChart === 'function') {
                    window.fitMermaidChart(chart);
                }
                initChartState(chartId);
                setupChartWheelZoom(chartId);
                setupChartDrag(chartId);
            }
        });
    }

    // 初始化图表状态
    function initChartState(chartId) {
        const chart = document.querySelector(`[data-chart-id="${chartId}"]`);
        if (chart) {
            chart.dataset.scale = '1';
            chart.dataset.translateX = '0';
            chart.dataset.translateY = '0';
        }
    }

    // 更新图表变换
    function updateChartTransform(chartId) {
        const chart = document.querySelector(`[data-chart-id="${chartId}"]`);
        if (chart) {
            const scale = parseFloat(chart.dataset.scale) || 1;
            const translateX = parseFloat(chart.dataset.translateX) || 0;
            const translateY = parseFloat(chart.dataset.translateY) || 0;
            
            const svg = chart.querySelector('svg');
            if (svg) {
                // 使用以左上角为原点的缩放，便于基于鼠标位置的缩放计算
                svg.style.transformOrigin = '0 0';
                // 变换顺序：translate 后 scale（右到左应用），确保 p' = S * p + T，其中 T 为屏幕像素位移
                const transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
                svg.style.transform = transform;
            }
            
            // 更新容器状态
            if (scale > 1 || translateX !== 0 || translateY !== 0) {
                chart.classList.add('zoomed');
            } else {
                chart.classList.remove('zoomed');
            }
        }
    }

    // 设置滚轮缩放
    function setupChartWheelZoom(chartId) {
        const chart = document.querySelector(`[data-chart-id="${chartId}"]`);
        if (!chart) return;

        chart.addEventListener('wheel', (e) => {
            // 只有在按下 Ctrl 键时才进行缩放
            if (!e.ctrlKey) return;

            const chartId = chart.getAttribute('data-chart-id');
            if (!chartId) return;

            const currentScale = parseFloat(chart.dataset.scale) || 1;
            const svg = chart.querySelector('svg');
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

            const newScale = Math.max(0.1, Math.min(5, currentScale * factor));
            const ratio = newScale / currentScale;

            // 调整平移量以保持鼠标下的点在屏幕位置不变
            const currentTranslateX = parseFloat(chart.dataset.translateX) || 0;
            const currentTranslateY = parseFloat(chart.dataset.translateY) || 0;
            
            const newTranslateX = mouseX * (1 - ratio) + currentTranslateX * ratio;
            const newTranslateY = mouseY * (1 - ratio) + currentTranslateY * ratio;
            
            chart.dataset.scale = newScale.toString();
            chart.dataset.translateX = newTranslateX.toString();
            chart.dataset.translateY = newTranslateY.toString();
            
            updateChartTransform(chartId);
            
            // 更新缩放信息显示
            const zoomInfo = chart.querySelector('.mermaid-zoom-info');
            if (zoomInfo) {
                zoomInfo.textContent = `${Math.round(newScale * 100)}%`;
            }
        });
    }

    // 设置拖拽移动
    function setupChartDrag(chartId) {
        const chart = document.querySelector(`[data-chart-id="${chartId}"]`);
        if (!chart) return;

        let isDragging = false;
        let startX = 0;
        let startY = 0;
        let startTranslateX = 0;
        let startTranslateY = 0;

        chart.addEventListener('mousedown', (e) => {
            if (e.target.closest('.mermaid-controls')) return;
            
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            startTranslateX = parseFloat(chart.dataset.translateX) || 0;
            startTranslateY = parseFloat(chart.dataset.translateY) || 0;
            
            chart.style.cursor = 'grabbing';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            
            const deltaX = e.clientX - startX;
            const deltaY = e.clientY - startY;
            
            const newTranslateX = startTranslateX + deltaX;
            const newTranslateY = startTranslateY + deltaY;
            
            chart.dataset.translateX = newTranslateX.toString();
            chart.dataset.translateY = newTranslateY.toString();
            updateChartTransform(chartId);
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                chart.style.cursor = 'grab';
            }
        });

        // 鼠标离开窗口时停止拖拽
        document.addEventListener('mouseleave', () => {
            if (isDragging) {
                isDragging = false;
                chart.style.cursor = 'grab';
            }
        });
    }

    // 重置图表
    window.resetChart = function(chartId) {
        const chart = document.querySelector(`[data-chart-id="${chartId}"]`);
        if (chart) {
            chart.dataset.scale = '1';
            chart.dataset.translateX = '0';
            chart.dataset.translateY = '0';
            updateChartTransform(chartId);
            
            // 更新缩放信息显示
            const zoomInfo = chart.querySelector('.mermaid-zoom-info');
            if (zoomInfo) {
                zoomInfo.textContent = '100%';
            }
        }
    };

    // 缩放图表
    window.zoomChart = function(chartId, factor) {
        const chart = document.querySelector(`[data-chart-id="${chartId}"]`);
        if (chart) {
            const currentScale = parseFloat(chart.dataset.scale) || 1;
            const newScale = Math.max(0.1, Math.min(5, currentScale * factor));
            
            chart.dataset.scale = newScale.toString();
            updateChartTransform(chartId);
            
            // 更新缩放信息显示
            const zoomInfo = chart.querySelector('.mermaid-zoom-info');
            if (zoomInfo) {
                zoomInfo.textContent = `${Math.round(newScale * 100)}%`;
            }
        }
    };

    // 切换图表全屏
    window.toggleChartZoom = function(chartId) {
        const chart = document.querySelector(`[data-chart-id="${chartId}"]`);
        if (chart) {
            if (chart.classList.contains('zoomed')) {
                chart.classList.remove('zoomed');
                chart.style.cursor = 'grab';
            } else {
                chart.classList.add('zoomed');
                chart.style.cursor = 'grab';
            }
        }
    };

    // 关闭预览
    window.closePreview = function() {
        vscode.postMessage({
            command: 'close'
        });
    };

    // 导出为本地注释
    window.exportToLocalComment = function() {
        vscode.postMessage({
            command: 'exportToLocalComment'
        });
    };

    // 监听来自扩展的消息
    window.addEventListener('message', event => {
        const message = event.data;
        switch (message.command) {
            case 'setPreviewFontSize':
                // 设置预览区域字体大小
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
                // 扩展侧下发可用标签白名单，用于精确渲染 @tag 链接
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

    // 初始化预览
    function initializePreview() {
        if (window.markdownContent) {
            updatePreview(window.markdownContent);
        } else {
            console.log('window.markdownContent 不存在或为空');
        }
    }

    // 等待DOM加载完成后再初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializePreview);
    } else {
        // DOM已经加载完成，直接初始化
        initializePreview();
    }
})();
