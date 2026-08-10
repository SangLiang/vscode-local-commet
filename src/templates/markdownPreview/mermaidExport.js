/**
 * 导出 HTML 中的 Mermaid 图表交互入口
 * 依赖同页先内联的 public.js 与 mermaidChartInteract.js
 */
(function() {
    function initAllCharts() {
        if (!window.MermaidChartInteract) {
            console.error('MermaidChartInteract 未加载');
            return;
        }
        window.MermaidChartInteract.initAll(document, { ensureId: true, fit: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAllCharts);
    } else {
        initAllCharts();
    }
})();
